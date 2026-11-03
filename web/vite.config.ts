import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

const apiTarget = process.env.REPOSITORY_API_TARGET ?? 'http://localhost:8081'

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/auth': { target: apiTarget, changeOrigin: true },
      '/.well-known': { target: apiTarget, changeOrigin: true },
    },
    allowedHosts: [
      'localhost',
      'repository-dev-sharelib.luca.hij1.local.sasakulab.com',
    ],
  },
  resolve: {
    tsconfigPaths: true,
  },
})
