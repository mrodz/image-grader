import { useState, useEffect } from 'react'
import type { Profile, Study, FacialData } from '../types'

type Filter = 'all' | 'rated' | 'unrated' | 'face-done' | 'face-pending' | 'face-error'

interface EditCell {
  filename: string
  profileId: string
  draft: string
}

interface Props {
  study: Study | null
  facialData: Record<string, FacialData>
  workerReady: boolean
  onFacialDataChange: (data: Record<string, FacialData>) => void
}

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'rated', label: 'Rated' },
  { id: 'unrated', label: 'Unrated' },
  { id: 'face-done', label: 'Face Done' },
  { id: 'face-pending', label: 'Pending' },
  { id: 'face-error', label: 'Error' }
]

export default function DataBrowserScreen({ study, facialData, workerReady, onFacialDataChange }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editCell, setEditCell] = useState<EditCell | null>(null)
  const [busy, setBusy] = useState(false)

  const images = study?.imageList ?? []

  useEffect(() => {
    if (!study) return
    window.api.getProfiles(study.id).then(setProfiles)
  }, [study?.id])

  const filteredImages = images.filter((filename) => {
    if (search && !filename.toLowerCase().includes(search.toLowerCase())) return false
    const fd = facialData[filename]
    switch (filter) {
      case 'rated': return profiles.some((p) => p.ratings[filename] !== undefined)
      case 'unrated': return profiles.every((p) => p.ratings[filename] === undefined)
      case 'face-done': return fd?.processing_status === 'done'
      case 'face-pending': return !fd || fd.processing_status === 'pending'
      case 'face-error': return fd?.processing_status === 'error'
      default: return true
    }
  })

  const allSelected = filteredImages.length > 0 && filteredImages.every((f) => selected.has(f))
  const someSelected = filteredImages.some((f) => selected.has(f))
  const selectedInView = filteredImages.filter((f) => selected.has(f))

  function toggleAll() {
    if (allSelected) {
      setSelected((prev) => { const n = new Set(prev); filteredImages.forEach((f) => n.delete(f)); return n })
    } else {
      setSelected((prev) => { const n = new Set(prev); filteredImages.forEach((f) => n.add(f)); return n })
    }
  }

  function toggleOne(filename: string) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(filename)) n.delete(filename); else n.add(filename)
      return n
    })
  }

  async function handleResetFacial(filenames: string[]) {
    if (!study) return
    setBusy(true)
    await window.api.resetFacialData(study.id, filenames)
    const fresh = await window.api.getFacialData(study.id)
    onFacialDataChange(fresh)
    setSelected(new Set())
    setBusy(false)
  }

  async function handleDeleteRatings(filenames: string[]) {
    if (!study) return
    setBusy(true)
    await window.api.deleteRatingsForImages(study.id, filenames)
    const fresh = await window.api.getProfiles(study.id)
    setProfiles(fresh)
    setSelected(new Set())
    setBusy(false)
  }

  async function handleReprocess(filenames: string[]) {
    if (!study) return
    const items = filenames.map((filename) => ({
      studyId: study.id,
      filename,
      filepath: `${study.inputDirectory}/${filename}`
    }))
    await window.api.processBatch(items)
    setSelected(new Set())
  }

  function startEdit(filename: string, profileId: string, current: number | undefined) {
    setEditCell({ filename, profileId, draft: current !== undefined ? String(current) : '' })
  }

  async function commitEdit() {
    if (!editCell || !study) return
    const val = parseInt(editCell.draft, 10)
    if (!isNaN(val) && val >= 1 && val <= 100) {
      await window.api.updateRatingValue(editCell.profileId, editCell.filename, val)
      const fresh = await window.api.getProfiles(study.id)
      setProfiles(fresh)
    }
    setEditCell(null)
  }

  if (!study) {
    return (
      <div className="center-message">
        <p>No active study.</p>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 6 }}>
          Open a study from the Studies screen first.
        </p>
      </div>
    )
  }

  return (
    <div className="data-browser">
      <div className="db-toolbar">
        <input
          className="db-search input"
          type="text"
          placeholder="Search filenames…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="db-filters">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`db-filter-btn${filter === f.id ? ' active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="db-count">{filteredImages.length} / {images.length}</span>
      </div>

      {someSelected && (
        <div className="db-bulk-bar">
          <span className="db-bulk-count">{selectedInView.length} selected</span>
          <button className="btn-ghost" disabled={busy} onClick={() => handleResetFacial(selectedInView)}>
            Reset Facial
          </button>
          <button className="btn-ghost danger" disabled={busy} onClick={() => handleDeleteRatings(selectedInView)}>
            Delete Ratings
          </button>
          {workerReady && (
            <button className="btn-ghost" disabled={busy} onClick={() => handleReprocess(selectedInView)}>
              Reprocess
            </button>
          )}
          <button className="btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="db-table-wrap">
        <table className="db-table">
          <thead>
            <tr>
              <th className="db-th db-th-check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                  onChange={toggleAll}
                />
              </th>
              <th className="db-th db-th-name">Filename</th>
              {profiles.map((p) => (
                <th key={p.id} className="db-th db-th-rating" title={p.name}>
                  {p.name.length > 10 ? p.name.slice(0, 9) + '…' : p.name}
                </th>
              ))}
              <th className="db-th">Sex</th>
              <th className="db-th db-th-conf">Conf</th>
              <th className="db-th">Face</th>
              <th className="db-th">Status</th>
              <th className="db-th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredImages.map((filename) => {
              const fd = facialData[filename]
              const isSelected = selected.has(filename)
              return (
                <tr key={filename} className={`db-row${isSelected ? ' db-row-selected' : ''}`}>
                  <td className="db-td db-td-check">
                    <input type="checkbox" checked={isSelected} onChange={() => toggleOne(filename)} />
                  </td>
                  <td className="db-td db-td-name" title={filename}>{filename}</td>

                  {profiles.map((p) => {
                    const rating = p.ratings[filename]
                    const isEditing = editCell?.filename === filename && editCell.profileId === p.id
                    return (
                      <td key={p.id} className="db-td db-td-rating">
                        {isEditing ? (
                          <input
                            className="db-rating-input"
                            type="number"
                            min={1}
                            max={100}
                            value={editCell.draft}
                            autoFocus
                            onChange={(e) => setEditCell((prev) => prev ? { ...prev, draft: e.target.value } : null)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit()
                              if (e.key === 'Escape') setEditCell(null)
                            }}
                          />
                        ) : (
                          <span
                            className={`db-rating-val${rating !== undefined ? ' db-rating-val-set' : ' db-rating-val-empty'}`}
                            onClick={() => startEdit(filename, p.id, rating)}
                            title="Click to edit"
                          >
                            {rating !== undefined ? rating : '—'}
                          </span>
                        )}
                      </td>
                    )
                  })}

                  <td className="db-td">
                    {fd?.sex_label && fd.sex_label !== 'unknown' ? (
                      <span className={`db-sex-badge db-sex-${fd.sex_label}`}>
                        {fd.sex_label === 'male' ? 'M' : 'F'}
                      </span>
                    ) : <span className="db-muted">—</span>}
                  </td>
                  <td className="db-td db-td-conf">
                    {fd?.sex_confidence != null
                      ? `${Math.round(fd.sex_confidence * 100)}%`
                      : <span className="db-muted">—</span>}
                  </td>
                  <td className="db-td">
                    {fd?.processing_status === 'done'
                      ? (fd.face_detected ? <span className="db-face-yes">Yes</span> : <span className="db-muted">No</span>)
                      : <span className="db-muted">—</span>}
                  </td>
                  <td className="db-td">
                    <span className={`db-status status-${fd?.processing_status ?? 'pending'}`}>
                      {fd?.processing_status ?? 'pending'}
                    </span>
                  </td>
                  <td className="db-td db-td-actions">
                    {workerReady && fd?.processing_status !== 'processing' && (
                      <button className="db-action-btn" onClick={() => handleReprocess([filename])} title="Reprocess">↻</button>
                    )}
                    <button className="db-action-btn" onClick={() => handleResetFacial([filename])} title="Reset facial to pending" disabled={busy}>⊘</button>
                    <button className="db-action-btn db-action-danger" onClick={() => handleDeleteRatings([filename])} title="Delete all ratings" disabled={busy}>✕</button>
                  </td>
                </tr>
              )
            })}
            {filteredImages.length === 0 && (
              <tr>
                <td colSpan={profiles.length + 7} className="db-empty">
                  No images match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
