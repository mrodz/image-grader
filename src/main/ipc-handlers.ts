import { ipcMain, dialog, protocol, net, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { Profile, RatingSavePayload, FacialProgressEvent } from '../shared/types'
import {
  getSettings,
  saveSettings,
  getProfilesData,
  saveProfile,
  deleteProfile,
  getStudyState,
  saveStudyState,
  getFacialStore,
  saveFacialStore,
  markFacialProcessing,
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
  // Study / image list
  // ---------------------------------------------------------------------------
  ipcMain.handle('get-study-state', () => getStudyState())

  ipcMain.handle('rescan-images', (_e, inputDirectory: string) => {
    const imageList = scanImages(inputDirectory)
    const state = {
      imageList,
      inputDirectory,
      generatedAt: new Date().toISOString()
    }
    saveStudyState(state)
    // Seed pending facial records for any new images
    ensureFacialRecords(imageList)
    return state
  })

  ipcMain.handle('get-image-url', (_e, inputDirectory: string, filename: string) => {
    const full = path.join(inputDirectory, filename)
    if (!fs.existsSync(full)) return null
    return 'localfile://' + encodeURIComponent(full)
  })

  // ---------------------------------------------------------------------------
  // Profiles
  // ---------------------------------------------------------------------------
  ipcMain.handle('get-profiles', () => getProfilesData().profiles)

  ipcMain.handle('create-profile', (_e, name: string) => {
    const profile: Profile = {
      id: generateId(),
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
    const data = getProfilesData()
    const profile = data.profiles.find((p) => p.id === id)
    if (!profile) return { ok: false }
    profile.name = name.trim()
    saveProfile(profile)
    return { ok: true }
  })

  ipcMain.handle('delete-profile', (_e, id: string) => {
    deleteProfile(id)
    return { ok: true }
  })

  ipcMain.handle('touch-profile', (_e, id: string) => {
    const data = getProfilesData()
    const profile = data.profiles.find((p) => p.id === id)
    if (!profile) return
    profile.lastActiveAt = new Date().toISOString()
    saveProfile(profile)
  })

  // ---------------------------------------------------------------------------
  // Rating
  // ---------------------------------------------------------------------------
  ipcMain.handle('save-rating', (_e, payload: RatingSavePayload) => {
    const data = getProfilesData()
    const profile = data.profiles.find((p) => p.id === payload.profileId)
    if (!profile) return { ok: false }
    profile.ratings[payload.filename] = payload.rating
    profile.currentIndex = payload.newIndex
    profile.lastActiveAt = new Date().toISOString()
    saveProfile(profile)
    return { ok: true }
  })

  ipcMain.handle('update-profile-index', (_e, profileId: string, index: number) => {
    const data = getProfilesData()
    const profile = data.profiles.find((p) => p.id === profileId)
    if (!profile) return
    profile.currentIndex = index
    saveProfile(profile)
  })

  // ---------------------------------------------------------------------------
  // Data browser mutations
  // ---------------------------------------------------------------------------

  /** Reset one or more facial records back to pending. */
  ipcMain.handle('reset-facial-data', (_e, filenames: string[]) => {
    resetFacialRecords(filenames)
    return { ok: true }
  })

  /** Delete ratings for the given images across all profiles. */
  ipcMain.handle('delete-ratings-for-images', (_e, filenames: string[]) => {
    deleteRatingsForImages(filenames)
    return { ok: true }
  })

  /** Overwrite a single rating value. */
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

  /** Return the entire facial data store (filename → FacialData). */
  ipcMain.handle('get-facial-data', () => getFacialStore().records)

  /** Whether the Python worker process is ready to accept requests. */
  ipcMain.handle('get-worker-status', () => ({ ready: pythonBridge.isReady() }))

  /**
   * Process a single image.
   * This runs synchronously from the renderer's perspective (await),
   * but the actual Python call is async and pushed as a progress event too.
   */
  ipcMain.handle('process-image-facial', async (_e, filename: string, filepath: string) => {
    if (!pythonBridge.isReady()) {
      return { ok: false, error: 'Python worker is not ready' }
    }

    markFacialProcessing(filename)
    const totalInBatch = 1
    pushProgressEvent(filename, 'processing', 0, totalInBatch)

    try {
      const result = await pythonBridge.processImage(filepath)
      saveFacialResult(
        filename,
        result.face_detected,
        result.sex_label,
        result.sex_confidence,
        result.metrics
      )
      const record = getFacialStore().records[filename]
      pushProgressEvent(filename, 'done', 1, totalInBatch, record)
      return { ok: true, data: record }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      saveFacialError(filename, msg)
      const record = getFacialStore().records[filename]
      pushProgressEvent(filename, 'error', 1, totalInBatch, record)
      return { ok: false, error: msg }
    }
  })

  /**
   * Process many images in a single Python worker request.
   * Returns immediately with { ok: true, total }; results are streamed back
   * via 'facial-progress' events as each image finishes on the Python side.
   */
  ipcMain.handle(
    'process-batch-facial',
    (_e, items: Array<{ filename: string; filepath: string }>) => {
      if (!pythonBridge.isReady()) {
        return { ok: false, error: 'Python worker is not ready' }
      }

      const total = items.length
      if (total === 0) return { ok: true, total: 0 }

      // Mark all as processing up-front so the UI shows them immediately
      const store = getFacialStore()
      for (const { filename } of items) {
        store.records[filename] = {
          ...(store.records[filename] ?? {
            filename,
            sex_label: 'unknown',
            sex_confidence: null,
            face_detected: false,
            facial_metrics_json: {},
            processing_status: 'processing',
            processing_error: null,
            processed_at: null
          }),
          processing_status: 'processing',
          processing_error: null
        }
      }
      saveFacialStore(store)

      let completed = 0

      const callbacks: BatchCallbacks = {
        onItem(filename, result, error) {
          completed++
          if (result) {
            saveFacialResult(
              filename,
              result.face_detected,
              result.sex_label,
              result.sex_confidence,
              result.metrics
            )
            const record = getFacialStore().records[filename]
            pushProgressEvent(filename, 'done', completed, total, record)
          } else {
            saveFacialError(filename, error ?? 'Unknown error')
            const record = getFacialStore().records[filename]
            pushProgressEvent(filename, 'error', completed, total, record)
          }
        },
        onDone() {
          pushToRenderer('facial-batch-complete', { total, completed })
        },
        onError(err) {
          // Worker crashed mid-batch — mark remaining items as error
          const remaining = getFacialStore()
          for (const { filename } of items) {
            if (remaining.records[filename]?.processing_status === 'processing') {
              saveFacialError(filename, err.message)
            }
          }
          pushToRenderer('facial-batch-complete', { total, completed, error: err.message })
        }
      }

      // One message to Python covers the entire batch
      pythonBridge.processBatch(items, callbacks)

      return { ok: true, total }
    }
  )

  /**
   * Reset a single image back to 'pending' and immediately reprocess it.
   */
  ipcMain.handle('reprocess-image-facial', async (_e, filename: string, filepath: string) => {
    resetFacialRecord(filename)
    // Delegate to the single-image handler logic
    if (!pythonBridge.isReady()) {
      return { ok: false, error: 'Python worker is not ready' }
    }

    markFacialProcessing(filename)
    pushProgressEvent(filename, 'processing', 0, 1)

    try {
      const result = await pythonBridge.processImage(filepath)
      saveFacialResult(
        filename,
        result.face_detected,
        result.sex_label,
        result.sex_confidence,
        result.metrics
      )
      const record = getFacialStore().records[filename]
      pushProgressEvent(filename, 'done', 1, 1, record)
      return { ok: true, data: record }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      saveFacialError(filename, msg)
      const record = getFacialStore().records[filename]
      pushProgressEvent(filename, 'error', 1, 1, record)
      return { ok: false, error: msg }
    }
  })

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  ipcMain.handle('export-csv', async (_e, outputDirectory: string) => {
    const study = getStudyState()
    if (!study) return { ok: false, error: 'No study data found. Please scan an image directory first.' }

    const settings = getSettings()
    const profiles = getProfilesData().profiles
    if (profiles.length === 0) return { ok: false, error: 'No profiles found.' }

    const facialRecords = getFacialStore().records

    const { filePath: savePath, canceled } = await dialog.showSaveDialog({
      defaultPath: path.join(outputDirectory, `ratings_export_${Date.now()}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !savePath) return { ok: false, error: 'Export canceled.' }

    // Collect all flattened metric keys across all records for consistent columns
    const metricKeys = collectMetricKeys(study.imageList, facialRecords)

    // --- Wide-format CSV ---
    const participantNames = profiles.map((p) => p.name)
    const facialColumns = [
      'sex_label',
      'sex_confidence',
      'face_detected',
      'processing_status',
      ...metricKeys
    ]
    const headers = [
      'filepath',
      'filename',
      'mean_rating',
      'n_raters',
      ...participantNames.map((n) => `participant_${n.replace(/[^a-zA-Z0-9_]/g, '_')}`),
      ...facialColumns
    ]

    const rows: string[] = [headers.map(quoteCsv).join(',')]

    for (const filename of study.imageList) {
      const filepath = path.join(settings.inputDirectory, filename)
      const fileExists = fs.existsSync(filepath)
      const individualRatings = profiles.map((p) => p.ratings[filename] ?? null)
      const rated = individualRatings.filter((r): r is number => r !== null)
      const mean = rated.length > 0 ? (rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(4) : ''

      const fd = facialRecords[filename]
      const facialValues = [
        fd?.sex_label ?? '',
        fd?.sex_confidence != null ? String(fd.sex_confidence) : '',
        fd ? String(fd.face_detected) : '',
        fd?.processing_status ?? 'pending',
        ...metricKeys.map((k) => {
          const v = fd?.facial_metrics_json?.[k]
          return v != null ? String(v) : ''
        })
      ]

      const row = [
        fileExists ? filepath : filepath + ' [MISSING]',
        filename,
        mean,
        String(rated.length),
        ...individualRatings.map((r) => (r !== null ? String(r) : '')),
        ...facialValues
      ]
      rows.push(row.map(quoteCsv).join(','))
    }

    // --- Long-format CSV ---
    const longHeaders = ['filepath', 'filename', 'participant', 'rating']
    const longRows: string[] = [longHeaders.map(quoteCsv).join(',')]
    for (const filename of study.imageList) {
      const filepath = path.join(settings.inputDirectory, filename)
      for (const profile of profiles) {
        const rating = profile.ratings[filename]
        if (rating !== undefined) {
          longRows.push([filepath, filename, profile.name, String(rating)].map(quoteCsv).join(','))
        }
      }
    }

    fs.writeFileSync(savePath, rows.join('\n'), 'utf-8')
    const longPath = savePath.replace(/\.csv$/i, '_long.csv')
    fs.writeFileSync(longPath, longRows.join('\n'), 'utf-8')

    return { ok: true, path: savePath, longPath }
  })
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

/**
 * Collect a stable, sorted list of all metric keys across all processed images.
 * Only uses images that are 'done' to avoid half-filled columns.
 */
function collectMetricKeys(
  imageList: string[],
  facialRecords: Record<string, { facial_metrics_json?: Record<string, unknown>; processing_status?: string }>
): string[] {
  const keySet = new Set<string>()
  for (const filename of imageList) {
    const fd = facialRecords[filename]
    if (fd?.processing_status === 'done' && fd.facial_metrics_json) {
      for (const k of Object.keys(fd.facial_metrics_json)) {
        keySet.add(k)
      }
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
