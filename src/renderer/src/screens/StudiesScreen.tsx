import { useState, useEffect, useRef } from 'react'
import type { Study, AppSettings } from '../types'

interface Props {
  settings: AppSettings
  onSelectStudy: (study: Study) => void
  onGoSettings: () => void
}

export default function StudiesScreen({ settings, onSelectStudy, onGoSettings }: Props) {
  const [studies, setStudies] = useState<Study[]>([])
  const [newName, setNewName] = useState('')
  const [newDir, setNewDir] = useState('')
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [rescanning, setRescanning] = useState<string | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [multiExporting, setMultiExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.getStudies().then(setStudies)
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim() || !newDir) return
    setCreating(true)
    const study = await window.api.createStudy(newName.trim(), newDir)
    setStudies((prev) => [...prev, study])
    setNewName('')
    setNewDir('')
    setCreating(false)
    nameRef.current?.focus()
  }

  async function handlePickDir() {
    const dir = await window.api.selectDirectory(newDir || undefined)
    if (dir) setNewDir(dir)
  }

  async function handleDelete(id: string) {
    await window.api.deleteStudy(id)
    setStudies((prev) => prev.filter((s) => s.id !== id))
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n })
    setDeletingId(null)
  }

  async function handleRename(id: string) {
    const name = renameValue.trim()
    if (!name) return
    await window.api.renameStudy(id, name)
    setStudies((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)))
    setRenamingId(null)
  }

  async function handleRescan(studyId: string) {
    setRescanning(studyId)
    const updated = await window.api.rescanStudy(studyId)
    if (updated) setStudies((prev) => prev.map((s) => (s.id === studyId ? updated : s)))
    setRescanning(null)
  }

  async function handleExport(studyIds: string[]) {
    const isMulti = studyIds.length > 1
    if (isMulti) setMultiExporting(true)
    else setExporting(studyIds[0])
    setExportMsg(null)

    const result = await window.api.exportCsv(studyIds, settings.outputDirectory)

    if (isMulti) setMultiExporting(false)
    else setExporting(null)

    if (result.ok) {
      setExportMsg({ text: `Exported:\n${result.path}\n${result.longPath}`, ok: true })
    } else {
      setExportMsg({ text: result.error ?? 'Export failed.', ok: false })
    }
    if (isMulti) setSelected(new Set())
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const selectedIds = Array.from(selected)

  return (
    <div className="studies-screen">
      <div className="studies-header">
        <h1>Studies</h1>
        <button className="btn-ghost" onClick={onGoSettings}>
          Settings
        </button>
      </div>

      {studies.length === 0 ? (
        <p className="empty-hint" style={{ marginBottom: 24 }}>
          No studies yet. Create one below.
        </p>
      ) : (
        <div className="study-list">
          {studies.map((study) => {
            const isDeleting = deletingId === study.id
            const isRenaming = renamingId === study.id
            const isRescanning = rescanning === study.id
            const isExporting = exporting === study.id
            const isSelected = selected.has(study.id)

            return (
              <div key={study.id} className={`study-card${isSelected ? ' study-card-selected' : ''}`}>
                <input
                  type="checkbox"
                  className="study-card-check"
                  checked={isSelected}
                  onChange={() => toggleSelect(study.id)}
                  title="Select for combined export"
                />

                <div className="study-card-body">
                  {isRenaming ? (
                    <form
                      className="study-rename-form"
                      onSubmit={(e) => { e.preventDefault(); handleRename(study.id) }}
                    >
                      <input
                        autoFocus
                        className="input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                      />
                      <button type="submit" className="btn btn-sm">Save</button>
                      <button type="button" className="btn-ghost btn-sm" onClick={() => setRenamingId(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="study-card-title">
                      <button
                        className="study-name-btn"
                        onClick={() => onSelectStudy(study)}
                        title="Open study"
                      >
                        {study.name}
                      </button>
                      <span className="study-image-count">
                        {study.imageList.length} image{study.imageList.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}

                  <div className="study-card-meta">
                    <span className="study-dir" title={study.inputDirectory}>
                      {study.inputDirectory || <em>No directory set</em>}
                    </span>
                    <span className="study-meta-sep">·</span>
                    <span className="study-scanned">
                      Scanned {new Date(study.generatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="study-card-actions">
                  {isDeleting ? (
                    <>
                      <span className="danger-label">Delete study and all ratings?</span>
                      <button className="btn-danger btn-sm" onClick={() => handleDelete(study.id)}>
                        Delete
                      </button>
                      <button className="btn-ghost btn-sm" onClick={() => setDeletingId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn btn-sm"
                        onClick={() => onSelectStudy(study)}
                      >
                        Open
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => handleRescan(study.id)}
                        disabled={isRescanning}
                        title="Rescan image directory"
                      >
                        {isRescanning ? 'Scanning…' : 'Rescan'}
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => handleExport([study.id])}
                        disabled={isExporting || multiExporting}
                      >
                        {isExporting ? 'Exporting…' : 'Export CSV'}
                      </button>
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          setRenamingId(study.id)
                          setRenameValue(study.name)
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="btn-ghost btn-sm danger"
                        onClick={() => setDeletingId(study.id)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Multi-study export bar */}
      {selectedIds.length > 1 && (
        <div className="multi-export-bar">
          <span>{selectedIds.length} studies selected</span>
          <button
            className="btn"
            onClick={() => handleExport(selectedIds)}
            disabled={multiExporting}
          >
            {multiExporting ? 'Exporting…' : `Export ${selectedIds.length} Studies Combined…`}
          </button>
          <button className="btn-ghost" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {/* Export message */}
      {exportMsg && (
        <pre className={`export-message ${exportMsg.ok ? 'done' : 'error'}`}>{exportMsg.text}</pre>
      )}

      {/* Create study form */}
      <section className="studies-create">
        <h2>New Study</h2>
        <form className="create-study-form" onSubmit={handleCreate}>
          <input
            ref={nameRef}
            className="input"
            placeholder="Study name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <div className="dir-row create-study-dir">
            <span className="dir-value">{newDir || <em>No directory selected</em>}</span>
            <button type="button" className="btn-ghost btn-sm" onClick={handlePickDir}>
              Browse…
            </button>
          </div>
          <button
            type="submit"
            className="btn"
            disabled={!newName.trim() || !newDir || creating}
          >
            {creating ? 'Creating…' : 'Create Study'}
          </button>
        </form>
      </section>
    </div>
  )
}
