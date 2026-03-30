import { ipcMain, dialog, protocol, net, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { Study, Profile, RatingSavePayload, FacialProgressEvent } from '../shared/types'
import {
  getSettings,
  saveSettings,
  getStudiesData,
  saveStudy,
  deleteStudyById,
  getStudy,
  getProfilesForStudy,
  getProfile,
  saveProfile,
  deleteProfile,
  getFacialDataForStudy,
  getFacialRecord,
  markFacialProcessing,
  markAllFacialProcessing,
  saveFacialResult,
  saveFacialError,
  resetFacialRecord,
  resetFacialRecords,
  ensureFacialRecords,
  deleteRatingsForImages,
  updateRatingValue
} from './store'
import { pythonBridge, type BatchCallbacks } from './python-bridge'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'])

function scanImages(dir: string): string[] {
  if (!dir || !fs.existsSync(dir)) return []
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  } catch {
    return []
  }
}

function generateId(): string {
  return crypto.randomUUID()
}

function getMainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

function pushToRenderer(channel: string, data: unknown): void {
  getMainWindow()?.webContents.send(channel, data)
}

export function registerProtocol(): void {
  protocol.handle('localfile', (request) => {
    const filePath = decodeURIComponent(request.url.slice('localfile://'.length))
    return net.fetch('file://' + filePath)
  })
}

export function registerIpcHandlers(): void {
  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  ipcMain.handle('get-settings', () => getSettings())

  ipcMain.handle('save-settings', (_e, settings) => {
    saveSettings(settings)
    return { ok: true }
  })

  ipcMain.handle('select-directory', async (_e, defaultPath?: string) => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      defaultPath: defaultPath || undefined
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ---------------------------------------------------------------------------
  // Studies
  // ---------------------------------------------------------------------------
  ipcMain.handle('get-studies', () => getStudiesData().studies)

  ipcMain.handle('create-study', (_e, { name, inputDirectory }: { name: string; inputDirectory: string }) => {
    const now = new Date().toISOString()
    const imageList = scanImages(inputDirectory)
    const study: Study = {
      id: generateId(),
      name: name.trim(),
      inputDirectory,
      imageList,
      generatedAt: now,
      createdAt: now
    }
    saveStudy(study)
    ensureFacialRecords(study.id, imageList)
    return study
  })

  ipcMain.handle('rename-study', (_e, id: string, name: string) => {
    const study = getStudy(id)
    if (!study) return { ok: false }
    saveStudy({ ...study, name: name.trim() })
    return { ok: true }
  })

  ipcMain.handle('delete-study', (_e, id: string) => {
    deleteStudyById(id)
    return { ok: true }
  })

  ipcMain.handle('rescan-study', (_e, studyId: string) => {
    const study = getStudy(studyId)
    if (!study) return null
    const imageList = scanImages(study.inputDirectory)
    const updated: Study = { ...study, imageList, generatedAt: new Date().toISOString() }
    saveStudy(updated)
    ensureFacialRecords(studyId, imageList)
    return updated
  })

  // ---------------------------------------------------------------------------
  // Image URLs
  // ---------------------------------------------------------------------------
  ipcMain.handle('get-image-url', (_e, inputDirectory: string, filename: string) => {
    const full = path.join(inputDirectory, filename)
    if (!fs.existsSync(full)) return null
    return 'localfile://' + encodeURIComponent(full)
  })

  // ---------------------------------------------------------------------------
  // Profiles
  // ---------------------------------------------------------------------------
  ipcMain.handle('get-profiles', (_e, studyId: string) => getProfilesForStudy(studyId))

  ipcMain.handle('create-profile', (_e, studyId: string, name: string) => {
    const profile: Profile = {
      id: generateId(),
      studyId,
      name: name.trim(),
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      currentIndex: 0,
      ratings: {}
    }
    saveProfile(profile)
    return profile
  })

  ipcMain.handle('rename-profile', (_e, id: string, name: string) => {
    const profile = getProfile(id)
    if (!profile) return { ok: false }
    saveProfile({ ...profile, name: name.trim() })
    return { ok: true }
  })

  ipcMain.handle('delete-profile', (_e, id: string) => {
    deleteProfile(id)
    return { ok: true }
  })

  ipcMain.handle('touch-profile', (_e, id: string) => {
    const profile = getProfile(id)
    if (!profile) return
    saveProfile({ ...profile, lastActiveAt: new Date().toISOString() })
  })

  // ---------------------------------------------------------------------------
  // Ratings
  // ---------------------------------------------------------------------------
  ipcMain.handle('save-rating', (_e, payload: RatingSavePayload) => {
    const profile = getProfile(payload.profileId)
    if (!profile) return { ok: false }
    profile.ratings[payload.filename] = payload.rating
    profile.currentIndex = payload.newIndex
    profile.lastActiveAt = new Date().toISOString()
    saveProfile(profile)
    return { ok: true }
  })

  ipcMain.handle('update-profile-index', (_e, profileId: string, index: number) => {
    const profile = getProfile(profileId)
    if (!profile) return
    saveProfile({ ...profile, currentIndex: index })
  })

  // ---------------------------------------------------------------------------
  // Data browser mutations
  // ---------------------------------------------------------------------------

  ipcMain.handle('reset-facial-data', (_e, studyId: string, filenames: string[]) => {
    resetFacialRecords(studyId, filenames)
    return { ok: true }
  })

  ipcMain.handle('delete-ratings-for-images', (_e, studyId: string, filenames: string[]) => {
    deleteRatingsForImages(studyId, filenames)
    return { ok: true }
  })

  ipcMain.handle(
    'update-rating-value',
    (_e, { profileId, filename, value }: { profileId: string; filename: string; value: number }) => {
      updateRatingValue(profileId, filename, value)
      return { ok: true }
    }
  )

  // ---------------------------------------------------------------------------
  // Facial analysis
  // ---------------------------------------------------------------------------

  ipcMain.handle('get-facial-data', (_e, studyId: string) => getFacialDataForStudy(studyId))

  ipcMain.handle('get-worker-status', () => ({ ready: pythonBridge.isReady() }))

  ipcMain.handle(
    'process-image-facial',
    async (_e, studyId: string, filename: string, filepath: string) => {
      if (!pythonBridge.isReady()) return { ok: false, error: 'Python worker is not ready' }

      markFacialProcessing(studyId, filename)
      pushProgressEvent(filename, 'processing', 0, 1)

      try {
        const result = await pythonBridge.processImage(filepath)
        saveFacialResult(studyId, filename, result.face_detected, result.sex_label, result.sex_confidence, result.metrics)
        const record = getFacialRecord(studyId, filename)
        pushProgressEvent(filename, 'done', 1, 1, record)
        return { ok: true, data: record }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        saveFacialError(studyId, filename, msg)
        const record = getFacialRecord(studyId, filename)
        pushProgressEvent(filename, 'error', 1, 1, record)
        return { ok: false, error: msg }
      }
    }
  )

  ipcMain.handle(
    'process-batch-facial',
    (_e, items: Array<{ studyId: string; filename: string; filepath: string }>) => {
      if (!pythonBridge.isReady()) return { ok: false, error: 'Python worker is not ready' }

      const total = items.length
      if (total === 0) return { ok: true, total: 0 }

      // Map filename → studyId for callback lookup
      const studyForFile = new Map(items.map((i) => [i.filename, i.studyId]))

      markAllFacialProcessing(items)

      let completed = 0

      const callbacks: BatchCallbacks = {
        onItem(filename, result, error) {
          completed++
          const studyId = studyForFile.get(filename)!
          if (result) {
            saveFacialResult(studyId, filename, result.face_detected, result.sex_label, result.sex_confidence, result.metrics)
            const record = getFacialRecord(studyId, filename)
            pushProgressEvent(filename, 'done', completed, total, record)
          } else {
            saveFacialError(studyId, filename, error ?? 'Unknown error')
            const record = getFacialRecord(studyId, filename)
            pushProgressEvent(filename, 'error', completed, total, record)
          }
        },
        onDone() {
          pushToRenderer('facial-batch-complete', { total, completed })
        },
        onError(err) {
          for (const { studyId, filename } of items) {
            const record = getFacialRecord(studyId, filename)
            if (record.processing_status === 'processing') {
              saveFacialError(studyId, filename, err.message)
            }
          }
          pushToRenderer('facial-batch-complete', { total, completed, error: err.message })
        }
      }

      pythonBridge.processBatch(
        items.map(({ filename, filepath }) => ({ filename, filepath })),
        callbacks
      )

      return { ok: true, total }
    }
  )

  ipcMain.handle(
    'reprocess-image-facial',
    async (_e, studyId: string, filename: string, filepath: string) => {
      resetFacialRecord(studyId, filename)
      if (!pythonBridge.isReady()) return { ok: false, error: 'Python worker is not ready' }

      markFacialProcessing(studyId, filename)
      pushProgressEvent(filename, 'processing', 0, 1)

      try {
        const result = await pythonBridge.processImage(filepath)
        saveFacialResult(studyId, filename, result.face_detected, result.sex_label, result.sex_confidence, result.metrics)
        const record = getFacialRecord(studyId, filename)
        pushProgressEvent(filename, 'done', 1, 1, record)
        return { ok: true, data: record }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        saveFacialError(studyId, filename, msg)
        const record = getFacialRecord(studyId, filename)
        pushProgressEvent(filename, 'error', 1, 1, record)
        return { ok: false, error: msg }
      }
    }
  )

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  ipcMain.handle(
    'export-csv',
    async (_e, { studyIds, outputDirectory }: { studyIds: string[]; outputDirectory: string }) => {
      if (studyIds.length === 0) return { ok: false, error: 'No studies selected.' }

      const allStudies = studyIds.map((id) => getStudy(id)).filter((s): s is Study => s !== undefined)
      if (allStudies.length === 0) return { ok: false, error: 'Studies not found.' }
      const isSingle = allStudies.length === 1
      const settings = getSettings()
      const defaultName = isSingle
        ? `${allStudies[0].name}_export_${Date.now()}.csv`
        : `combined_export_${Date.now()}.csv`

      const { filePath: savePath, canceled } = await dialog.showSaveDialog({
        defaultPath: path.join(outputDirectory || settings.outputDirectory, defaultName),
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (canceled || !savePath) return { ok: false, error: 'Export canceled.' }

      // Long-format (works for both single and multi-study)
      const longHeaders = ['study_id', 'study_name', 'filepath', 'filename', 'participant', 'rating']
      const longRows: string[] = [longHeaders.map(quoteCsv).join(',')]

      // Wide-format (one row per image)
      // Collect all participants across selected studies
      const allProfiles: Profile[] = []
      for (const study of allStudies) {
        allProfiles.push(...getProfilesForStudy(study.id))
      }

      const metricKeysSet = new Set<string>()
      for (const study of allStudies) {
        const fd = getFacialDataForStudy(study.id)
        collectMetricKeys(study.imageList, fd).forEach((k) => metricKeysSet.add(k))
      }
      const metricKeys = Array.from(metricKeysSet).sort()

      const facialColumns = ['sex_label', 'sex_confidence', 'face_detected', 'processing_status', ...metricKeys]

      // Wide-format participant columns prefixed with study name when multi-study
      const participantCols = allProfiles.map((p) => {
        const study = allStudies.find((s) => s.id === p.studyId)!
        const colName = isSingle
          ? `participant_${p.name.replace(/[^a-zA-Z0-9_]/g, '_')}`
          : `${study.name.replace(/[^a-zA-Z0-9_]/g, '_')}_${p.name.replace(/[^a-zA-Z0-9_]/g, '_')}`
        return { profile: p, colName }
      })

      const wideHeaders = [
        'study_id',
        'study_name',
        'filepath',
        'filename',
        'mean_rating',
        'n_raters',
        ...participantCols.map((c) => c.colName),
        ...facialColumns
      ]
      const wideRows: string[] = [wideHeaders.map(quoteCsv).join(',')]

      for (const study of allStudies) {
        const fd = getFacialDataForStudy(study.id)
        const studyProfiles = allProfiles.filter((p) => p.studyId === study.id)

        for (const filename of study.imageList) {
          const filepath = path.join(study.inputDirectory, filename)
          const fileExists = fs.existsSync(filepath)

          // Long format rows
          for (const profile of studyProfiles) {
            const rating = profile.ratings[filename]
            if (rating !== undefined) {
              longRows.push(
                [study.id, study.name, fileExists ? filepath : filepath + ' [MISSING]', filename, profile.name, String(rating)]
                  .map(quoteCsv)
                  .join(',')
              )
            }
          }

          // Wide format row
          const individualRatings = allProfiles.map((p) =>
            p.studyId === study.id ? (p.ratings[filename] ?? null) : null
          )
          const rated = individualRatings.filter((r): r is number => r !== null)
          const mean = rated.length > 0 ? (rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(4) : ''

          const facialRec = fd[filename]
          const facialValues = [
            facialRec?.sex_label ?? '',
            facialRec?.sex_confidence != null ? String(facialRec.sex_confidence) : '',
            facialRec ? String(facialRec.face_detected) : '',
            facialRec?.processing_status ?? 'pending',
            ...metricKeys.map((k) => {
              const v = facialRec?.facial_metrics_json?.[k]
              return v != null ? String(v) : ''
            })
          ]

          const wideRow = [
            study.id,
            study.name,
            fileExists ? filepath : filepath + ' [MISSING]',
            filename,
            mean,
            String(rated.length),
            ...individualRatings.map((r) => (r !== null ? String(r) : '')),
            ...facialValues
          ]
          wideRows.push(wideRow.map(quoteCsv).join(','))
        }
      }

      fs.writeFileSync(savePath, wideRows.join('\n'), 'utf-8')
      const longPath = savePath.replace(/\.csv$/i, '_long.csv')
      fs.writeFileSync(longPath, longRows.join('\n'), 'utf-8')

      return { ok: true, path: savePath, longPath }
    }
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pushProgressEvent(
  filename: string,
  status: FacialProgressEvent['status'],
  completed: number,
  total: number,
  data?: FacialProgressEvent['data']
): void {
  const event: FacialProgressEvent = { filename, status, completed, total, data }
  pushToRenderer('facial-progress', event)
}

function collectMetricKeys(
  imageList: string[],
  facialRecords: Record<string, { facial_metrics_json?: Record<string, unknown>; processing_status?: string }>
): string[] {
  const keySet = new Set<string>()
  for (const filename of imageList) {
    const fd = facialRecords[filename]
    if (fd?.processing_status === 'done' && fd.facial_metrics_json) {
      for (const k of Object.keys(fd.facial_metrics_json)) keySet.add(k)
    }
  }
  return Array.from(keySet).sort()
}

function quoteCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}
