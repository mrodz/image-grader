import { useState, useEffect } from 'react'
import type { Profile, AppSettings, StudyState, Screen, FacialData, FacialProgressEvent } from './types'
import ProfileScreen from './screens/ProfileScreen'
import RatingScreen from './screens/RatingScreen'
import SettingsScreen from './screens/SettingsScreen'
import { useWorkerStatus } from './useWorkerStatus'

export default function App() {
  const [screen, setScreen] = useState<Screen>('profiles')
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [study, setStudy] = useState<StudyState | null>(null)
  const [facialData, setFacialData] = useState<Record<string, FacialData>>({})
  const workerReady = useWorkerStatus()

  // Initial data load
  useEffect(() => {
    Promise.all([
      window.api.getSettings(),
      window.api.getStudyState(),
      window.api.getFacialData(),
    ]).then(([s, st, fd]) => {
      setSettings(s)
      setStudy(st)
      setFacialData(fd)
    })
  }, [])

  // Subscribe to facial analysis progress events
  useEffect(() => {
    window.api.onFacialProgress((event: FacialProgressEvent) => {
      if (event.data) {
        setFacialData((prev) => ({
          ...prev,
          [event.filename]: { filename: event.filename, ...event.data! }
        }))
      } else {
        // Mark as processing in local state immediately
        setFacialData((prev) => {
          const existing = prev[event.filename]
          if (!existing) return prev
          return {
            ...prev,
            [event.filename]: { ...existing, processing_status: event.status }
          }
        })
      }
    })

    return () => {
      window.api.offFacialProgress()
      window.api.offWorkerReady()
    }
  }, [])

  async function refreshStudy() {
    const st = await window.api.getStudyState()
    setStudy(st)
  }

  async function refreshSettings() {
    const s = await window.api.getSettings()
    setSettings(s)
  }

  function handleSelectProfile(profile: Profile) {
    setActiveProfile(profile)
    window.api.touchProfile(profile.id)
    setScreen('rating')
  }

  function handleExitRating() {
    setActiveProfile(null)
    setScreen('profiles')
  }

  if (!settings) {
    return (
      <div className="loading">
        <span>Loading…</span>
      </div>
    )
  }

  return (
    <div className="app">
      <nav className="topbar">
        <span className="topbar-title">ImageGrader</span>
        <div className="topbar-actions">
          {activeProfile && screen === 'rating' && (
            <span className="topbar-participant">
              <span className="dot" />
              {activeProfile.name}
            </span>
          )}
          {screen !== 'settings' && (
            <button className="btn-ghost" onClick={() => setScreen('settings')}>
              Settings
            </button>
          )}
          {screen === 'settings' && (
            <button className="btn-ghost" onClick={() => setScreen(activeProfile ? 'rating' : 'profiles')}>
              ← Back
            </button>
          )}
        </div>
      </nav>

      <main className="content">
        {screen === 'profiles' && (
          <ProfileScreen
            settings={settings}
            study={study}
            onSelectProfile={handleSelectProfile}
            onGoSettings={() => setScreen('settings')}
          />
        )}
        {screen === 'rating' && activeProfile && settings && study && (
          <RatingScreen
            profile={activeProfile}
            settings={settings}
            study={study}
            facialData={facialData}
            workerReady={workerReady}
            onProfileUpdate={(p) => setActiveProfile(p)}
            onExit={handleExitRating}
          />
        )}
        {screen === 'rating' && activeProfile && (!settings.inputDirectory || !study) && (
          <div className="center-message">
            <p>No image directory configured.</p>
            <button className="btn" onClick={() => setScreen('settings')}>
              Open Settings
            </button>
          </div>
        )}
        {screen === 'settings' && (
          <SettingsScreen
            settings={settings}
            study={study}
            facialData={facialData}
            workerReady={workerReady}
            onSettingsChange={(s) => {
              setSettings(s)
              refreshSettings()
            }}
            onStudyChange={(st) => {
              setStudy(st)
              refreshStudy()
            }}
            onFacialDataChange={setFacialData}
          />
        )}
      </main>
    </div>
  )
}
