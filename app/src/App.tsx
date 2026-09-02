import { useState } from 'react'
import { useSesion } from './lib/useSesion'
import Login from './pantallas/Login'
import Caja from './pantallas/Caja'
import Grifos from './pantallas/Grifos'
import Tarjetas from './pantallas/Tarjetas'
import Reportes from './pantallas/Reportes'
import Personal from './pantallas/Personal'

type Pantalla = 'caja' | 'grifos' | 'tarjetas' | 'reportes' | 'personal'

export default function App() {
  const { sesion, rol, nombre, cargando, esAdmin, esPersonal, salir } = useSesion()
  const [pantalla, setPantalla] = useState<Pantalla>('caja')

  if (!sesion) return <Login />

  if (cargando) {
    return <div className="login"><div className="panel caja"><p className="vacio">Cargando…</p></div></div>
  }

  // Usuario logueado pero sin rol asignado: existe en Auth pero nadie lo dio de
  // alta como personal. Es un estado legítimo, no un error.
  if (!esPersonal) {
    return (
      <div className="login">
        <div className="panel caja">
          <h2>Tu usuario todavía no tiene permisos</h2>
          <p className="sub">
            Entraste bien, pero un administrador tiene que darte de alta como personal
            antes de que puedas operar.
          </p>
          <button className="btn ancho" onClick={salir}>Salir</button>
        </div>
      </div>
    )
  }

  const todas: { id: Pantalla; texto: string; soloAdmin?: boolean }[] = [
    { id: 'caja',     texto: 'Caja' },
    { id: 'tarjetas', texto: 'Tarjetas', soloAdmin: true },
    { id: 'grifos',   texto: 'Grifos',   soloAdmin: true },
    { id: 'reportes', texto: 'Reportes', soloAdmin: true },
    { id: 'personal', texto: 'Personal', soloAdmin: true },
  ]
  const items = todas.filter(i => !i.soloAdmin || esAdmin)

  return (
    <div className="app">
      <nav className="barra">
        <span className="marca">🍺 Grifo</span>
        {items.map(i => (
          <button key={i.id} className="nav-item" onClick={() => setPantalla(i.id)}
                  aria-current={pantalla === i.id ? 'page' : undefined}>
            {i.texto}
          </button>
        ))}
        <span className="espacio" />
        <span className="quien">{nombre ?? sesion.user.email} · {rol}</span>
        <button className="btn chico" onClick={salir}>Salir</button>
      </nav>

      <main className="contenido">
        {pantalla === 'caja'     && <Caja />}
        {pantalla === 'tarjetas' && esAdmin && <Tarjetas />}
        {pantalla === 'grifos'   && esAdmin && <Grifos />}
        {pantalla === 'reportes' && esAdmin && <Reportes />}
        {pantalla === 'personal' && esAdmin && <Personal />}
      </main>
    </div>
  )
}
