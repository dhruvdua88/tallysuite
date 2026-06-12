import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Offline-first: base set to './' so the built app runs from any static host
// (GitHub Pages subpath, Cloudflare Pages, file://). No runtime CDN.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo) =>
          assetInfo.name?.endsWith('.css') ? 'assets/[name][extname]' : 'assets/[name]-[hash][extname]',
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      include: ['src/core/**'],
    },
  },
})
