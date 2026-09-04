import { useState } from 'react'
import { useSesion } from './lib/useSesion'
import { useTema } from './lib/useTema'
import { ProveedorAvisos } from './componentes/Toast'
import { Limite } from './componentes/Limite'
import Icono, { type Nombre } from './componentes/Icono'
import Login from './pantallas/Login'
import Inicio from './pantallas/Inicio'
import Caja from './pantallas/Caja'
import Grifos from './pantallas/Grifos'
import Tarjetas from './pantallas/Tarjetas'
import Reportes from './pantallas/Reportes'
import Personal from './pantallas/Personal'
import CajaMovil from './pantallas/CajaMovil'
import Barriles from './pantallas/Barriles'
import Arqueo from './pantallas/Arqueo'

type Id = 'inicio' | 'caja' | 'movil' | 'barriles' | 'tarjetas' | 'grifos' | 'arqueo' | 'reportes' | 'personal'

type Item = {
  id: Id; texto: string; icono: Nombre; titulo: string; bajada: string
  soloAdmin?: boolean; grupo?: string
}

const ITEMS: Item[] = [
  { id: 'caja', texto: 'Caja', icono: 'caja',
    titulo: 'Caja', bajada: 'Consultar tarjetas y cargar saldo.' },
  { id: 'movil', texto: 'Caja móvil', icono: 'tarjeta',
    titulo: 'Caja móvil', bajada: 'El celular del mozo como lector de tarjetas.' },
  { id: 'inicio', texto: 'Panel', icono: 'inicio', soloAdmin: true,
    titulo: 'Panel del día', bajada: 'Cómo viene la jornada, en vivo.' },
  { id: 'tarjetas', texto: 'Tarjetas', icono: 'tarjeta', soloAdmin: true, grupo: 'Administración',
    titulo: 'Tarjetas', bajada: 'Padrón de tarjetas y saldo en circulación.' },
  { id: 'grifos', texto: 'Canillas', icono: 'grifo', soloAdmin: true,
    titulo: 'Canillas', bajada: 'Precio, calibración, estado y tokens.' },
  { id: 'barriles', texto: 'Barriles', icono: 'vacio', soloAdmin: true,
    titulo: 'Barriles', bajada: 'Cuánta cerveza queda en cada canilla.' },
  { id: 'arqueo', texto: 'Cierre de caja', icono: 'arqueo',
    titulo: 'Cierre de caja', bajada: 'Cuadrar el turno contra el cajón.' },
  { id: 'reportes', texto: 'Reportes', icono: 'grafico', soloAdmin: true,
    titulo: 'Reportes', bajada: 'Facturación y volumen servido.' },
  { id: 'personal', texto: 'Personal', icono: 'personas', soloAdmin: true,
    titulo: 'Personal', bajada: 'Quién puede entrar y con qué permisos.' },
]

export default function App() {
  return (
    <Limite>
      <ProveedorAvisos>
        <Contenido />
      </ProveedorAvisos>
    </Limite>
  )
}

function Contenido() {
  const { sesion, rol, nombre, cargando, esAdmin, esPersonal, salir } = useSesion()
  const { tema, setTema } = useTema()
  const [actual, setActual] = useState<Id>('caja')

  if (!sesion) return <Login />

  if (cargando) {
    return (
      <div className="portada">
        <div className="panel" style={{ width: 340 }}>
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="hueso" style={{ height: 18, width: '55%' }} />
            <div className="hueso" style={{ height: 12, width: '80%' }} />
            <div className="hueso" style={{ height: 12, width: '70%' }} />
          </div>
        </div>
      </div>
    )
  }

  if (!esPersonal) {
    return (
      <div className="portada">
        <div className="panel">
          <h2>Tu usuario todavía no tiene permisos</h2>
          <p className="bajada">
            Entraste bien, pero un administrador tiene que darte de alta como
            personal antes de que puedas operar.
          </p>
          <button className="btn bloque" onClick={salir}>Salir</button>
        </div>
      </div>
    )
  }

  const visibles = ITEMS.filter(i => !i.soloAdmin || esAdmin)
  const item = visibles.find(i => i.id === actual) ?? visibles[0]

  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca">
          <span aria-hidden="true">🍺</span>
          <span>Grifo<small>Gestión</small></span>
        </div>

        <nav className="nav" aria-label="Secciones">
          {visibles.map(i => (
            <div key={i.id}>
              {i.grupo && <div className="grupo">{i.grupo}</div>}
              <button onClick={() => setActual(i.id)}
                      aria-current={item.id === i.id ? 'page' : undefined}>
                <Icono nombre={i.icono} tam={17} />
                {i.texto}
              </button>
            </div>
          ))}
        </nav>

        <div className="pie-lateral">
          <div className="persona">
            <strong>{nombre ?? sesion.user.email}</strong>
            {rol === 'admin' ? 'Administrador' : 'Cajero'}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn fantasma sm" onClick={() => setTema(tema === 'oscuro' ? 'claro' : 'oscuro')}
                    title="Cambiar entre claro y oscuro">
              <Icono nombre={tema === 'oscuro' ? 'sol' : 'luna'} tam={15} />
            </button>
            <button className="btn fantasma sm crece" onClick={salir}>
              <Icono nombre="salir" tam={15} /> Salir
            </button>
          </div>
          {/* Sello de version. Entre el cache del navegador, el del hosting y un
              git pull que no se hizo, "¿estoy viendo la ultima?" es una
              adivinanza. Con esto se responde de un vistazo. */}
          <div style={{ fontSize: 10.5, color: 'var(--ink-3)', padding: '8px 10px 0',
                        fontFamily: 'ui-monospace, Menlo, monospace' }}
               title={`Compilado ${new Date(__COMPILADO__).toLocaleString('es-AR')}`}>
            v {__VERSION__}
          </div>
        </div>
      </aside>

      <div className="principal">
        <header className="encabezado">
          <div className="crece">
            <h1>{item.titulo}</h1>
            <p className="bajada">{item.bajada}</p>
          </div>
        </header>

        <main className="contenido">
          {item.id === 'caja'     && <Caja />}
          {item.id === 'movil'    && <CajaMovil />}
          {item.id === 'inicio'   && <Inicio />}
          {item.id === 'tarjetas' && <Tarjetas />}
          {item.id === 'grifos'   && <Grifos />}
          {item.id === 'barriles' && <Barriles />}
          {item.id === 'arqueo' && <Arqueo />}
          {item.id === 'reportes' && <Reportes />}
          {item.id === 'personal' && <Personal />}
        </main>
      </div>
    </div>
  )
}
