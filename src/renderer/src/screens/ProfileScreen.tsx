import { useState, useEffect, useRef, useMemo } from 'react'
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

  const histData = useMemo(
    () => computeHistogramData(study.imageList, profiles),
    [study.imageList, profiles]
  )

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

      {/* Histogram — shown once at least one image has been rated by anyone */}
      {histData.ratedCount > 0 && (
        <div className="hist-section">
          <div className="hist-header">
            <span className="hist-title">Mean Score Distribution</span>
            <span className="hist-subtitle">
              {histData.ratedCount} / {study.imageList.length} images rated
              {histData.overallMean !== null && ` · avg ${histData.overallMean.toFixed(1)}`}
              {histData.sdMean !== null && ` · sd ${histData.sdMean.toFixed(1)}`}
            </span>
          </div>
          <RatingHistogram data={histData} />
        </div>
      )}

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

// ---------------------------------------------------------------------------
// Histogram data
// ---------------------------------------------------------------------------

const NUM_BINS = 10

interface HistogramData {
  /** Count of images per bin (index 0 = scores 1–10, …, 9 = scores 91–100) */
  bins: number[]
  ratedCount: number
  overallMean: number | null
  sdMean: number | null
  /** Per-image means, used for mean-line positioning */
  means: number[]
}

function computeHistogramData(imageList: string[], profiles: Profile[]): HistogramData {
  const bins = new Array<number>(NUM_BINS).fill(0)
  const means: number[] = []

  for (const filename of imageList) {
    const ratings = profiles
      .map((p) => p.ratings[filename])
      .filter((r): r is number => r !== undefined)
    if (ratings.length === 0) continue
    const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length
    means.push(mean)
    // Bin: mean 1–10 → 0, 11–20 → 1, …, 91–100 → 9
    const idx = Math.min(Math.floor((mean - 1) / 10), NUM_BINS - 1)
    bins[Math.max(0, idx)]++
  }

  if (means.length === 0) return { bins, ratedCount: 0, overallMean: null, sdMean: null, means }

  const overallMean = means.reduce((a, b) => a + b, 0) / means.length
  const variance = means.reduce((a, b) => a + (b - overallMean) ** 2, 0) / means.length
  const sdMean = Math.sqrt(variance)

  return { bins, ratedCount: means.length, overallMean, sdMean, means }
}

// ---------------------------------------------------------------------------
// SVG Histogram component
// ---------------------------------------------------------------------------

const W = 520
const H = 160
const PAD = { top: 14, right: 16, bottom: 34, left: 38 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom
const BAR_GAP = 3

function RatingHistogram({ data }: { data: HistogramData }) {
  const { bins, overallMean } = data
  const maxCount = Math.max(...bins, 1)
  const yTicks = niceYTicks(maxCount)

  const barSlotW = PLOT_W / NUM_BINS
  const barW = barSlotW - BAR_GAP

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="hist-svg"
      aria-label="Mean score distribution histogram"
    >
      {/* Gridlines + Y-axis labels */}
      {yTicks.map((v) => {
        const y = PAD.top + PLOT_H - (v / maxCount) * PLOT_H
        return (
          <g key={v}>
            <line
              x1={PAD.left} y1={y}
              x2={PAD.left + PLOT_W} y2={y}
              className="hist-grid"
            />
            <text x={PAD.left - 5} y={y + 3.5} className="hist-axis-label" textAnchor="end">
              {v}
            </text>
          </g>
        )
      })}

      {/* Bars */}
      {bins.map((count, i) => {
        const x = PAD.left + i * barSlotW + BAR_GAP / 2
        const barH = (count / maxCount) * PLOT_H
        const y = PAD.top + PLOT_H - barH
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} className="hist-bar" rx={2} ry={2} />
            {count > 0 && barH > 14 && (
              <text x={x + barW / 2} y={y + 11} className="hist-bar-count" textAnchor="middle">
                {count}
              </text>
            )}
            {count > 0 && barH <= 14 && (
              <text x={x + barW / 2} y={y - 3} className="hist-bar-count" textAnchor="middle">
                {count}
              </text>
            )}
          </g>
        )
      })}

      {/* X-axis labels (upper bound of each bin) */}
      {bins.map((_, i) => {
        const x = PAD.left + i * barSlotW + barSlotW / 2
        return (
          <text key={i} x={x} y={PAD.top + PLOT_H + 14} className="hist-axis-label" textAnchor="middle">
            {(i + 1) * 10}
          </text>
        )
      })}

      {/* Overall mean line */}
      {overallMean !== null && (
        <>
          <line
            x1={PAD.left + ((overallMean - 1) / 99) * PLOT_W}
            y1={PAD.top}
            x2={PAD.left + ((overallMean - 1) / 99) * PLOT_W}
            y2={PAD.top + PLOT_H}
            className="hist-mean-line"
          />
          <text
            x={PAD.left + ((overallMean - 1) / 99) * PLOT_W + 4}
            y={PAD.top + 10}
            className="hist-mean-label"
          >
            {overallMean.toFixed(1)}
          </text>
        </>
      )}

      {/* Axes */}
      <line
        x1={PAD.left} y1={PAD.top + PLOT_H}
        x2={PAD.left + PLOT_W} y2={PAD.top + PLOT_H}
        className="hist-axis-line"
      />
    </svg>
  )
}

function niceYTicks(max: number): number[] {
  if (max <= 0) return [0]
  if (max <= 5) return Array.from({ length: max + 1 }, (_, i) => i)
  const step = Math.ceil(max / 4)
  const ticks: number[] = []
  for (let v = 0; v <= max; v += step) ticks.push(v)
  if (ticks[ticks.length - 1] < max) ticks.push(max)
  return ticks
}
