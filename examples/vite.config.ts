import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'duet-kit': path.resolve(__dirname, '../dist'),
    },
    dedupe: ['react', 'react-dom', 'zustand', 'zod'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'zustand', 'zod'],
  },
  server: {
    proxy: {
      '/api/openai': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/openai/, ''),
      },
    },
  },
})
