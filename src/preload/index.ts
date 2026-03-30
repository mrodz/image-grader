import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, Profile, StudyState, RatingSavePayload } from '../shared/types'

const api = {
  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: AppSettings): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('save-settings', settings),
  selectDirectory: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('select-directory', defaultPath),

  // Study
  getStudyState: (): Promise<StudyState | null> => ipcRenderer.invoke('get-study-state'),
  rescanImages: (inputDirectory: string): Promise<StudyState> =>
    ipcRenderer.invoke('rescan-images', inputDirectory),
  getImageUrl: (inputDirectory: string, filename: string): Promise<string | null> =>
    ipcRenderer.invoke('get-image-url', inputDirectory, filename),

  // Profiles
  getProfiles: (): Promise<Profile[]> => ipcRenderer.invoke('get-profiles'),
  createProfile: (name: string): Promise<Profile> => ipcRenderer.invoke('create-profile', name),
  renameProfile: (id: string, name: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('rename-profile', id, name),
  deleteProfile: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('delete-profile', id),
  touchProfile: (id: string): Promise<void> => ipcRenderer.invoke('touch-profile', id),

  // Rating
  saveRating: (payload: RatingSavePayload): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('save-rating', payload),
  updateProfileIndex: (profileId: string, index: number): Promise<void> =>
    ipcRenderer.invoke('update-profile-index', profileId, index),

  // Export
  exportCsv: (outputDirectory: string): Promise<{ ok: boolean; path?: string; longPath?: string; error?: string }> =>
    ipcRenderer.invoke('export-csv', outputDirectory)
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
