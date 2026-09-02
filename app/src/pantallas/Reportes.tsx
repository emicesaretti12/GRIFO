import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, volumen, fecha } from '../lib/plata'
import type { Grifo, Sesion } from '../lib/tipos'

const DIAS = [
  { etiqueta: 'Hoy', dias: 0 },
  { etiqueta: '7 días', dias: 7 },
  { etiqueta: '30 días', dias: 30 },
]

export default function Reportes() {
  const [sesiones, setSesiones] = useState<Sesion[]>([])
  const [grifos, setGrifos] = useState<Grifo[]>([])
  const [rango, setRango] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true
    setCargando(true)
    const desde = new Date()
    if (rango === 0) desde.setHours(0, 0, 0, 0)
    else desde.setDate(desde.getDate() - rango)

    Promise.all([
      supabase.from('sesiones').select('*')
        .gte('abierta_en', desde.toISOString())
        .order('abierta_en', { ascending: false }).limit(500),
      supabase.from('grifos').select('*').order('id'),
    ]).then(([s, g]) => {
      if (!vigente) return
      if (s.error) setError(s.error.message)
      else { setSesiones(s.data as Sesion[]); setError(null) }
      if (!g.error) setGrifos(g.data as Grifo[])
      setCargando(false)
    })
    return () => { vigente = false }
  }, [rango])

  const nombreGrifo = useMemo(() => {
    const m = new Map(grifos.map(g => [g.id, g.nombre]))
    return (id: number) => m.get(id) ?? `Grifo ${id}`
  }, [grifos])

  const resumen = useMemo(() => {
    const cerradas = sesiones.filter(s => s.estado === 'cerrada')
    const porGrifo = new Map<number, { ml: number; centavos: number; n: number }>()
    for (const s of cerradas) {
      const a = porGrifo.get(s.grifo_id) ?? { ml: 0, centavos: 0, n: 0 }
      a.ml += s.ml_servidos ?? 0
      a.centavos += s.costo_centavos ?? 0
      a.n += 1
      porGrifo.set(s.grifo_id, a)
    }
    return {
      total: cerradas.reduce((a, s) => a + (s.costo_centavos ?? 0), 0),
      ml: cerradas.reduce((a, s) => a + (s.ml_servidos ?? 0), 0),
      servidas: cerradas.length,
      abiertas: sesiones.filter(s => s.estado === 'abierta').length,
      pendientes: sesiones.filter(s => s.estado === 'abandonada').length,
      recortadas: cerradas.filter(s => s.costo_recortado).length,
      reintentos: cerradas.filter(s => s.intentos_cierre > 1).length,
      porGrifo: [...porGrifo.entries()].sort((a, b) => b[1].centavos - a[1].centavos),
    }
  }, [sesiones])

  return (
    <>
      <div className="panel">
        <h2>Reportes</h2>
        <p className="sub">Lo servido y lo facturado, según las sesiones ya liquidadas.</p>

        <div className="fila" style={{ marginBottom: 16 }}>
          {DIAS.map((d, i) => (
            <div className="angosto" key={d.etiqueta}>
              <button className={rango === d.dias && (i !== 0 || rango === 0) ? 'btn primario' : 'btn'}
                      onClick={() => setRango(d.dias)}>{d.etiqueta}</button>
            </div>
          ))}
        </div>

        {error && <div className="aviso error">{error}</div>}
        {cargando ? <p className="vacio">Cargando…</p> : (
          <>
            <div className="grid2">
              <div>
                <label>Facturado</label>
                <div className="saldo">{pesos(resumen.total)}</div>
              </div>
              <div>
                <label>Servido</label>
                <div className="saldo">{volumen(resumen.ml)}</div>
              </div>
            </div>
            <p className="sub" style={{ marginTop: 12 }}>
              {resumen.servidas} tiradas liquidadas
              {resumen.abiertas > 0 && ` · ${resumen.abiertas} en curso`}
              {resumen.pendientes > 0 && ` · ${resumen.pendientes} sin liquidar`}
            </p>

            {(resumen.recortadas > 0 || resumen.reintentos > 0) && (
              <div className="aviso error">
                {resumen.recortadas > 0 && (
                  <div>
                    <strong>{resumen.recortadas} tiradas con cobro recortado.</strong> Se sirvió
                    más de lo que había en la tarjeta: el corte local del ESP32 falló. Revisá
                    la calibración de esa canilla.
                  </div>
                )}
                {resumen.reintentos > 0 && (
                  <div>
                    <strong>{resumen.reintentos} cierres reintentados.</strong> Al ESP32 no le
                    llegó la respuesta y volvió a mandar. Unos pocos son normales; muchos
                    indican problema de red en el bar.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {resumen.porGrifo.length > 0 && (
        <div className="panel">
          <h2>Por canilla</h2>
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Canilla</th><th className="num">Tiradas</th>
                  <th className="num">Servido</th><th className="num">Facturado</th>
                </tr>
              </thead>
              <tbody>
                {resumen.porGrifo.map(([id, a]) => (
                  <tr key={id}>
                    <td><strong>{nombreGrifo(id)}</strong></td>
                    <td className="num">{a.n}</td>
                    <td className="num">{volumen(a.ml)}</td>
                    <td className="num"><strong>{pesos(a.centavos)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel">
        <h2>Últimas tiradas</h2>
        {sesiones.length === 0 ? <p className="vacio">No hubo actividad en este período.</p> : (
          <div className="tabla-scroll">
            <table>
              <thead>
                <tr>
                  <th>Cuándo</th><th>Tarjeta</th><th>Canilla</th><th>Estado</th>
                  <th className="num">Servido</th><th className="num">Cobrado</th>
                </tr>
              </thead>
              <tbody>
                {sesiones.slice(0, 100).map(s => (
                  <tr key={s.id}>
                    <td>{fecha(s.abierta_en)}</td>
                    <td><span className="uid">{s.uid}</span></td>
                    <td>{nombreGrifo(s.grifo_id)}</td>
                    <td>
                      {s.estado === 'cerrada'
                        ? <span className="chip ok">Liquidada</span>
                        : s.estado === 'abierta'
                          ? <span className="chip info">En curso</span>
                          : <span className="chip alerta">Sin liquidar</span>}
                      {s.costo_recortado && <span className="chip alerta"> recortada</span>}
                    </td>
                    <td className="num">{volumen(s.ml_servidos)}</td>
                    <td className="num">{pesos(s.costo_centavos)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
