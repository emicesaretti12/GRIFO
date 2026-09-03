import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, volumen, fecha } from '../lib/plata'
import { porDia, porGrifo, diaCorto } from '../lib/agrupar'
import { useIntervalo } from '../lib/useIntervalo'
import type { Grifo, Sesion } from '../lib/tipos'
import { Panel, Stat, Chip, Nota, Vacio, Hueso } from '../componentes/UI'
import { Columnas, Barras } from '../componentes/Grafico'
import Icono from '../componentes/Icono'

const REFRESCO_MS = 20000

export default function Inicio() {
  const [sesiones, setSesiones] = useState<Sesion[]>([])
  const [grifos, setGrifos] = useState<Grifo[]>([])
  const [cargando, setCargando] = useState(true)
  const [actualizado, setActualizado] = useState<Date | null>(null)

  const traer = useCallback(async () => {
    const desde = new Date(); desde.setDate(desde.getDate() - 13); desde.setHours(0, 0, 0, 0)
    const [s, g] = await Promise.all([
      supabase.from('sesiones').select('*')
        .gte('abierta_en', desde.toISOString())
        .order('abierta_en', { ascending: false }).limit(1000),
      supabase.from('grifos').select('*').order('id'),
    ])
    if (!s.error) setSesiones(s.data as Sesion[])
    if (!g.error) setGrifos(g.data as Grifo[])
    setCargando(false); setActualizado(new Date())
  }, [])

  useEffect(() => { void traer() }, [traer])
  useIntervalo(traer, REFRESCO_MS)

  const nombreGrifo = useMemo(() => {
    const m = new Map(grifos.map(g => [g.id, g.nombre]))
    return (id: number) => m.get(id) ?? `Canilla ${id}`
  }, [grifos])

  const hoy = useMemo(() => {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0)
    const delDia = sesiones.filter(s => new Date(s.abierta_en) >= d0)
    const cerradas = delDia.filter(s => s.estado === 'cerrada')
    const facturado = cerradas.reduce((a, s) => a + (s.costo_centavos ?? 0), 0)
    const costo = cerradas.reduce((a, s) => a + (s.costo_producto_centavos ?? 0), 0)
    return {
      facturado, costo,
      ganancia: facturado - costo,
      hayCosto: cerradas.some(s => (s.costo_producto_centavos ?? 0) > 0),
      ml: cerradas.reduce((a, s) => a + (s.ml_servidos ?? 0), 0),
      tiradas: cerradas.length,
    }
  }, [sesiones])

  const enCurso = sesiones.filter(s => s.estado === 'abierta')
  const sinLiquidar = sesiones.filter(s => s.estado === 'abandonada')
  const recortadas = sesiones.filter(s => s.estado === 'cerrada' && s.costo_recortado)
  const sinToken = grifos.filter(g => g.activo && g.token_rotado_en === null)

  const dias = useMemo(() => porDia(sesiones, 14), [sesiones])
  const ranking = useMemo(() => porGrifo(sesiones), [sesiones])

  if (cargando) {
    return (
      <>
        <div className="rejilla c4">
          {[0, 1, 2, 3].map(i => (
            <div className="panel" key={i} style={{ display: 'grid', gap: 10 }}>
              <Hueso alto={13} ancho="55%" /><Hueso alto={30} ancho="70%" />
            </div>
          ))}
        </div>
        <div className="panel"><Hueso alto={200} /></div>
      </>
    )
  }

  return (
    <>
      {(sinToken.length > 0 || recortadas.length > 0 || sinLiquidar.length > 0) && (
        <div style={{ marginBottom: 16 }}>
          {sinToken.length > 0 && (
            <Nota tono="grave">
              <strong>{sinToken.length} canilla{sinToken.length > 1 ? 's' : ''} en servicio sin token.</strong>{' '}
              No pueden operar hasta que les generes uno desde Canillas.
            </Nota>
          )}
          {recortadas.length > 0 && (
            <Nota tono="ojo">
              <strong>{recortadas.length} tirada{recortadas.length > 1 ? 's' : ''} con cobro recortado.</strong>{' '}
              Se sirvió más de lo que había en la tarjeta: el corte local del ESP32 no llegó
              a tiempo. Revisá la calibración de esa canilla.
            </Nota>
          )}
          {sinLiquidar.length > 0 && (
            <Nota tono="ojo">
              <strong>{sinLiquidar.length} sesión{sinLiquidar.length > 1 ? 'es' : ''} sin liquidar.</strong>{' '}
              Quedaron colgadas y el ESP32 todavía no mandó el cierre.
            </Nota>
          )}
        </div>
      )}

      <div className="rejilla c4">
        <div className="panel"><Stat etiqueta="Facturado hoy" valor={pesos(hoy.facturado)}
          pie={`${hoy.tiradas} tirada${hoy.tiradas === 1 ? '' : 's'}`} /></div>
        <div className="panel"><Stat etiqueta="Servido hoy" valor={volumen(hoy.ml)} /></div>
        <div className="panel">
          {hoy.hayCosto
            ? <Stat etiqueta="Ganancia hoy" valor={pesos(hoy.ganancia)}
                    pie={`costo ${pesos(hoy.costo)}`} />
            : <Stat etiqueta="Ganancia hoy" valor="—" pie="falta el costo por litro" />}
        </div>
        <div className="panel"><Stat etiqueta="Sirviendo ahora" valor={String(enCurso.length)}
          pie={enCurso.length ? 'en curso' : 'ninguna canilla activa'} /></div>
      </div>

      <div className="rejilla lado">
        <Panel titulo="Facturación de los últimos 14 días"
               bajada="Solo tiradas ya liquidadas."
               accion={actualizado && (
                 <span style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
                   <Icono nombre="refrescar" tam={12} />{' '}
                   {actualizado.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                 </span>
               )}>
          <Columnas alto={210}
                    datos={dias.map(d => ({
                      etiqueta: diaCorto(d.fecha),
                      valor: d.centavos,
                      detalle: `${d.n} tirada${d.n === 1 ? '' : 's'} · ${volumen(d.ml)}`,
                    }))}
                    formato={n => pesos(n)} />
        </Panel>

        <Panel titulo="Por canilla" bajada="Facturado en los últimos 14 días.">
          {ranking.length === 0 ? (
            <Vacio icono="grifo" titulo="Todavía no se sirvió nada" />
          ) : (
            <Barras datos={ranking.map(([id, a]) => ({
                      etiqueta: nombreGrifo(id),
                      valor: a.centavos,
                      detalle: volumen(a.ml),
                    }))}
                    formato={n => pesos(n)} />
          )}
        </Panel>
      </div>

      <Panel titulo="Sirviendo ahora"
             bajada="Se actualiza solo cada 20 segundos." pegado>
        {enCurso.length === 0 ? (
          <Vacio icono="grifo" titulo="Ninguna canilla en uso">
            Cuando alguien apoye una tarjeta, la vas a ver acá.
          </Vacio>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr><th>Tarjeta</th><th>Canilla</th><th>Desde</th><th className="num">Tope</th></tr>
              </thead>
              <tbody>
                {enCurso.map(s => (
                  <tr key={s.id}>
                    <td><span className="uid">{s.uid}</span></td>
                    <td>{nombreGrifo(s.grifo_id)}</td>
                    <td style={{ color: 'var(--ink-2)' }}>{fecha(s.abierta_en)}</td>
                    <td className="num"><Chip tono="dato">en curso</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}
