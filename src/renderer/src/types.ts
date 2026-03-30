// Re-export shared types for renderer use and declare the window.api shape
import type { API } from '../../preload/index'

declare global {
  interface Window {
    api: API
  }
}

export type {
  AppSettings,
  Profile,
  StudyState,
  RatingSavePayload,
  FacialData,
  FacialProgressEvent,
  SexLabel,
  ProcessingStatus
} from '../../shared/types'

export type Screen = 'profiles' | 'rating' | 'settings'
