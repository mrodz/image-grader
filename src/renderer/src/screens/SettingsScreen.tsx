import { useState, useMemo } from 'react'
import type { AppSettings, Study, FacialData } from '../types'

interface Props {
  settings: AppSettings
  activeStudy: Study | null
  facialData: Record<string, FacialData>
  workerReady: boolean
  onSettingsChange: (s: AppSettings) => void
  onFacialDataChange: (fd: Record<string, FacialData>) => void
}

type BatchState = 'idle' | 'running' | 'done'

export default function SettingsScreen({
  settings,
  activeStudy,
  facialData,
  workerReady,
  onSettingsChange,
  onFacialDataChange
}: Props) {
  const [outputDir, setOutputDir] = useState(settings.outputDirectory)
  const [saving, setSaving] = useState(false)
  const [batchState, setBatchState] = useState<BatchState>('idle')
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 })
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const facialStats = useMemo(() => {
    const imageList = activeStudy?.imageList ?? []
    const stats = { pending: 0, processing: 0, done: 0, error: 0, total: imageList.length }
    for (const filename of imageList) {
      const status = facialData[filename]?.processing_status ?? 'pending'
      if (status in stats) (stats as Record<string, number>)[status]++
    }
    return stats
  }, [facialData, activeStudy])

  async function handlePickOutput() {
    const dir = await window.api.selectDirectory(outputDir || undefined)
    if (dir) setOutputDir(dir)
  }

  async function handleSave() {
    setSaving(true)
    const updated: AppSettings = { outputDirectory: outputDir }
    await window.api.saveSettings(updated)
    onSettingsChange(updated)
    setSaving(false)
  }

  async function handleAnalyzeAll() {
    if (!activeStudy || !workerReady) return
    const items = activeStudy.imageList
      .filter((filename) => (facialData[filename]?.processing_status ?? 'pending') === 'pending')
      .map((filename) => ({
        studyId: activeStudy.id,
        filename,
        filepath: `${activeStudy.inputDirectory}/${filename}`
      }))

    if (items.length === 0) return
    setBatchState('running')
    setBatchProgress({ completed: 0, total: items.length })

    window.api.onFacialProgress((event) => {
      if (event.status === 'done' || event.status === 'error') {
        setBatchProgress({ completed: event.completed, total: event.total })
      }
    })

    window.api.onFacialBatchComplete(async () => {
      window.api.offFacialBatchComplete()
      const fd = await window.api.getFacialData(activeStudy.id)
      onFacialDataChange(fd)
      setBatchState('done')
    })

    await window.api.processBatch(items)
  }

  async function handleRetryFailed() {
    if (!activeStudy || !workerReady) return
    const items = activeStudy.imageList
      .filter((filename) => facialData[filename]?.processing_status === 'error')
      .map((filename) => ({
        studyId: activeStudy.id,
        filename,
        filepath: `${activeStudy.inputDirectory}/${filename}`
      }))

    if (items.length === 0) return
    setBatchState('running')
    setBatchProgress({ completed: 0, total: items.length })

    window.api.onFacialBatchComplete(async () => {
      window.api.offFacialBatchComplete()
      const fd = await window.api.getFacialData(activeStudy.id)
      onFacialDataChange(fd)
      setBatchState('done')
    })

    await window.api.processBatch(items)
  }

  const dirty = outputDir !== settings.outputDirectory
  const imageList = activeStudy?.imageList ?? []

  const filteredImages = useMemo(() => {
    if (statusFilter === 'all') return imageList
    return imageList.filter((filename) => {
      const status = facialData[filename]?.processing_status ?? 'pending'
      return status === statusFilter
    })
  }, [imageList, facialData, statusFilter])

  const batchPct =
    batchProgress.total > 0 ? Math.round((batchProgress.completed / batchProgress.total) * 100) : 0

  return (
    <div className="settings-screen">
      <h1>Settings</h1>

      {/* --- Output Directory --- */}
      <section className="settings-section">
        <h2>Export Directory</h2>
        <div className="field">
          <label>Output / export directory</label>
          <div className="dir-row">
            <span className="dir-value">{outputDir || <em>Not set</em>}</span>
            <button className="btn-ghost btn-sm" onClick={handlePickOutput}>Browse…</button>
          </div>
        </div>
        {dirty && (
          <button className="btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </section>

      {/* --- Facial Analysis --- */}
      <section className="settings-section">
        <h2>Facial Analysis</h2>
        <p className="settings-desc">
          Automatically extract sex classification and facial metrics from each image using
          MediaPipe Face Landmarker.
        </p>

        <div className={`worker-status ${workerReady ? 'worker-ready' : 'worker-not-ready'}`}>
          <span className={`worker-dot ${workerReady ? 'worker-dot-ready' : 'worker-dot-off'}`} />
          {workerReady ? 'Python worker ready' : 'Python worker not running'}
        </div>

        {!activeStudy && (
          <p className="settings-desc">Open a study to see facial analysis stats.</p>
        )}

        {activeStudy && imageList.length > 0 && (
          <>
            <p className="settings-desc" style={{ marginBottom: 10 }}>
              Active study: <strong>{activeStudy.name}</strong>
            </p>
            <div className="facial-stats">
              <FacialStatPill label="Done" value={facialStats.done} color="success" />
              <FacialStatPill label="Pending" value={facialStats.pending} color="muted" />
              <FacialStatPill label="Failed" value={facialStats.error} color="danger" />
              <FacialStatPill label="Total" value={facialStats.total} color="accent" />
            </div>
          </>
        )}

        {batchState === 'running' && (
          <div className="batch-progress">
            <div className="batch-progress-bar">
              <div className="batch-progress-fill" style={{ width: `${batchPct}%` }} />
            </div>
            <span className="batch-progress-label">
              {batchProgress.completed} / {batchProgress.total} processed ({batchPct}%)
            </span>
          </div>
        )}
        {batchState === 'done' && <p className="scan-result">Batch processing complete.</p>}

        {activeStudy && (
          <div className="facial-actions">
            <button
              className="btn"
              onClick={handleAnalyzeAll}
              disabled={!workerReady || facialStats.pending === 0 || batchState === 'running'}
            >
              {batchState === 'running' ? 'Processing…' : `Analyze Pending (${facialStats.pending})`}
            </button>
            {facialStats.error > 0 && (
              <button
                className="btn-ghost"
                onClick={handleRetryFailed}
                disabled={!workerReady || batchState === 'running'}
              >
                Retry Failed ({facialStats.error})
              </button>
            )}
          </div>
        )}

        {activeStudy && imageList.length > 0 && (
          <div className="facial-table-wrap">
            <div className="facial-filter-row">
              <span className="facial-filter-label">Filter:</span>
              {['all', 'pending', 'done', 'error'].map((f) => (
                <button
                  key={f}
                  className={`facial-filter-btn ${statusFilter === f ? 'active' : ''}`}
                  onClick={() => setStatusFilter(f)}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="facial-table">
              {filteredImages.slice(0, 200).map((filename) => {
                const fd = facialData[filename]
                const status = fd?.processing_status ?? 'pending'
                return (
                  <div key={filename} className={`facial-row facial-row-${status}`}>
                    <span className="facial-row-name" title={filename}>{filename}</span>
                    <span className={`facial-row-status status-${status}`}>{status}</span>
                    {status === 'done' && (
                      <>
                        <span className="facial-row-sex">{fd.sex_label}</span>
                        <span className="facial-row-face">{fd.face_detected ? 'Face' : 'No face'}</span>
                      </>
                    )}
                    {status === 'error' && (
                      <span className="facial-row-error" title={fd?.processing_error ?? ''}>
                        {fd?.processing_error?.slice(0, 60) ?? 'Error'}
                      </span>
                    )}
                  </div>
                )
              })}
              {filteredImages.length > 200 && (
                <p className="facial-table-trunc">
                  Showing 200 of {filteredImages.length} — export CSV for full list.
                </p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function FacialStatPill({ label, value, color }: { label: string; value: number; color: 'success' | 'danger' | 'muted' | 'accent' }) {
  return (
    <div className={`facial-stat-pill facial-stat-${color}`}>
      <span className="facial-stat-value">{value}</span>
      <span className="facial-stat-label">{label}</span>
    </div>
  )
}
