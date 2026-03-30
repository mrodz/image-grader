export interface AppSettings {
  inputDirectory: string
  outputDirectory: string
}

export interface Profile {
  id: string
  name: string
  createdAt: string
  lastActiveAt: string
  /** Index into StudyState.imageList — next image to rate */
  currentIndex: number
  /** filename (not path) → rating 1–100 */
  ratings: Record<string, number>
}

export interface StudyState {
  /** Ordered list of image filenames, consistent across all profiles */
  imageList: string[]
  /** The inputDirectory that produced this list */
  inputDirectory: string
  generatedAt: string
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
  filepath: string
  filename: string
  mean_rating: number | null
  n_raters: number
  [participantCol: string]: string | number | null
}

// ---------------------------------------------------------------------------
// Facial analysis
// ---------------------------------------------------------------------------

export type SexLabel = 'male' | 'female' | 'unknown'

export type ProcessingStatus = 'pending' | 'processing' | 'done' | 'error'

export interface FacialData {
  /** Image filename (not full path) — matches keys in StudyState.imageList */
  filename: string
  sex_label: SexLabel
  sex_confidence: number | null
  face_detected: boolean
  /** Flattened facial metrics as returned by facial_analysis.FacialMetrics.to_dict() */
  facial_metrics_json: Record<string, unknown>
  processing_status: ProcessingStatus
  processing_error: string | null
  processed_at: string | null
}

export interface FacialDataStore {
  /** filename → FacialData */
  records: Record<string, FacialData>
}

export interface FacialProgressEvent {
  filename: string
  status: ProcessingStatus
  /** How many images have been completed (ok or error) in the current batch */
  completed: number
  /** Total images in the current batch */
  total: number
  /** Set when status === 'done' or 'error' */
  data?: Omit<FacialData, 'filename'>
}
