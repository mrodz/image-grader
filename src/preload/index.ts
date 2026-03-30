import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  Profile,
  StudyState,
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
  // Study
  // ---------------------------------------------------------------------------
  getStudyState: (): Promise<StudyState | null> => ipcRenderer.invoke('get-study-state'),
  rescanImages: (inputDirectory: string): Promise<StudyState> =>
    ipcRenderer.invoke('rescan-images', inputDirectory),
  getImageUrl: (inputDirectory: string, filename: string): Promise<string | null> =>
    ipcRenderer.invoke('get-image-url', inputDirectory, filename),

  // ---------------------------------------------------------------------------
  // Profiles
  // ---------------------------------------------------------------------------
  getProfiles: (): Promise<Profile[]> => ipcRenderer.invoke('get-profiles'),
  createProfile: (name: string): Promise<Profile> => ipcRenderer.invoke('create-profile', name),
  renameProfile: (id: string, name: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('rename-profile', id, name),
  deleteProfile: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('delete-profile', id),
  touchProfile: (id: string): Promise<void> => ipcRenderer.invoke('touch-profile', id),

  // ---------------------------------------------------------------------------
  // Rating
  // ---------------------------------------------------------------------------
  saveRating: (payload: RatingSavePayload): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('save-rating', payload),
  updateProfileIndex: (profileId: string, index: number): Promise<void> =>
    ipcRenderer.invoke('update-profile-index', profileId, index),

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  exportCsv: (
    outputDirectory: string
  ): Promise<{ ok: boolean; path?: string; longPath?: string; error?: string }> =>
    ipcRenderer.invoke('export-csv', outputDirectory),

  // ---------------------------------------------------------------------------
  // Facial analysis
  // ---------------------------------------------------------------------------

  /** Fetch the entire facial data store (filename → FacialData). */
  getFacialData: (): Promise<Record<string, FacialData>> =>
    ipcRenderer.invoke('get-facial-data'),

  /** Check whether the Python worker is alive and ready. */
  getWorkerStatus: (): Promise<{ ready: boolean }> =>
    ipcRenderer.invoke('get-worker-status'),

  /**
   * Process a single image and wait for the result.
   * Also emits a facial-progress event so any active batch listener updates.
   */
  processImage: (
    filename: string,
    filepath: string
  ): Promise<{ ok: boolean; data?: FacialData; error?: string }> =>
    ipcRenderer.invoke('process-image-facial', filename, filepath),

  /**
   * Kick off batch processing for many images.
   * Returns immediately; progress arrives via onFacialProgress events.
   */
  processBatch: (
    items: Array<{ filename: string; filepath: string }>
  ): Promise<{ ok: boolean; total?: number; error?: string }> =>
    ipcRenderer.invoke('process-batch-facial', items),

  /**
   * Reset a failed (or any) image back to pending and immediately reprocess.
   */
  reprocessImage: (
    filename: string,
    filepath: string
  ): Promise<{ ok: boolean; data?: FacialData; error?: string }> =>
    ipcRenderer.invoke('reprocess-image-facial', filename, filepath),

  // ---------------------------------------------------------------------------
  // Data browser mutations
  // ---------------------------------------------------------------------------

  /** Reset facial records back to pending (so they can be reprocessed later). */
  resetFacialData: (filenames: string[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('reset-facial-data', filenames),

  /** Delete ratings for the given images across all profiles. */
  deleteRatingsForImages: (filenames: string[]): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('delete-ratings-for-images', filenames),

  /** Overwrite a single rating value for a profile. */
  updateRatingValue: (profileId: string, filename: string, value: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('update-rating-value', { profileId, filename, value }),

  // ---------------------------------------------------------------------------
  // Facial analysis events (push from main → renderer)
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
