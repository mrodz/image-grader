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
