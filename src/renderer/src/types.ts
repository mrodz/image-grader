import type { API } from '../../preload/index'

declare global {
  interface Window {
    api: API
  }
}

export type {
  AppSettings,
  Study,
  StudiesData,
  Profile,
  RatingSavePayload,
  FacialData,
  FacialProgressEvent,
  SexLabel,
  ProcessingStatus
} from '../../shared/types'

export type Screen = 'studies' | 'profiles' | 'rating' | 'settings' | 'data'
