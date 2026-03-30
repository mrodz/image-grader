import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type {
  AppSettings,
  Study,
  StudiesData,
  Profile,
  ProfilesData,
  FacialData,
  FacialDataStore,
  ProcessingStatus,
  SexLabel
} from '../shared/types'

const DATA_DIR = app.getPath('userData')

function filePath(name: string): string {
  return path.join(DATA_DIR, name)
}

function readJson<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath(file), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, data: unknown): void {
  const target = filePath(file)
  const tmp = target + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, target)
}

// ---------------------------------------------------------------------------
// Migration  (run once, before any other store access)
// ---------------------------------------------------------------------------

/**
 * Migrate from the legacy single-study schema to multi-study.
 *
 * Old layout:
 *   settings.json  → { inputDirectory, outputDirectory }
 *   study.json     → { imageList, inputDirectory, generatedAt }
 *   profiles.json  → { profiles: Profile[] }          (no studyId)
 *   facial.json    → { records: { filename → FacialData } }
 *
 * New layout:
 *   settings.json  → { outputDirectory }
 *   studies.json   → { studies: Study[] }
 *   profiles.json  → { profiles: Profile[] }          (each has studyId)
 *   facial.json    → { records: { "studyId:filename" → FacialData } }
 */
export function runMigrations(): void {
  if (fs.existsSync(filePath('studies.json'))) return // already migrated

  interface OldSettings { inputDirectory?: string; outputDirectory?: string }
  interface OldStudy { imageList: string[]; inputDirectory: string; generatedAt: string }
  interface OldProfile {
    id: string; name: string; createdAt: string; lastActiveAt: string;
    currentIndex: number; ratings: Record<string, number>
  }

  const oldSettings = readJson<OldSettings>('settings.json', {})
  const oldStudy = readJson<OldStudy | null>('study.json', null)
  const oldProfiles = readJson<{ profiles: OldProfile[] }>('profiles.json', { profiles: [] })
  const oldFacial = readJson<{ records: Record<string, unknown> }>('facial.json', { records: {} })

  // Write new global settings (drop inputDirectory)
  writeJson('settings.json', {
    outputDirectory: oldSettings.outputDirectory ?? app.getPath('documents')
  })

  if (!oldStudy && oldProfiles.profiles.length === 0) {
    // Fresh install — nothing to migrate
    writeJson('studies.json', { studies: [] })
    writeJson('profiles.json', { profiles: [] })
    return
  }

  const studyId = crypto.randomUUID()
  const inputDir = oldStudy?.inputDirectory ?? oldSettings.inputDirectory ?? ''
  const dirName = inputDir ? path.basename(inputDir) : ''

  const newStudy: Study = {
    id: studyId,
    name: dirName || 'Study 1',
    inputDirectory: inputDir,
    imageList: oldStudy?.imageList ?? [],
    generatedAt: oldStudy?.generatedAt ?? new Date().toISOString(),
    createdAt: oldStudy?.generatedAt ?? new Date().toISOString()
  }

  // Add studyId to every profile
  const newProfiles: Profile[] = oldProfiles.profiles.map((p) => ({
    ...p,
    studyId
  }))

  // Re-key facial records: filename → studyId:filename
  const newFacialRecords: Record<string, unknown> = {}
  for (const [filename, data] of Object.entries(oldFacial.records)) {
    newFacialRecords[`${studyId}:${filename}`] = data
  }

  writeJson('studies.json', { studies: [newStudy] })
  writeJson('profiles.json', { profiles: newProfiles })
  writeJson('facial.json', { records: newFacialRecords })
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: AppSettings = { outputDirectory: app.getPath('documents') }

export function getSettings(): AppSettings {
  return readJson<AppSettings>('settings.json', DEFAULT_SETTINGS)
}

export function saveSettings(settings: AppSettings): void {
  writeJson('settings.json', settings)
}

// ---------------------------------------------------------------------------
// Studies
// ---------------------------------------------------------------------------

export function getStudiesData(): StudiesData {
  return readJson<StudiesData>('studies.json', { studies: [] })
}

export function saveStudiesData(data: StudiesData): void {
  writeJson('studies.json', data)
}

export function getStudy(id: string): Study | undefined {
  return getStudiesData().studies.find((s) => s.id === id)
}

export function saveStudy(study: Study): void {
  const data = getStudiesData()
  const idx = data.studies.findIndex((s) => s.id === study.id)
  if (idx >= 0) {
    data.studies[idx] = study
  } else {
    data.studies.push(study)
  }
  saveStudiesData(data)
}

export function deleteStudyById(id: string): void {
  // Delete study record
  const data = getStudiesData()
  data.studies = data.studies.filter((s) => s.id !== id)
  saveStudiesData(data)

  // Delete all profiles for this study
  const profilesData = getProfilesData()
  profilesData.profiles = profilesData.profiles.filter((p) => p.studyId !== id)
  saveProfilesData(profilesData)

  // Delete all facial records for this study
  const facialStore = getFacialStore()
  const prefix = `${id}:`
  for (const key of Object.keys(facialStore.records)) {
    if (key.startsWith(prefix)) delete facialStore.records[key]
  }
  saveFacialStore(facialStore)
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export function getProfilesData(): ProfilesData {
  return readJson<ProfilesData>('profiles.json', { profiles: [] })
}

export function saveProfilesData(data: ProfilesData): void {
  writeJson('profiles.json', data)
}

export function getProfilesForStudy(studyId: string): Profile[] {
  return getProfilesData().profiles.filter((p) => p.studyId === studyId)
}

export function getProfile(id: string): Profile | undefined {
  return getProfilesData().profiles.find((p) => p.id === id)
}

export function saveProfile(profile: Profile): void {
  const data = getProfilesData()
  const idx = data.profiles.findIndex((p) => p.id === profile.id)
  if (idx >= 0) {
    data.profiles[idx] = profile
  } else {
    data.profiles.push(profile)
  }
  saveProfilesData(data)
}

export function deleteProfile(id: string): void {
  const data = getProfilesData()
  data.profiles = data.profiles.filter((p) => p.id !== id)
  saveProfilesData(data)
}

// ---------------------------------------------------------------------------
// Facial Data  (internal key format: "studyId:filename")
// ---------------------------------------------------------------------------

const FACIAL_STORE_FILE = 'facial.json'
const EMPTY_FACIAL_STORE: FacialDataStore = { records: {} }

function facialKey(studyId: string, filename: string): string {
  return `${studyId}:${filename}`
}

export function getFacialStore(): FacialDataStore {
  return readJson<FacialDataStore>(FACIAL_STORE_FILE, EMPTY_FACIAL_STORE)
}

export function saveFacialStore(store: FacialDataStore): void {
  writeJson(FACIAL_STORE_FILE, store)
}

/**
 * Return all FacialData records for a study, keyed by filename only
 * (strips the studyId prefix from the internal store keys).
 */
export function getFacialDataForStudy(studyId: string): Record<string, FacialData> {
  const store = getFacialStore()
  const prefix = `${studyId}:`
  const result: Record<string, FacialData> = {}
  for (const [key, data] of Object.entries(store.records)) {
    if (key.startsWith(prefix)) {
      result[key.slice(prefix.length)] = data
    }
  }
  return result
}

export function getFacialRecord(studyId: string, filename: string): FacialData {
  const store = getFacialStore()
  return store.records[facialKey(studyId, filename)] ?? makePendingRecord(filename)
}

export function saveFacialRecord(studyId: string, record: FacialData): void {
  const store = getFacialStore()
  store.records[facialKey(studyId, record.filename)] = record
  saveFacialStore(store)
}

export function markFacialProcessing(studyId: string, filename: string): void {
  const store = getFacialStore()
  const key = facialKey(studyId, filename)
  const existing = store.records[key] ?? makePendingRecord(filename)
  store.records[key] = { ...existing, processing_status: 'processing', processing_error: null }
  saveFacialStore(store)
}

/** Mark a whole batch as processing in a single write. */
export function markAllFacialProcessing(
  items: Array<{ studyId: string; filename: string }>
): void {
  const store = getFacialStore()
  for (const { studyId, filename } of items) {
    const key = facialKey(studyId, filename)
    const existing = store.records[key]
    store.records[key] = {
      ...(existing ?? makePendingRecord(filename)),
      processing_status: 'processing',
      processing_error: null
    }
  }
  saveFacialStore(store)
}

export function saveFacialResult(
  studyId: string,
  filename: string,
  faceDetected: boolean,
  sexLabel: SexLabel,
  sexConfidence: number | null,
  metrics: Record<string, unknown>
): void {
  const store = getFacialStore()
  store.records[facialKey(studyId, filename)] = {
    filename,
    sex_label: sexLabel,
    sex_confidence: sexConfidence,
    face_detected: faceDetected,
    facial_metrics_json: metrics,
    processing_status: 'done',
    processing_error: null,
    processed_at: new Date().toISOString()
  }
  saveFacialStore(store)
}

export function saveFacialError(studyId: string, filename: string, error: string): void {
  const store = getFacialStore()
  const key = facialKey(studyId, filename)
  const existing = store.records[key] ?? makePendingRecord(filename)
  store.records[key] = {
    ...existing,
    processing_status: 'error',
    processing_error: error,
    processed_at: new Date().toISOString()
  }
  saveFacialStore(store)
}

export function resetFacialRecord(studyId: string, filename: string): void {
  const store = getFacialStore()
  store.records[facialKey(studyId, filename)] = makePendingRecord(filename)
  saveFacialStore(store)
}

export function resetFacialRecords(studyId: string, filenames: string[]): void {
  const store = getFacialStore()
  for (const filename of filenames) {
    const key = facialKey(studyId, filename)
    if (store.records[key]) {
      store.records[key] = makePendingRecord(filename)
    }
  }
  saveFacialStore(store)
}

/**
 * Ensure every filename in the image list has at least a pending record.
 * Returns the number of newly inserted records.
 */
export function ensureFacialRecords(studyId: string, imageList: string[]): number {
  const store = getFacialStore()
  let added = 0
  for (const filename of imageList) {
    const key = facialKey(studyId, filename)
    if (!store.records[key]) {
      store.records[key] = makePendingRecord(filename)
      added++
    }
  }
  if (added > 0) saveFacialStore(store)
  return added
}

// ---------------------------------------------------------------------------
// Data browser mutations
// ---------------------------------------------------------------------------

/** Remove ratings for the given images from all profiles of a study. */
export function deleteRatingsForImages(studyId: string, filenames: string[]): void {
  const data = getProfilesData()
  const set = new Set(filenames)
  for (const profile of data.profiles) {
    if (profile.studyId !== studyId) continue
    for (const fn of set) delete profile.ratings[fn]
  }
  saveProfilesData(data)
}

/** Overwrite a single rating value for a profile. */
export function updateRatingValue(profileId: string, filename: string, value: number): void {
  const data = getProfilesData()
  const profile = data.profiles.find((p) => p.id === profileId)
  if (!profile) return
  profile.ratings[filename] = value
  saveProfilesData(data)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makePendingRecord(filename: string): FacialData {
  return {
    filename,
    sex_label: 'unknown',
    sex_confidence: null,
    face_detected: false,
    facial_metrics_json: {},
    processing_status: 'pending',
    processing_error: null,
    processed_at: null
  }
}

export type { ProcessingStatus, SexLabel, FacialData, FacialDataStore }
