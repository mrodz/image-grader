import { ipcMain, dialog, protocol, net } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { Profile, RatingSavePayload } from '../shared/types'
import {
  getSettings,
  saveSettings,
  getProfilesData,
  saveProfile,
  deleteProfile,
  getStudyState,
  saveStudyState
} from './store'

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

export function registerProtocol(): void {
  protocol.handle('localfile', (request) => {
    const filePath = decodeURIComponent(request.url.slice('localfile://'.length))
    return net.fetch('file://' + filePath)
  })
}

export function registerIpcHandlers(): void {
  // Settings
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

  // Study / image list
  ipcMain.handle('get-study-state', () => getStudyState())

  ipcMain.handle('rescan-images', (_e, inputDirectory: string) => {
    const imageList = scanImages(inputDirectory)
    const state = {
      imageList,
      inputDirectory,
      generatedAt: new Date().toISOString()
    }
    saveStudyState(state)
    return state
  })

  ipcMain.handle('get-image-url', (_e, inputDirectory: string, filename: string) => {
    const full = path.join(inputDirectory, filename)
    if (!fs.existsSync(full)) return null
    return 'localfile://' + encodeURIComponent(full)
  })

  // Profiles
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

  // Rating
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

  // Export
  ipcMain.handle('export-csv', async (_e, outputDirectory: string) => {
    const study = getStudyState()
    if (!study) return { ok: false, error: 'No study data found. Please scan an image directory first.' }

    const settings = getSettings()
    const profiles = getProfilesData().profiles
    if (profiles.length === 0) return { ok: false, error: 'No profiles found.' }

    const { filePath: savePath, canceled } = await dialog.showSaveDialog({
      defaultPath: path.join(outputDirectory, `ratings_export_${Date.now()}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !savePath) return { ok: false, error: 'Export canceled.' }

    // Build wide-format CSV
    const participantNames = profiles.map((p) => p.name)
    const headers = [
      'filepath',
      'filename',
      'mean_rating',
      'n_raters',
      ...participantNames.map((n) => `participant_${n.replace(/[^a-zA-Z0-9_]/g, '_')}`)
    ]

    const rows: string[] = [headers.map(quoteCsv).join(',')]

    for (const filename of study.imageList) {
      const filepath = path.join(settings.inputDirectory, filename)
      const fileExists = fs.existsSync(filepath)
      const individualRatings = profiles.map((p) => p.ratings[filename] ?? null)
      const rated = individualRatings.filter((r): r is number => r !== null)
      const mean = rated.length > 0 ? (rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(4) : ''

      const row = [
        fileExists ? filepath : filepath + ' [MISSING]',
        filename,
        mean,
        String(rated.length),
        ...individualRatings.map((r) => (r !== null ? String(r) : ''))
      ]
      rows.push(row.map(quoteCsv).join(','))
    }

    // Also write a long-format file alongside
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

function quoteCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}
