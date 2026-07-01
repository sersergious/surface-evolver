import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// All backend calls go over Electrobun native IPC — no HTTP server, no proxy.
export default defineConfig({
  plugins: [react()],
})
