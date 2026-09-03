import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Kiosco from './pantalla/Kiosco'
import './estilos.css'

// Dos aplicaciones en un mismo bundle:
//   #/pantalla  → la pantalla de una canilla, sin login, en modo kiosco
//   cualquier otra cosa → la app de gestión, con login
//
// Ruteo por hash a propósito: una tablet en la barra abre una URL fija y nunca
// navega. Con rutas normales, cualquier recarga pediría al servidor una ruta
// que no existe y habría que configurar el hosting para reescribirla.
const esKiosco = location.hash.startsWith('#/pantalla')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {esKiosco ? <Kiosco /> : <App />}
  </StrictMode>
)
