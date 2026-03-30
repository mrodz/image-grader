import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type {
  AppSettings,
  Profile,
  ProfilesData,
  StudyState,
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

// --- Settings ---

const DEFAULT_SETTINGS: AppSettings = {
  inputDirectory: '',
  outputDirectory: app.getPath('documents')
}

export function getSettings(): AppSettings {
  return readJson<AppSettings>('settings.json', DEFAULT_SETTINGS)
}

export function saveSettings(settings: AppSettings): void {
  writeJson('settings.json', settings)
}

// --- Profiles ---

export function getProfilesData(): ProfilesData {
  return readJson<ProfilesData>('profiles.json', { profiles: [] })
}

export function saveProfilesData(data: ProfilesData): void {
  writeJson('profiles.json', data)
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

// --- Study State ---

export function getStudyState(): StudyState | null {
  return readJson<StudyState | null>('study.json', null)
}

export function saveStudyState(state: StudyState): void {
  writeJson('study.json', state)
}

// --- Facial Data ---

const FACIAL_STORE_FILE = 'facial.json'

const EMPTY_FACIAL_STORE: FacialDataStore = { records: {} }

export function getFacialStore(): FacialDataStore {
  return readJson<FacialDataStore>(FACIAL_STORE_FILE, EMPTY_FACIAL_STORE)
}

export function saveFacialStore(store: FacialDataStore): void {
  writeJson(FACIAL_STORE_FILE, store)
}

/** Return one FacialData record, or a default pending record if not yet seen. */
export function getFacialRecord(filename: string): FacialData {
  const store = getFacialStore()
  return store.records[filename] ?? makePendingRecord(filename)
}

/** Upsert a single FacialData record atomically. */
export function saveFacialRecord(record: FacialData): void {
  const store = getFacialStore()
  store.records[record.filename] = record
  saveFacialStore(store)
}

/** Mark a record as processing (clears prior error). */
export function markFacialProcessing(filename: string): void {
  const store = getFacialStore()
  const existing = store.records[filename] ?? makePendingRecord(filename)
  store.records[filename] = {
    ...existing,
    processing_status: 'processing',
    processing_error: null
  }
  saveFacialStore(store)
}

/** Write a successful result from the Python worker into the store. */
export function saveFacialResult(
  filename: string,
  faceDetected: boolean,
  sexLabel: SexLabel,
  sexConfidence: number | null,
  metrics: Record<string, unknown>
): void {
  const store = getFacialStore()
  store.records[filename] = {
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

/** Write an error result. */
export function saveFacialError(filename: string, error: string): void {
  const store = getFacialStore()
  const existing = store.records[filename] ?? makePendingRecord(filename)
  store.records[filename] = {
    ...existing,
    processing_status: 'error',
    processing_error: error,
    processed_at: new Date().toISOString()
  }
  saveFacialStore(store)
}

/** Reset a record back to pending so it can be reprocessed. */
export function resetFacialRecord(filename: string): void {
  const store = getFacialStore()
  store.records[filename] = makePendingRecord(filename)
  saveFacialStore(store)
}

/**
 * Ensure every filename in the image list has at least a pending record.
 * Returns the number of newly inserted records.
 */
export function ensureFacialRecords(imageList: string[]): number {
  const store = getFacialStore()
  let added = 0
  for (const filename of imageList) {
    if (!store.records[filename]) {
      store.records[filename] = makePendingRecord(filename)
      added++
    }
  }
  if (added > 0) saveFacialStore(store)
  return added
}

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
