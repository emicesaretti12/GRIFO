import type { ReactNode } from 'react'
import Icono, { type Nombre } from './Icono'

export function Panel({ titulo, bajada, accion, children, pegado }: {
  titulo?: string; bajada?: string; accion?: ReactNode; children: ReactNode; pegado?: boolean
}) {
  return (
    <section className={pegado ? 'panel pegado' : 'panel'}>
      {(titulo || accion) && (
        <div className="panel-cabecera" style={pegado ? { padding: '18px 20px 0' } : undefined}>
          <div className="crece">
            {titulo && <h2>{titulo}</h2>}
            {bajada && <p className="bajada">{bajada}</p>}
          </div>
          {accion}
        </div>
      )}
      {children}
    </section>
  )
}

export function Stat({ etiqueta, valor, pie, hero }: {
  etiqueta: string; valor: ReactNode; pie?: ReactNode; hero?: boolean
}) {
  return (
    <div className={hero ? 'stat hero' : 'stat'}>
      <span className="etiqueta">{etiqueta}</span>
      <span className="valor">{valor}</span>
      {pie && <span className="pie">{pie}</span>}
    </div>
  )
}

export function Chip({ tono = 'neutro', children }: {
  tono?: 'neutro' | 'bien' | 'ojo' | 'grave' | 'dato'; children: ReactNode
}) {
  return <span className={`chip ${tono === 'neutro' ? '' : tono}`}><i className="punto" />{children}</span>
}

export function Nota({ tono = 'info', children }: {
  tono?: 'info' | 'bien' | 'grave' | 'ojo'; children: ReactNode
}) {
  const icono: Record<string, Nombre> = { info: 'info', bien: 'ok', grave: 'alerta', ojo: 'alerta' }
  return (
    <div className={`nota ${tono}`} role={tono === 'grave' ? 'alert' : undefined}>
      <Icono nombre={icono[tono]} tam={17} />
      <div>{children}</div>
    </div>
  )
}

export function Vacio({ icono = 'vacio', titulo, children }: {
  icono?: Nombre; titulo: string; children?: ReactNode
}) {
  return (
    <div className="vacio">
      <Icono nombre={icono} tam={30} />
      <h3>{titulo}</h3>
      {children && <p>{children}</p>}
    </div>
  )
}

/** Bloques grises que laten mientras carga. Mucho mejor que un "Cargando…":
 *  el usuario ya ve la forma de lo que viene y la página no salta. */
export function Hueso({ alto = 16, ancho = '100%' }: { alto?: number; ancho?: number | string }) {
  return <div className="hueso" style={{ height: alto, width: ancho }} />
}

export function HuesoTabla({ filas = 5, columnas = 4 }: { filas?: number; columnas?: number }) {
  return (
    <div style={{ padding: 14, display: 'grid', gap: 12 }}>
      {Array.from({ length: filas }).map((_, f) => (
        <div key={f} style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(${columnas}, 1fr)` }}>
          {Array.from({ length: columnas }).map((_, c) => (
            <Hueso key={c} alto={14} ancho={c === 0 ? '70%' : '50%'} />
          ))}
        </div>
      ))}
    </div>
  )
}
