import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/main',
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.js',
          chunkFileNames: 'chunks/[name].js',
          inlineDynamicImports: true
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload',
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: 'index.js'
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      outDir: 'dist-electron/renderer'
    }
  }
})