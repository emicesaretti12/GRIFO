import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, volumen, fechaCorta } from '../lib/plata'
import { porDia, porGrifo, diaCorto } from '../lib/agrupar'
import { bajarCSV } from '../lib/csv'
import type { Grifo, Sesion } from '../lib/tipos'
import { Panel, Stat, Chip, Nota, Vacio, HuesoTabla, Hueso } from '../componentes/UI'
import { Columnas, Barras } from '../componentes/Grafico'
import { useAvisos } from '../componentes/Toast'
import Icono from '../componentes/Icono'

const RANGOS = [
  { id: 7,  texto: '7 días' },
  { id: 14, texto: '14 días' },
  { id: 30, texto: '30 días' },
  { id: 90, texto: '90 días' },
]

export default function Reportes() {
  const { avisar } = useAvisos()
  const [sesiones, setSesiones] = useState<Sesion[]>([])
  const [grifos, setGrifos] = useState<Grifo[]>([])
  const [dias, setDias] = useState(14)
  const [cargando, setCargando] = useState(true)

  const traer = useCallback(async () => {
    setCargando(true)
    const desde = new Date()
    desde.setDate(desde.getDate() - (dias - 1))
    desde.setHours(0, 0, 0, 0)

    const [s, g] = await Promise.all([
      supabase.from('sesiones').select('*')
        .gte('abierta_en', desde.toISOString())
        .order('abierta_en', { ascending: false }).limit(2000),
      supabase.from('grifos').select('*').order('id'),
    ])
    if (s.error) avisar('No pudimos leer las sesiones', { tono: 'grave', detalle: s.error.message })
    else setSesiones(s.data as Sesion[])
    if (!g.error) setGrifos(g.data as Grifo[])
    setCargando(false)
  }, [dias, avisar])

  useEffect(() => { void traer() }, [traer])

  const nombreGrifo = useMemo(() => {
    const m = new Map(grifos.map(g => [g.id, g.nombre]))
    return (id: number) => m.get(id) ?? `Canilla ${id}`
  }, [grifos])

  const r = useMemo(() => {
    const cerradas = sesiones.filter(s => s.estado === 'cerrada')
    const total = cerradas.reduce((a, s) => a + (s.costo_centavos ?? 0), 0)
    const ml = cerradas.reduce((a, s) => a + (s.ml_servidos ?? 0), 0)
    return {
      total, ml,
      tiradas: cerradas.length,
      promedio: cerradas.length ? Math.round(total / cerradas.length) : 0,
      porLitro: ml > 0 ? Math.round((total / ml) * 1000) : 0,
      recortadas: cerradas.filter(s => s.costo_recortado),
      reintentos: cerradas.filter(s => s.intentos_cierre > 1),
      sinLiquidar: sesiones.filter(s => s.estado === 'abandonada'),
    }
  }, [sesiones])

  const serie = useMemo(() => porDia(sesiones, dias), [sesiones, dias])
  const ranking = useMemo(() => porGrifo(sesiones), [sesiones])

  return (
    <>
      <Panel accion={
        <button className="btn sm" disabled={sesiones.length === 0}
                onClick={() => bajarCSV('tiradas', [
                  ['Fecha', 'Tarjeta', 'Canilla', 'Estado', 'ml', 'Pulsos', 'Cobrado', 'Recortado', 'Reintentos'],
                  ...sesiones.map(s => [
                    s.cerrada_en ?? s.abierta_en, s.uid, nombreGrifo(s.grifo_id), s.estado,
                    s.ml_servidos ?? '', s.pulsos ?? '',
                    s.costo_centavos != null ? (s.costo_centavos / 100).toFixed(2) : '',
                    s.costo_recortado ? 'si' : 'no', s.intentos_cierre,
                  ]),
                ])}>
          <Icono nombre="descargar" tam={15} /> Exportar CSV
        </button>
      }>
        <div className="grupo-btn">
          {RANGOS.map(x => (
            <button key={x.id} aria-pressed={dias === x.id} onClick={() => setDias(x.id)}>{x.texto}</button>
          ))}
        </div>
      </Panel>

      {cargando ? (
        <>
          <div className="rejilla c4">
            {[0,1,2,3].map(i => <div className="panel" key={i}><Hueso alto={13} ancho="55%" />
              <div style={{ height: 8 }} /><Hueso alto={28} ancho="70%" /></div>)}
          </div>
          <div className="panel"><Hueso alto={220} /></div>
        </>
      ) : (
        <>
          <div className="rejilla c4">
            <div className="panel"><Stat etiqueta="Facturado" valor={pesos(r.total)}
              pie={`${r.tiradas} tirada${r.tiradas === 1 ? '' : 's'}`} /></div>
            <div className="panel"><Stat etiqueta="Servido" valor={volumen(r.ml)} /></div>
            <div className="panel"><Stat etiqueta="Promedio por tirada" valor={pesos(r.promedio)} /></div>
            <div className="panel"><Stat etiqueta="Precio medio por litro" valor={pesos(r.porLitro)}
              pie="mezcla real de lo vendido" /></div>
          </div>

          {(r.recortadas.length > 0 || r.reintentos.length > 0 || r.sinLiquidar.length > 0) && (
            <Panel titulo="Cosas para mirar">
              {r.recortadas.length > 0 && (
                <Nota tono="grave">
                  <strong>{r.recortadas.length} tiradas con cobro recortado.</strong> Se sirvió más
                  de lo que había en la tarjeta y solo se pudo cobrar hasta el saldo: el corte
                  local del ESP32 no llegó a tiempo. Casi siempre es la calibración
                  (<em>pulsos por litro</em>) mal medida en esa canilla.
                </Nota>
              )}
              {r.reintentos.length > 0 && (
                <Nota tono="ojo">
                  <strong>{r.reintentos.length} cierres reintentados.</strong> Al ESP32 no le llegó
                  la respuesta y volvió a mandar. La idempotencia evitó el cobro doble, pero muchos
                  reintentos indican problema de WiFi en el bar.
                </Nota>
              )}
              {r.sinLiquidar.length > 0 && (
                <Nota tono="ojo">
                  <strong>{r.sinLiquidar.length} sesiones sin liquidar.</strong> Quedaron colgadas
                  (se cortó la luz o el ESP32 se reinició). La tarjeta ya está libre; el cobro
                  entra cuando el ESP32 drene su cola.
                </Nota>
              )}
            </Panel>
          )}

          <Panel titulo={`Facturación por día · últimos ${dias} días`}
                 bajada="Solo tiradas ya liquidadas. Pasá el mouse por una barra para el detalle.">
            <Columnas alto={230}
                      datos={serie.map(d => ({
                        etiqueta: diaCorto(d.fecha),
                        valor: d.centavos,
                        detalle: `${d.n} tirada${d.n === 1 ? '' : 's'} · ${volumen(d.ml)}`,
                      }))}
                      formato={n => pesos(n)} />
          </Panel>

          <div className="rejilla lado">
            <Panel titulo="Facturado por canilla">
              {ranking.length === 0
                ? <Vacio icono="grifo" titulo="Sin ventas en el período" />
                : <Barras datos={ranking.map(([id, a]) => ({
                            etiqueta: nombreGrifo(id), valor: a.centavos, detalle: volumen(a.ml),
                          }))} formato={n => pesos(n)} />}
            </Panel>

            <Panel titulo="Volumen por canilla">
              {ranking.length === 0
                ? <Vacio icono="grifo" titulo="Sin ventas en el período" />
                : <Barras datos={[...ranking].sort((a, b) => b[1].ml - a[1].ml).map(([id, a]) => ({
                            etiqueta: nombreGrifo(id), valor: a.ml,
                            detalle: `${a.n} tirada${a.n === 1 ? '' : 's'}`,
                          }))} formato={n => volumen(n)} />}
            </Panel>
          </div>

          <Panel titulo="Últimas tiradas"
                 bajada={sesiones.length > 50
                   ? `Las 50 más recientes de ${sesiones.length}. Bajá el CSV para verlas todas.`
                   : `${sesiones.length} en el período.`} pegado>
            {sesiones.length === 0 ? (
              <Vacio icono="reloj" titulo="No hubo actividad">
                Probá con un rango más largo.
              </Vacio>
            ) : (
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr>
                      <th>Cuándo</th><th>Tarjeta</th><th>Canilla</th><th>Estado</th>
                      <th className="num">Servido</th><th className="num">Cobrado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sesiones.slice(0, 50).map(s => (
                      <tr key={s.id}>
                        <td style={{ color: 'var(--ink-2)' }}>{fechaCorta(s.cerrada_en ?? s.abierta_en)}</td>
                        <td><span className="uid">{s.uid}</span></td>
                        <td>{nombreGrifo(s.grifo_id)}</td>
                        <td>
                          {s.estado === 'cerrada' ? <Chip tono="bien">Liquidada</Chip>
                            : s.estado === 'abierta' ? <Chip tono="dato">En curso</Chip>
                            : <Chip tono="ojo">Sin liquidar</Chip>}
                          {s.costo_recortado && <> <Chip tono="grave">recortada</Chip></>}
                        </td>
                        <td className="num">{volumen(s.ml_servidos)}</td>
                        <td className="num" style={{ fontWeight: 600 }}>{pesos(s.costo_centavos)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
      {cargando && <div className="panel pegado"><HuesoTabla /></div>}
    </>
  )
}
