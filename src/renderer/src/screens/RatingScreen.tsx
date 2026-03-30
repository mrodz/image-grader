import { useState, useEffect, useCallback, useRef } from 'react'
import type { Profile, AppSettings, StudyState } from '../types'

interface Props {
  profile: Profile
  settings: AppSettings
  study: StudyState
  onProfileUpdate: (profile: Profile) => void
  onExit: () => void
}

type LoadState = 'loading' | 'loaded' | 'missing' | 'error'

export default function RatingScreen({ profile, settings, study, onProfileUpdate, onExit }: Props) {
  const [localProfile, setLocalProfile] = useState<Profile>(profile)
  const [index, setIndex] = useState(profile.currentIndex)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [ratingInput, setRatingInput] = useState('')
  const [lastSaved, setLastSaved] = useState<{ filename: string; rating: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const imageList = study.imageList
  const total = imageList.length
  const filename = imageList[index] ?? null

  // Load image when index changes
  useEffect(() => {
    if (!filename) return
    setLoadState('loading')
    setImageUrl(null)
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
    // Allow empty, partial numbers while typing
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
