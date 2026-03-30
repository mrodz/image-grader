export interface AppSettings {
  outputDirectory: string
}

// ---------------------------------------------------------------------------
// Study (replaces the old global StudyState)
// ---------------------------------------------------------------------------

export interface Study {
  id: string
  name: string
  inputDirectory: string
  imageList: string[]
  /** ISO timestamp of last rescan */
  generatedAt: string
  /** ISO timestamp of creation — never changes */
  createdAt: string
}

export interface StudiesData {
  studies: Study[]
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export interface Profile {
  id: string
  /** Which study this participant belongs to */
  studyId: string
  name: string
  createdAt: string
  lastActiveAt: string
  /** Index into Study.imageList — next image to rate */
  currentIndex: number
  /** filename → rating 1–100 */
  ratings: Record<string, number>
}

export interface ProfilesData {
  profiles: Profile[]
}

// IPC payload types
export interface RatingSavePayload {
  profileId: string
  filename: string
  rating: number
  newIndex: number
}

export interface ExportRow {
  study_id: string
  study_name: string
  filepath: string
  filename: string
  mean_rating: number | null
  n_raters: number
  [col: string]: string | number | null
}

// ---------------------------------------------------------------------------
// Facial analysis
// ---------------------------------------------------------------------------

export type SexLabel = 'male' | 'female' | 'unknown'

export type ProcessingStatus = 'pending' | 'processing' | 'done' | 'error'

export interface FacialData {
  /** Image filename (not full path) */
  filename: string
  sex_label: SexLabel
  sex_confidence: number | null
  face_detected: boolean
  facial_metrics_json: Record<string, unknown>
  processing_status: ProcessingStatus
  processing_error: string | null
  processed_at: string | null
}

export interface FacialDataStore {
  /**
   * Key format: "studyId:filename"
   * This ensures no collision when two studies share a filename.
   */
  records: Record<string, FacialData>
}

export interface FacialProgressEvent {
  filename: string
  status: ProcessingStatus
  completed: number
  total: number
  data?: Omit<FacialData, 'filename'>
}
