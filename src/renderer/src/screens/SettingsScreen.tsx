import { useState } from 'react'
import type { AppSettings, StudyState } from '../types'

interface Props {
  settings: AppSettings
  study: StudyState | null
  onSettingsChange: (s: AppSettings) => void
  onStudyChange: (st: StudyState) => void
}

type ExportState = 'idle' | 'running' | 'done' | 'error'

export default function SettingsScreen({ settings, study, onSettingsChange, onStudyChange }: Props) {
  const [inputDir, setInputDir] = useState(settings.inputDirectory)
  const [outputDir, setOutputDir] = useState(settings.outputDirectory)
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<string | null>(null)
  const [exportState, setExportState] = useState<ExportState>('idle')
  const [exportMessage, setExportMessage] = useState('')

  async function handlePickInput() {
    const dir = await window.api.selectDirectory(inputDir || undefined)
    if (dir) setInputDir(dir)
  }

  async function handlePickOutput() {
    const dir = await window.api.selectDirectory(outputDir || undefined)
    if (dir) setOutputDir(dir)
  }

  async function handleSave() {
    setSaving(true)
    const updated: AppSettings = { inputDirectory: inputDir, outputDirectory: outputDir }
    await window.api.saveSettings(updated)
    onSettingsChange(updated)
    setSaving(false)
  }

  async function handleRescan() {
    if (!inputDir) return
    setScanning(true)
    setScanResult(null)
    const state = await window.api.rescanImages(inputDir)
    onStudyChange(state)
    setScanResult(`Found ${state.imageList.length} image${state.imageList.length !== 1 ? 's' : ''}.`)
    setScanning(false)
  }

  async function handleExport() {
    setExportState('running')
    setExportMessage('')
    const result = await window.api.exportCsv(outputDir)
    if (result.ok) {
      setExportState('done')
      setExportMessage(`Exported to:\n${result.path}\n${result.longPath}`)
    } else {
      setExportState('error')
      setExportMessage(result.error ?? 'Export failed.')
    }
  }

  const dirty = inputDir !== settings.inputDirectory || outputDir !== settings.outputDirectory

  return (
    <div className="settings-screen">
      <h1>Settings</h1>

      <section className="settings-section">
        <h2>Directories</h2>

        <div className="field">
          <label>Image input directory</label>
          <div className="dir-row">
            <span className="dir-value">{inputDir || <em>Not set</em>}</span>
            <button className="btn-ghost btn-sm" onClick={handlePickInput}>
              Browse…
            </button>
          </div>
        </div>

        <div className="field">
          <label>Output / export directory</label>
          <div className="dir-row">
            <span className="dir-value">{outputDir || <em>Not set</em>}</span>
            <button className="btn-ghost btn-sm" onClick={handlePickOutput}>
              Browse…
            </button>
          </div>
        </div>

        {dirty && (
          <button className="btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        )}
      </section>

      <section className="settings-section">
        <h2>Image List</h2>
        <p className="settings-desc">
          The image list defines the order all participants see images. Rescanning replaces the list
          but preserves all existing ratings.
        </p>
        {study && (
          <div className="study-info-box">
            <span>
              {study.imageList.length} images · Last scanned{' '}
              {new Date(study.generatedAt).toLocaleString()}
            </span>
          </div>
        )}
        <button
          className="btn"
          onClick={handleRescan}
          disabled={!inputDir || scanning}
        >
          {scanning ? 'Scanning…' : 'Rescan Image Directory'}
        </button>
        {scanResult && <p className="scan-result">{scanResult}</p>}
      </section>

      <section className="settings-section">
        <h2>Export Data</h2>
        <p className="settings-desc">
          Aggregate all participant ratings into a CSV file. Produces a wide-format file (one row per
          image) and a long-format file suitable for statistical analysis.
        </p>
        <button
          className="btn"
          onClick={handleExport}
          disabled={exportState === 'running'}
        >
          {exportState === 'running' ? 'Exporting…' : 'Export Ratings CSV…'}
        </button>
        {exportMessage && (
          <pre className={`export-message ${exportState}`}>{exportMessage}</pre>
        )}
      </section>
    </div>
  )
}
