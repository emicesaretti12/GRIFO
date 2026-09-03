import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

// Sello de versión. Sin esto, "¿estoy viendo la última?" es una adivinanza:
// entre el caché del navegador, el del hosting y un git pull que no se hizo,
// hay demasiadas formas de estar mirando algo viejo sin enterarse.
function version() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    // En Vercel el .git puede no estar; ahí viene por variable de entorno.
    return (process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 7)
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __VERSION__: JSON.stringify(version()),
    __COMPILADO__: JSON.stringify(new Date().toISOString()),
  },
  server: { port: 5173 },
})
