import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5182, open: false },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          pdf: ['pdfjs-dist'],
          charts: ['recharts'],
          sheet: ['xlsx'],
          fb: ['firebase/app', 'firebase/firestore'],
        },
      },
    },
  },
  optimizeDeps: { include: ['pdfjs-dist'] },
})
