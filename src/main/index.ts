import { app, BrowserWindow, protocol } from 'electron'
import path from 'path'
import { registerIpcHandlers, registerProtocol } from './ipc-handlers'
import { pythonBridge } from './python-bridge'
import { runMigrations } from './store'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1a1a1a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'localfile',
    privileges: { secure: true, supportFetchAPI: true, bypassCSP: true }
  }
])

app.whenReady().then(() => {
  runMigrations()
  registerProtocol()
  registerIpcHandlers()
  createWindow()

  // Start the Python worker.  Failures are logged but must not prevent
  // the app from opening — the UI degrades gracefully when the worker
  // is unavailable.
  pythonBridge.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  pythonBridge.shutdown()
})

app.on('window-all-closed', () => {
  app.quit()
})
