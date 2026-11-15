import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './estilos.css'

// La pantalla de la canilla y la app del cliente van aparte: cada una trae sus
// tipografías y lo suyo (el motor de dibujo, el lector de QR), que la gestión
// no necesita. Así la tablet no descarga la gestión, ni el celular del cliente
// el motor de la tablet.
const Kiosco = lazy(() => import('./pantalla/Kiosco'))
const Cliente = lazy(() => import('./cliente/Cliente'))

// Tres aplicaciones en un mismo sitio:
//   #/pantalla  → la pantalla de una canilla, sin login, en modo kiosco
//   #/cliente   → la app del cliente: saldo, QR y carga con Mercado Pago
//   cualquier otra cosa → la app de gestión, con login
//
// Ruteo por hash a propósito: una tablet en la barra abre una URL fija y nunca
// navega, y el celular la guarda en la pantalla de inicio. Con rutas normales,
// cualquier recarga pediría al servidor una ruta que no existe y habría que
// configurar el hosting para reescribirla.

// ── La vuelta de Mercado Pago ────────────────────────────────────────────────
// Mercado Pago devuelve al cliente a `/?volver=cliente&status=…` y le agrega
// sus datos como parámetros comunes, que con un `#` en el medio no llegarían
// bien. Acá se lo lleva a su pantalla y se limpia la barra de direcciones: si
// recarga, que no vuelva a "volver de pagar".
const consulta = new URLSearchParams(location.search)
const volvioDePagar = consulta.get('volver') === 'cliente'
const pagoDeVuelta = volvioDePagar ? consulta.get('external_reference') : null
if (volvioDePagar) history.replaceState(null, '', location.pathname + '#/cliente')

const ruta = location.hash.startsWith('#/pantalla') ? 'pantalla'
           : location.hash.startsWith('#/cliente')  ? 'cliente'
           : 'gestion'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {ruta === 'pantalla' ? <Suspense fallback={null}><Kiosco /></Suspense>
      : ruta === 'cliente' ? <Suspense fallback={null}><Cliente volvioDePagar={volvioDePagar} pagoDeVuelta={pagoDeVuelta} /></Suspense>
      : <App />}
  </StrictMode>
)
