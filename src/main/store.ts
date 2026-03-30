import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type { AppSettings, Profile, ProfilesData, StudyState } from '../shared/types'

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
