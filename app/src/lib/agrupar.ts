import type { Sesion } from './tipos'
import { claveDeJornada, inicioDeJornadaHace } from './jornada'

/** Agrupa las sesiones liquidadas por jornada (de 6 a 6), rellenando las que
 *  no tuvieron ventas con cero: si no, el gráfico miente — comprime el eje y
 *  sugiere continuidad.
 *
 *  Por jornada y no por día de calendario: lo servido a las 2 de la mañana es
 *  de la noche anterior. Y con la hora de acá, no en UTC (ver lib/jornada.ts). */
export function porDia(sesiones: Sesion[], dias: number) {
  const mapa = new Map<string, { centavos: number; costo: number; ml: number; n: number }>()

  for (let i = dias - 1; i >= 0; i--) {
    mapa.set(claveDeJornada(inicioDeJornadaHace(i)), { centavos: 0, costo: 0, ml: 0, n: 0 })
  }

  for (const s of sesiones) {
    if (s.estado !== 'cerrada') continue
    const clave = claveDeJornada(s.cerrada_en ?? s.abierta_en)
    const a = mapa.get(clave)
    if (!a) continue
    a.centavos += s.costo_centavos ?? 0
    a.costo += s.costo_producto_centavos ?? 0
    a.ml += s.ml_servidos ?? 0
    a.n += 1
  }

  return [...mapa.entries()].map(([fecha, a]) => ({ fecha, ...a }))
}

export function porGrifo(sesiones: Sesion[]) {
  const mapa = new Map<number, { centavos: number; costo: number; ml: number; n: number }>()
  for (const s of sesiones) {
    if (s.estado !== 'cerrada') continue
    const a = mapa.get(s.grifo_id) ?? { centavos: 0, costo: 0, ml: 0, n: 0 }
    a.centavos += s.costo_centavos ?? 0
    a.costo += s.costo_producto_centavos ?? 0
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
