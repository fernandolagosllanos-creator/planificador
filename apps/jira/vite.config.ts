import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Puerto distinto al de apps/simple para poder tener las dos en desarrollo a la vez.
  server: { port: 5174, strictPort: true },
})
