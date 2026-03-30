import { useState, useEffect, useRef } from 'react'
import type { Profile, Study } from '../types'

interface Props {
  study: Study
  onSelectProfile: (profile: Profile) => void
  onBack: () => void
}

export default function ProfileScreen({ study, onSelectProfile, onBack }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const newNameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.getProfiles(study.id).then(setProfiles)
  }, [study.id])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    const profile = await window.api.createProfile(study.id, name)
    setProfiles((prev) => [...prev, profile])
    setNewName('')
    newNameRef.current?.focus()
  }

  async function handleRename(id: string) {
    const name = renameValue.trim()
    if (!name) return
    await window.api.renameProfile(id, name)
    setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))
    setRenamingId(null)
  }

  async function handleDelete(id: string) {
    await window.api.deleteProfile(id)
    setProfiles((prev) => prev.filter((p) => p.id !== id))
    setDeletingId(null)
  }

  function progressFor(profile: Profile): { rated: number; total: number; pct: number } {
    const total = study.imageList.length
    const rated = Object.keys(profile.ratings).length
    const pct = total > 0 ? Math.round((rated / total) * 100) : 0
    return { rated, total, pct }
  }

  const hasImages = study.imageList.length > 0

  return (
    <div className="profile-screen">
      <div className="profile-header">
        <button className="btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={onBack}>
          ← Studies
        </button>
        <h1>{study.name}</h1>
        <p className="study-info">
          {study.imageList.length} image{study.imageList.length !== 1 ? 's' : ''} · Select a participant to begin rating
        </p>
        {!hasImages && (
          <div className="warn-banner">
            No images found in this study. Rescan the image directory from the Studies screen.
          </div>
        )}
      </div>

      <div className="profile-list">
        {profiles.length === 0 && (
          <p className="empty-hint">No participants yet. Create one below.</p>
        )}
        {profiles.map((profile) => {
          const { rated, total, pct } = progressFor(profile)
          const isDone = total > 0 && rated >= total

          return (
            <div key={profile.id} className={`profile-card${isDone ? ' done' : ''}`}>
              {renamingId === profile.id ? (
                <form
                  className="rename-form"
                  onSubmit={(e) => { e.preventDefault(); handleRename(profile.id) }}
                >
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="input"
                  />
                  <button type="submit" className="btn btn-sm">Save</button>
                  <button type="button" className="btn-ghost btn-sm" onClick={() => setRenamingId(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <div className="profile-info">
                    <button
                      className="profile-name-btn"
                      onClick={() => onSelectProfile(profile)}
                      disabled={!hasImages}
                      title={!hasImages ? 'No images to rate' : undefined}
                    >
                      {profile.name}
                      {isDone && <span className="badge-done">Complete</span>}
                    </button>
                    <div className="profile-progress">
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="progress-label">
                        {rated}/{total} rated{total > 0 ? ` (${pct}%)` : ''}
                      </span>
                    </div>
                  </div>
                  <div className="profile-actions">
                    {deletingId === profile.id ? (
                      <>
                        <span className="danger-label">Delete?</span>
                        <button className="btn-danger btn-sm" onClick={() => handleDelete(profile.id)}>
                          Yes, delete
                        </button>
                        <button className="btn-ghost btn-sm" onClick={() => setDeletingId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => { setRenamingId(profile.id); setRenameValue(profile.name) }}
                        >
                          Rename
                        </button>
                        <button
                          className="btn-ghost btn-sm danger"
                          onClick={() => setDeletingId(profile.id)}
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>

      <form className="create-form" onSubmit={handleCreate}>
        <input
          ref={newNameRef}
          className="input"
          placeholder="New participant name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className="btn" disabled={!newName.trim()}>
          Add Participant
        </button>
      </form>
    </div>
  )
}
