import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: '../src/public',
    emptyOutDir: true, // Clean the public folder before building new assets
  },
  server: {
    proxy: {
      '/reconcile': 'http://localhost:3000',
      '/report': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    }
  }
})
