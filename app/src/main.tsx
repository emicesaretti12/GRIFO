import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// La pantalla de la canilla va aparte: trae su motor de dibujo y sus
// tipografías, que la app de gestión no necesita, y la tablet no descarga la
// gestión.
const Kiosco = lazy(() => import('./pantalla/Kiosco'))
import Movil from './movil/Movil'
import './estilos.css'

// Tres aplicaciones en un mismo bundle:
//   #/pantalla  → la pantalla de una canilla, sin login, en modo kiosco
//   #/movil     → la caja portátil: el celular del mozo como lector NFC
//   cualquier otra cosa → la app de gestión, con login
//
// Ruteo por hash a propósito: una tablet en la barra abre una URL fija y nunca
// navega, y el celular la guarda en la pantalla de inicio. Con rutas normales,
// cualquier recarga pediría al servidor una ruta que no existe y habría que
// configurar el hosting para reescribirla.
const ruta = location.hash.startsWith('#/pantalla') ? 'pantalla'
           : location.hash.startsWith('#/movil')    ? 'movil'
           : 'gestion'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {ruta === 'pantalla' ? <Suspense fallback={null}><Kiosco /></Suspense> : ruta === 'movil' ? <Movil /> : <App />}
  </StrictMode>
)
