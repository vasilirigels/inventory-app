import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Realtime change broadcast — Vite has to be told it's a WebSocket
      // upgrade or the connection silently drops through.
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    }
  },
  build: {
    // Ndaj vendor libraritë e mëdha në chunk-e të veçantë që të cache-hen
    // veçmas nga app code. Çdo ndryshim në app nuk invalidon vendor-in.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/xlsx/'))       return 'xlsx'
          if (id.includes('/recharts/'))   return 'recharts'
          if (id.includes('/jsbarcode/'))  return 'jsbarcode'
          if (id.includes('/react-dom/'))  return 'react-vendor'
          if (id.includes('/react/'))      return 'react-vendor'
          if (id.includes('/scheduler/'))  return 'react-vendor'
          return 'vendor'
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
})
