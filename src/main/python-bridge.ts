/**
 * python-bridge.ts
 *
 * Manages the long-lived Python facial-analysis worker process.
 * Communication is newline-delimited JSON over stdin/stdout.
 *
 * Usage:
 *   import { pythonBridge } from './python-bridge'
 *   pythonBridge.start(modelPath)
 *   const result = await pythonBridge.processImage('/abs/path/image.jpg')
 *   pythonBridge.shutdown()
 */

import { ChildProcess, spawn } from 'child_process'
import { app, BrowserWindow } from 'electron'
import path from 'path'
import crypto from 'crypto'
import type { SexLabel } from '../shared/types'
import fs from 'fs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessResult {
  face_detected: boolean
  sex_label: SexLabel
  sex_confidence: number | null
  metrics: Record<string, unknown>
}

interface WorkerMsg {
  type: string
  // single-image fields
  id?: string
  status?: 'ok' | 'error'
  error?: string
  face_detected?: boolean
  sex_label?: string
  sex_confidence?: number | null
  metrics?: Record<string, unknown>
  // batch fields
  batch_id?: string
  filename?: string
  index?: number
  total?: number
}

type Pending = {
  resolve: (r: ProcessResult) => void
  reject: (e: Error) => void
}

export type BatchItemCallback = (
  filename: string,
  result: ProcessResult | null,
  error: string | null
) => void

export interface BatchCallbacks {
  onItem: BatchItemCallback
  onDone: () => void
  onError: (err: Error) => void
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

class PythonBridge {
  private proc: ChildProcess | null = null
  private _ready = false
  private _pending = new Map<string, Pending>()
  private _pendingBatches = new Map<string, BatchCallbacks>()
  private _buffer = ''
  private _readyListeners: Array<() => void> = []

  private workerPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'worker.py')
    }
    return path.join(__dirname, '..', '..', 'src', 'python', 'worker.py')
  }

  private modelPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'data', 'face_landmarker_v2_with_blendshapes.task')
    }
    return path.join(__dirname, '..', '..', 'src', 'python', 'data', 'face_landmarker_v2_with_blendshapes.task')
  }

  private pythonPath(): string {
    if (app.isPackaged) {
      console.log("PACKAGED")
      if (process.platform === 'win32') {
        return path.join(process.resourcesPath, 'venv', 'Scripts', 'python.exe')
      }
      return path.join(process.resourcesPath, 'venv', 'bin', 'python')
    }

    console.log("NOT PACKAGED")
    if (process.platform === 'win32') {
      return path.join(__dirname, '..', '..', 'src', 'python', 'venv', 'Scripts', 'python.exe')
    }
    return path.join(__dirname, '..', '..', 'src', 'python', 'venv', 'bin', 'python')
  }

  start(): void {
    if (this.proc) return

    const wp = this.workerPath()
    const mp = this.modelPath()
    const pythonCmd = this.pythonPath()

    console.log(`[python-bridge] workerPath=${wp}`)
    console.log(`[python-bridge] modelPath=${mp}`)
    console.log(`[python-bridge] pythonPath=${pythonCmd}`)

    if (!fs.existsSync(pythonCmd)) {
      throw new Error(`Bundled Python not found at: ${pythonCmd}`)
    }
    if (!fs.existsSync(wp)) {
      throw new Error(`Python worker not found at: ${wp}`)
    }
    if (!fs.existsSync(mp)) {
      throw new Error(`Model file not found at: ${mp}`)
    }

    this.proc = spawn(pythonCmd, ['-u', wp], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FACE_LANDMARKER_MODEL: mp }
    })


    this.proc.stdout?.on('data', (chunk: Buffer) => {
      this._buffer += chunk.toString('utf-8')
      this._drainBuffer()
    })

    this.proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim()
      if (text) console.error(`[python-worker] ${text}`)
    })

    this.proc.on('error', (err: Error) => {
      console.error('[python-bridge] spawn error:', err.message)
      this._rejectAll(new Error(`Python worker spawn error: ${err.message}`))
      this._reset()
    })

    this.proc.on('exit', (code: number | null, signal: string | null) => {
      console.warn(`[python-bridge] Worker exited (code=${code} signal=${signal})`)
      this._rejectAll(new Error('Python worker exited unexpectedly'))
      this._reset()
    })
  }

  private _drainBuffer(): void {
    const lines = this._buffer.split('\n')
    this._buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        this._handleMsg(JSON.parse(trimmed) as WorkerMsg)
      } catch (e) {
        console.error('[python-bridge] JSON parse error:', e, '| Raw output:', trimmed)
        // console.error('[python-bridge] JSON parse error:', e, '| line:', trimmed.slice(0, 120))
      }
    }
  }

  private _handleMsg(msg: WorkerMsg): void {
    if (msg.type === 'ready') {
      this._ready = true
      console.log('[python-bridge] Worker ready')
      for (const cb of this._readyListeners) cb()
      this._readyListeners = []

      // facial-worker-ready
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        win.webContents.send('facial-worker-ready', {})
      } else {
        console.warn('[python-bridge] Worker ready, but UI window does not exist yet!')
      }
      return
    }

    if (msg.type === 'result' && msg.id) {
      const p = this._pending.get(msg.id)
      if (!p) return
      this._pending.delete(msg.id)

      if (msg.status === 'ok') {
        p.resolve({
          face_detected: msg.face_detected ?? false,
          sex_label: (msg.sex_label as SexLabel | undefined) ?? 'unknown',
          sex_confidence: msg.sex_confidence ?? null,
          metrics: msg.metrics ?? {}
        })
      } else {
        p.reject(new Error(msg.error ?? 'Unknown error from Python worker'))
      }
      return
    }

    if (msg.type === 'batch_item' && msg.batch_id) {
      const batch = this._pendingBatches.get(msg.batch_id)
      if (!batch) return
      if (msg.status === 'ok') {
        batch.onItem(msg.filename ?? '', {
          face_detected: msg.face_detected ?? false,
          sex_label: (msg.sex_label as SexLabel | undefined) ?? 'unknown',
          sex_confidence: msg.sex_confidence ?? null,
          metrics: msg.metrics ?? {}
        }, null)
      } else {
        batch.onItem(msg.filename ?? '', null, msg.error ?? 'Unknown error')
      }
      return
    }

    if (msg.type === 'batch_done' && msg.batch_id) {
      const batch = this._pendingBatches.get(msg.batch_id)
      if (!batch) return
      this._pendingBatches.delete(msg.batch_id)
      batch.onDone()
    }
  }

  private _rejectAll(err: Error): void {
    for (const [, p] of this._pending) p.reject(err)
    this._pending.clear()
    for (const [, b] of this._pendingBatches) b.onError(err)
    this._pendingBatches.clear()
  }

  private _reset(): void {
    this.proc = null
    this._ready = false
    this._buffer = ''
  }

  isReady(): boolean {
    return this._ready && this.proc !== null
  }

  /** Wait until the worker sends {"type":"ready"}, or resolve immediately if already ready. */
  waitUntilReady(timeoutMs = 15_000): Promise<void> {
    if (this._ready) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Python worker did not start in time')), timeoutMs)
      this._readyListeners.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /**
   * Send one image to the worker and return the extracted data.
   * Rejects if the worker is not running or the Python side returns an error.
   */
  async processImage(filepath: string): Promise<ProcessResult> {
    if (!this.proc || !this._ready) {
      throw new Error('Python worker is not ready')
    }
    const id = crypto.randomUUID()
    return new Promise<ProcessResult>((resolve, reject) => {
      this._pending.set(id, { resolve, reject })
      this._write({ type: 'process', id, filepath })
    })
  }

  /**
   * Send a whole batch of images in one message and receive results via callbacks.
   * The Python worker processes items sequentially and streams back one
   * `batch_item` per image; `onDone` fires after the last one.
   */
  processBatch(
    items: Array<{ filename: string; filepath: string }>,
    callbacks: BatchCallbacks
  ): void {
    if (!this.proc || !this._ready) {
      callbacks.onError(new Error('Python worker is not ready'))
      return
    }
    const id = crypto.randomUUID()
    this._pendingBatches.set(id, callbacks)
    this._write({ type: 'batch', id, items })
  }

  /** Gracefully ask the worker to shut down, then kill after a timeout. */
  shutdown(): void {
    if (!this.proc) return
    try {
      this._write({ type: 'shutdown' })
    } catch {
      // ignore write errors during shutdown
    }
    const p = this.proc
    setTimeout(() => {
      if (!p.exitCode) {
        p.kill('SIGTERM')
      }
    }, 2_000)
  }

  private _write(msg: object): void {
    const payload = JSON.stringify(msg) + '\n'
    console.log(`[python-bridge] SENDING TO PYTHON: ${payload.trim()}`) // Add this
    this.proc?.stdin?.write(JSON.stringify(msg) + '\n', 'utf-8')
  }
}

export const pythonBridge = new PythonBridge()
