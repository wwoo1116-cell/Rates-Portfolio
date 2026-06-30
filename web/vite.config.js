import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    proxy: {
      // All /api/* requests from the browser go to Vite, which forwards them
      // to the FastAPI backend on 127.0.0.1. This sidesteps Windows localhost
      // IPv6 resolution (::1 vs 127.0.0.1 mismatch) and makes CORS irrelevant.
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
