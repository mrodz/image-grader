import { useState, useEffect, useCallback, useRef } from 'react'
import type { Profile, AppSettings, StudyState, FacialData } from '../types'

interface Props {
  profile: Profile
  settings: AppSettings
  study: StudyState
  facialData: Record<string, FacialData>
  workerReady: boolean
  onProfileUpdate: (profile: Profile) => void
  onExit: () => void
}

type LoadState = 'loading' | 'loaded' | 'missing' | 'error'

export default function RatingScreen({
  profile,
  settings,
  study,
  facialData,
  workerReady,
  onProfileUpdate,
  onExit
}: Props) {
  const [localProfile, setLocalProfile] = useState<Profile>(profile)
  const [index, setIndex] = useState(profile.currentIndex)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [ratingInput, setRatingInput] = useState('')
  const [lastSaved, setLastSaved] = useState<{ filename: string; rating: number } | null>(null)
  const [analyzingThis, setAnalyzingThis] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const imageList = study.imageList
  const total = imageList.length
  const filename = imageList[index] ?? null

  // Load image when index changes
  useEffect(() => {
    if (!filename) return
    setLoadState('loading')
    setImageUrl(null)
    setAnalyzingThis(false)
    // Pre-fill with existing rating if navigating back
    const existing = localProfile.ratings[filename]
    setRatingInput(existing !== undefined ? String(existing) : '')

    window.api.getImageUrl(settings.inputDirectory, filename).then((url) => {
      if (!url) {
        setLoadState('missing')
      } else {
        setImageUrl(url)
        setLoadState('loaded')
      }
    })
    // Focus input
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [index, filename])

  const currentRating = localProfile.ratings[filename ?? '']
  const ratedCount = Object.keys(localProfile.ratings).length
  const remaining = total - ratedCount
  const pct = total > 0 ? Math.round((ratedCount / total) * 100) : 0

  const navigateTo = useCallback(
    async (newIndex: number) => {
      const clamped = Math.max(0, Math.min(total - 1, newIndex))
      setIndex(clamped)
      await window.api.updateProfileIndex(localProfile.id, clamped)
    },
    [total, localProfile.id]
  )

  async function submitRating() {
    const raw = ratingInput.trim()
    if (!raw || !filename) return
    const num = parseInt(raw, 10)
    if (isNaN(num) || num < 1 || num > 100) return

    const nextIndex = index + 1 < total ? index + 1 : index
    const updatedProfile: Profile = {
      ...localProfile,
      ratings: { ...localProfile.ratings, [filename]: num },
      currentIndex: nextIndex
    }

    await window.api.saveRating({
      profileId: localProfile.id,
      filename,
      rating: num,
      newIndex: nextIndex
    })

    setLocalProfile(updatedProfile)
    onProfileUpdate(updatedProfile)
    setLastSaved({ filename, rating: num })

    if (nextIndex !== index) {
      setIndex(nextIndex)
    } else {
      setRatingInput(String(num))
    }
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  async function handleAnalyzeThis() {
    if (!filename || !workerReady || analyzingThis) return
    setAnalyzingThis(true)
    const filepath = `${settings.inputDirectory}/${filename}`
    await window.api.processImage(filename, filepath)
    setAnalyzingThis(false)
    inputRef.current?.focus()
  }

  async function handleReprocessThis() {
    if (!filename || !workerReady || analyzingThis) return
    setAnalyzingThis(true)
    const filepath = `${settings.inputDirectory}/${filename}`
    await window.api.reprocessImage(filename, filepath)
    setAnalyzingThis(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitRating()
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      navigateTo(index - 1)
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      navigateTo(index + 1)
    }
  }

  function validateInput(value: string): string {
    if (value === '') return ''
    const num = parseInt(value, 10)
    if (isNaN(num)) return ratingInput
    if (num > 100) return '100'
    return String(num)
  }

  const isComplete = total > 0 && ratedCount >= total

  if (total === 0) {
    return (
      <div className="center-message">
        <p>No images in study. Add images and rescan in Settings.</p>
        <button className="btn" onClick={onExit}>
          Back to Profiles
        </button>
      </div>
    )
  }

  if (isComplete) {
    return (
      <div className="complete-screen">
        <div className="complete-card">
          <div className="complete-icon">✓</div>
          <h2>All images rated!</h2>
          <p>
            {localProfile.name} has rated all {total} images.
          </p>
          <div className="complete-actions">
            <button className="btn-ghost" onClick={() => navigateTo(0)}>
              Review from start
            </button>
            <button className="btn" onClick={onExit}>
              Back to Profiles
            </button>
          </div>
        </div>
      </div>
    )
  }

  const inputNum = parseInt(ratingInput, 10)
  const isValidRating = !isNaN(inputNum) && inputNum >= 1 && inputNum <= 100

  // Current image's facial data
  const fd = filename ? facialData[filename] : null

  if (fd?.processing_status === 'pending') {
    handleAnalyzeThis()
  }

  return (
    <div className="rating-screen">
      {/* Progress bar */}
      <div className="rating-topbar">
        <button className="btn-ghost btn-sm" onClick={onExit}>
          ← Profiles
        </button>
        <div className="rating-progress-wrap">
          <div className="rating-progress-bar">
            <div className="rating-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="rating-progress-label">
            {ratedCount}/{total} rated · {remaining} remaining
          </span>
        </div>
        <span className="rating-nav-label">
          Viewing {index + 1} of {total}
        </span>
      </div>

      {/* Image area */}
      <div className="image-area">
        {loadState === 'loading' && (
          <div className="image-placeholder">Loading…</div>
        )}
        {loadState === 'missing' && (
          <div className="image-placeholder missing">
            <span>Image not found</span>
            <small>{filename}</small>
          </div>
        )}
        {loadState === 'loaded' && imageUrl && (
          <img
            src={imageUrl}
            alt={filename ?? ''}
            className="image-display"
            onLoad={() => setLoadState('loaded')}
            onError={() => setLoadState('error')}
          />
        )}
      </div>

      {/* Rating controls */}
      <div className="rating-controls">
        <div className="rating-filename">{filename}</div>

        {/* Face analysis badge */}
        <FaceAnalysisBadge
          data={fd}
          workerReady={workerReady}
          analyzing={analyzingThis}
          onAnalyze={handleAnalyzeThis}
          onReprocess={handleReprocessThis}
        />

        <div className="rating-row">
          <button
            className="btn-ghost nav-btn"
            onClick={() => navigateTo(index - 1)}
            disabled={index === 0}
            title="Previous (←)"
          >
            ←
          </button>

          <div className="rating-input-group">
            <label className="rating-label">Rating (1–100)</label>
            <input
              ref={inputRef}
              className={`rating-input${isValidRating ? ' valid' : ''}${ratingInput && !isValidRating ? ' invalid' : ''}`}
              type="number"
              min={1}
              max={100}
              value={ratingInput}
              onChange={(e) => setRatingInput(validateInput(e.target.value))}
              onKeyDown={handleKeyDown}
              placeholder="—"
            />
            <button
              className="btn submit-btn"
              onClick={submitRating}
              disabled={!isValidRating}
              title="Submit rating (Enter)"
            >
              {currentRating !== undefined && currentRating === inputNum ? 'Saved' : index + 1 < total ? 'Rate & Next' : 'Save Rating'}
            </button>
          </div>

          <button
            className="btn-ghost nav-btn"
            onClick={() => navigateTo(index + 1)}
            disabled={index >= total - 1}
            title="Next (→)"
          >
            →
          </button>
        </div>

        {currentRating !== undefined && (
          <div className="existing-rating">
            Current saved rating: <strong>{currentRating}</strong>
          </div>
        )}
        {lastSaved && lastSaved.filename === filename && (
          <div className="save-confirm">Saved {lastSaved.rating}</div>
        )}

        <div className="keyboard-hint">
          Enter to submit · ← → to navigate
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Face analysis badge sub-component
// ---------------------------------------------------------------------------

interface BadgeProps {
  data: FacialData | null | undefined
  workerReady: boolean
  analyzing: boolean
  onAnalyze: () => void
  onReprocess: () => void
}

function FaceAnalysisBadge({ data, workerReady, analyzing, onAnalyze, onReprocess }: BadgeProps) {
  if (analyzing || data?.processing_status === 'processing') {
    return (
      <div className="face-badge face-badge-processing">
        <span className="face-badge-dot face-badge-dot-processing" />
        Analyzing…
      </div>
    )
  }

  if (!data || data.processing_status === 'pending') {
    return (
      <div className="face-badge face-badge-pending">
        <span className="face-badge-dot" />
        Not yet analyzed
        {workerReady && (
          <button className="face-badge-action" onClick={onAnalyze}>
            Analyze
          </button>
        )}
      </div>
    )
  }

  if (data.processing_status === 'error') {
    return (
      <div className="face-badge face-badge-error" title={data.processing_error ?? undefined}>
        <span className="face-badge-dot face-badge-dot-error" />
        Analysis failed
        {workerReady && (
          <button className="face-badge-action" onClick={onReprocess}>
            Retry
          </button>
        )}
      </div>
    )
  }

  // done
  const sexIcon = data.sex_label === 'male' ? 'M' : data.sex_label === 'female' ? 'F' : '?'
  const sexClass =
    data.sex_label === 'male'
      ? 'face-badge-sex-male'
      : data.sex_label === 'female'
        ? 'face-badge-sex-female'
        : 'face-badge-sex-unknown'

  return (
    <div className="face-badge face-badge-done">
      <span className={`face-badge-sex ${sexClass}`}>{sexIcon}</span>
      <span className="face-badge-label">
        {data.sex_label.charAt(0).toUpperCase() + data.sex_label.slice(1)}
        {data.sex_confidence != null && (
          <span className="face-badge-conf"> {Math.round(data.sex_confidence * 100)}%</span>
        )}
      </span>
      <span className="face-badge-sep">·</span>
      <span className={data.face_detected ? 'face-badge-detected' : 'face-badge-noface'}>
        {data.face_detected ? 'Face detected' : 'No face'}
      </span>
      {workerReady && (
        <button className="face-badge-action face-badge-reprocess" onClick={onReprocess}>
          Reprocess
        </button>
      )}
    </div>
  )
}
