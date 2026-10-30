import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode, command }) => {
  if (command === 'build' && !loadEnv(mode, '.', '').VITE_API_BASE_URL?.trim()) {
    throw new Error('VITE_API_BASE_URL must be set for production builds')
  }

  return {
    plugins: [react()],
    resolve: {
      dedupe: ['react', 'react-dom', 'react-router-dom'],
    },
  }
})
