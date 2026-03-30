import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  Study,
  Profile,
  RatingSavePayload,
  FacialData,
  FacialProgressEvent
} from '../shared/types'

const api = {
  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: AppSettings): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('save-settings', settings),
  selectDirectory: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('select-directory', defaultPath),

  // ---------------------------------------------------------------------------
  // Studies
  // ---------------------------------------------------------------------------
  getStudies: (): Promise<Study[]> => ipcRenderer.invoke('get-studies'),
  createStudy: (name: string, inputDirectory: string): Promise<Study> =>
    ipcRenderer.invoke('create-study', { name, inputDirectory }),
  renameStudy: (id: string, name: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('rename-study', id, name),
  deleteStudy: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('delete-study', id),
  rescanStudy: (studyId: string): Promise<Study | null> =>
    ipcRenderer.invoke('rescan-study', studyId),

  // ---------------------------------------------------------------------------
  // Images
  // ---------------------------------------------------------------------------
  getImageUrl: (inputDirectory: string, filename: string): Promise<string | null> =>
    ipcRenderer.invoke('get-image-url', inputDirectory, filename),

  // ---------------------------------------------------------------------------
  // Profiles
  // ---------------------------------------------------------------------------
  getProfiles: (studyId: string): Promise<Profile[]> => ipcRenderer.invoke('get-profiles', studyId),
  createProfile: (studyId: string, name: string): Promise<Profile> =>
    ipcRenderer.invoke('create-profile', studyId, name),
  renameProfile: (id: string, name: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('rename-profile', id, name),
  deleteProfile: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('delete-profile', id),
  touchProfile: (id: string): Promise<void> => ipcRenderer.invoke('touch-profile', id),

  // ---------------------------------------------------------------------------
  // Ratings
  // ---------------------------------------------------------------------------
  saveRating: (payload: RatingSavePayload): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('save-rating', payload),
  updateProfileIndex: (profileId: string, index: number): Promise<void> =>
    ipcRenderer.invoke('update-profile-index', profileId, index),

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  exportCsv: (
    studyIds: string[],
    outputDirectory: string
  ): Promise<{ ok: boolean; path?: string; longPath?: string; error?: string }> =>
    ipcRenderer.invoke('export-csv', { studyIds, outputDirectory }),

  // ---------------------------------------------------------------------------
  // Facial analysis
  // ---------------------------------------------------------------------------
  getFacialData: (studyId: string): Promise<Record<string, FacialData>> =>
    ipcRenderer.invoke('get-facial-data', studyId),

  getWorkerStatus: (): Promise<{ ready: boolean }> => ipcRenderer.invoke('get-worker-status'),

  processImage: (
    studyId: string,
    filename: string,
    filepath: string
  ): Promise<{ ok: boolean; data?: FacialData; error?: string }> =>
    ipcRenderer.invoke('process-image-facial', studyId, filename, filepath),

  processBatch: (
    items: Array<{ studyId: string; filename: string; filepath: string }>
  ): Promise<{ ok: boolean; total?: number; error?: string }> =>
    ipcRenderer.invoke('process-batch-facial', items),

  reprocessImage: (
    studyId: string,
    filename: string,
    filepath: string
  ): Promise<{ ok: boolean; data?: FacialData; error?: string }> =>
    ipcRenderer.invoke('reprocess-image-facial', studyId, filename, filepath),

  // ---------------------------------------------------------------------------
  // Data browser mutations
  // ---------------------------------------------------------------------------
  resetFacialData: (studyId: string, filenames: string[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('reset-facial-data', studyId, filenames),

  deleteRatingsForImages: (studyId: string, filenames: string[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('delete-ratings-for-images', studyId, filenames),

  updateRatingValue: (profileId: string, filename: string, value: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('update-rating-value', { profileId, filename, value }),

  // ---------------------------------------------------------------------------
  // Facial analysis events
  // ---------------------------------------------------------------------------
  onFacialProgress: (callback: (event: FacialProgressEvent) => void): void => {
    ipcRenderer.on('facial-progress', (_e, data: FacialProgressEvent) => callback(data))
  },
  offFacialProgress: (): void => {
    ipcRenderer.removeAllListeners('facial-progress')
  },
  onFacialBatchComplete: (callback: (result: { total: number; completed: number }) => void): void => {
    ipcRenderer.on('facial-batch-complete', (_e, data) => callback(data))
  },
  offFacialBatchComplete: (): void => {
    ipcRenderer.removeAllListeners('facial-batch-complete')
  },
  onWorkerReady: (callback: () => void): void => {
    ipcRenderer.on('facial-worker-ready', () => callback())
  },
  offWorkerReady: (): void => {
    ipcRenderer.removeAllListeners('facial-worker-ready')
  }
}

contextBridge.exposeInMainWorld('api', api)

export type API = typeof api
