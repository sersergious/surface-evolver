/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Vitest otherwise loads a second copy of react/react-dom for test files,
  // which breaks hooks with "Cannot read properties of null (reading
  // 'useX')" — dedupe forces a single shared instance.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
