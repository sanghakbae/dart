import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { dartProxy } from './server/vite-dart-plugin.mjs'

export default defineConfig(({ mode }) => ({
  // DART_API_KEY 는 VITE_ 접두사가 없어 번들에 들어가지 않는다. 개발 서버 쪽에서만 쓴다.
  plugins: [react(), dartProxy(loadEnv(mode, process.cwd(), ''))],
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
}))
