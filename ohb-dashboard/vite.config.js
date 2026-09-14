import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Schwere Abhängigkeiten in eigene Chunks auslagern -> kleinerer
    // Initial-Bundle, paralleles Laden und besseres Browser-Caching.
    rollupOptions: {
      output: {
        manualChunks: {
          plotly: ['plotly.js-dist-min'],
          mqtt: ['mqtt'],
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
})
