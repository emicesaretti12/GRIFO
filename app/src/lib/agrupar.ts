import type { Sesion } from './tipos'

/** Agrupa las sesiones liquidadas por día, rellenando los días sin ventas con
 *  cero: si no, el gráfico miente — comprime el eje y sugiere continuidad. */
export function porDia(sesiones: Sesion[], dias: number) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const mapa = new Map<string, { centavos: number; ml: number; n: number }>()

  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoy); d.setDate(d.getDate() - i)
    mapa.set(d.toISOString().slice(0, 10), { centavos: 0, ml: 0, n: 0 })
  }

  for (const s of sesiones) {
    if (s.estado !== 'cerrada') continue
    const clave = new Date(s.cerrada_en ?? s.abierta_en).toISOString().slice(0, 10)
    const a = mapa.get(clave)
    if (!a) continue
    a.centavos += s.costo_centavos ?? 0
    a.ml += s.ml_servidos ?? 0
    a.n += 1
  }

  return [...mapa.entries()].map(([fecha, a]) => ({ fecha, ...a }))
}

export function porGrifo(sesiones: Sesion[]) {
  const mapa = new Map<number, { centavos: number; ml: number; n: number }>()
  for (const s of sesiones) {
    if (s.estado !== 'cerrada') continue
    const a = mapa.get(s.grifo_id) ?? { centavos: 0, ml: 0, n: 0 }
    a.centavos += s.costo_centavos ?? 0
    a.ml += s.ml_servidos ?? 0
    a.n += 1
    mapa.set(s.grifo_id, a)
  }
  return [...mapa.entries()].sort((a, b) => b[1].centavos - a[1].centavos)
}

/** "3/9" para el eje del gráfico. */
export function diaCorto(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return `${d.getDate()}/${d.getMonth() + 1}`
}
