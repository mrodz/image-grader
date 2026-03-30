import { useState, useEffect } from 'react'
import type { Study, Profile, AppSettings, Screen, FacialData, FacialProgressEvent } from './types'
import StudiesScreen from './screens/StudiesScreen'
import ProfileScreen from './screens/ProfileScreen'
import RatingScreen from './screens/RatingScreen'
import SettingsScreen from './screens/SettingsScreen'
import DataBrowserScreen from './screens/DataBrowserScreen'
import { useWorkerStatus } from './useWorkerStatus'

export default function App() {
  const [screen, setScreen] = useState<Screen>('studies')
  const [prevScreen, setPrevScreen] = useState<Screen>('studies')
  const [activeStudy, setActiveStudy] = useState<Study | null>(null)
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [facialData, setFacialData] = useState<Record<string, FacialData>>({})
  const workerReady = useWorkerStatus()

  // Load global settings on mount
  useEffect(() => {
    window.api.getSettings().then(setSettings)
  }, [])

  // Reload facial data when active study changes
  useEffect(() => {
    if (!activeStudy) {
      setFacialData({})
      return
    }
    window.api.getFacialData(activeStudy.id).then(setFacialData)
  }, [activeStudy?.id])

  // Subscribe to facial analysis progress events
  useEffect(() => {
    window.api.onFacialProgress((event: FacialProgressEvent) => {
      if (event.data) {
        setFacialData((prev) => ({
          ...prev,
          [event.filename]: { filename: event.filename, ...event.data! }
        }))
      } else {
        setFacialData((prev) => {
          const existing = prev[event.filename]
          if (!existing) return prev
          return { ...prev, [event.filename]: { ...existing, processing_status: event.status } }
        })
      }
    })

    return () => {
      window.api.offFacialProgress()
      window.api.offWorkerReady()
    }
  }, [])

  function navigate(to: Screen) {
    setPrevScreen(screen)
    setScreen(to)
  }

  function handleBack() {
    if (screen === 'settings' || screen === 'data') {
      setScreen(prevScreen === 'rating' && activeProfile ? 'rating' : activeStudy ? 'profiles' : 'studies')
    } else if (screen === 'profiles') {
      setActiveStudy(null)
      setScreen('studies')
    } else if (screen === 'rating') {
      setActiveProfile(null)
      setScreen('profiles')
    } else {
      setScreen('studies')
    }
  }

  function handleSelectStudy(study: Study) {
    setActiveStudy(study)
    setScreen('profiles')
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

  const onNonRootScreen = screen !== 'studies'
  const onAuxScreen = screen === 'settings' || screen === 'data'

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
          {activeStudy && screen !== 'studies' && screen !== 'settings' && screen !== 'data' && (
            <span className="topbar-study-label">{activeStudy.name}</span>
          )}
          {!onAuxScreen && onNonRootScreen && (
            <>
              <button className="btn-ghost" onClick={() => navigate('data')}>Data</button>
              <button className="btn-ghost" onClick={() => navigate('settings')}>Settings</button>
            </>
          )}
          {onAuxScreen && (
            <button className="btn-ghost" onClick={handleBack}>← Back</button>
          )}
        </div>
      </nav>

      <main className="content">
        {screen === 'studies' && (
          <StudiesScreen
            settings={settings}
            onSelectStudy={handleSelectStudy}
            onGoSettings={() => navigate('settings')}
          />
        )}

        {screen === 'profiles' && activeStudy && (
          <ProfileScreen
            study={activeStudy}
            onSelectProfile={handleSelectProfile}
            onBack={() => { setActiveStudy(null); setScreen('studies') }}
          />
        )}

        {screen === 'rating' && activeProfile && activeStudy && (
          <RatingScreen
            profile={activeProfile}
            study={activeStudy}
            facialData={facialData}
            workerReady={workerReady}
            onProfileUpdate={(p) => setActiveProfile(p)}
            onExit={handleExitRating}
          />
        )}

        {screen === 'settings' && (
          <SettingsScreen
            settings={settings}
            activeStudy={activeStudy}
            facialData={facialData}
            workerReady={workerReady}
            onSettingsChange={(s) => { setSettings(s); window.api.getSettings().then(setSettings) }}
            onFacialDataChange={setFacialData}
          />
        )}

        {screen === 'data' && (
          <DataBrowserScreen
            study={activeStudy}
            facialData={facialData}
            workerReady={workerReady}
            onFacialDataChange={setFacialData}
          />
        )}
      </main>
    </div>
  )
}
