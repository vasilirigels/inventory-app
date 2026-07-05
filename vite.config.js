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
  }
})
