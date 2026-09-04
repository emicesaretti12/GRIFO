import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, volumen, fecha } from '../lib/plata'
import type { Arqueo as DatosArqueo } from '../lib/tipos'
import { Panel, Stat, Nota, Vacio, Hueso } from '../componentes/UI'
import { useAvisos } from '../componentes/Toast'
import Icono from '../componentes/Icono'

/** Un bar cierra de madrugada. Lo que se sirvió a las 2 AM pertenece al turno de
 *  la noche anterior, así que "hoy" arranca a las 6, igual que en el backend. */
function inicioDelDia(d = new Date()) {
  const x = new Date(d)
  if (x.getHours() < 6) x.setDate(x.getDate() - 1)
  x.setHours(6, 0, 0, 0)
  return x
}

/** Para los <input type="datetime-local">, que quieren hora local sin zona. */
function paraInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function Arqueo() {
  const { avisar } = useAvisos()
  const [desde, setDesde] = useState(() => paraInput(inicioDelDia()))
  const [hasta, setHasta] = useState(() => paraInput(new Date()))
  const [datos, setDatos] = useState<DatosArqueo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [contado, setContado] = useState('')

  const traer = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabase.rpc('arqueo', {
      p_desde: new Date(desde).toISOString(),
      p_hasta: new Date(hasta).toISOString(),
    })
    setCargando(false)
    if (error) { avisar('No pudimos armar el arqueo', { tono: 'grave', detalle: error.message }); return }
    const r = data as DatosArqueo | { ok: false; motivo: string }
    if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: 'El período está al revés.' }); return }
    setDatos(r)
  }, [desde, hasta, avisar])

  useEffect(() => { void traer() }, [traer])

  // Lo que el cajero contó en el cajón, contra lo que dice el sistema. La
  // diferencia es el único número que de verdad importa al cerrar.
  const diferencia = useMemo(() => {
    if (!datos) return null
    const limpio = contado.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
    if (limpio.trim() === '') return null
    const n = Number(limpio)
    if (!Number.isFinite(n)) return null
    return Math.round(n * 100) - datos.neto_caja_centavos
  }, [contado, datos])

  return (
    <>
      <Panel titulo="Período"
             accion={
               <button className="btn" onClick={() => void traer()} disabled={cargando}>
                 <Icono nombre="refrescar" tam={16} /> Actualizar
               </button>
             }>
        <div className="fila">
          <div className="crece">
            <label htmlFor="d">Desde</label>
            <input id="d" className="campo" type="datetime-local" value={desde}
                   onChange={e => setDesde(e.target.value)} />
          </div>
          <div className="crece">
            <label htmlFor="h">Hasta</label>
            <input id="h" className="campo" type="datetime-local" value={hasta}
                   onChange={e => setHasta(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => {
              setDesde(paraInput(inicioDelDia())); setHasta(paraInput(new Date()))
            }}>Hoy</button>
            <button className="btn" onClick={() => {
              const ayer = new Date(); ayer.setDate(ayer.getDate() - 1)
              setDesde(paraInput(inicioDelDia(ayer)))
              setHasta(paraInput(inicioDelDia()))
            }}>Ayer</button>
          </div>
        </div>
      </Panel>

      {cargando && !datos && <Hueso alto={220} />}

      {datos && (
        <>
          {datos.sesiones_abiertas > 0 && (
            <Nota tono="ojo">
              Hay {datos.sesiones_abiertas} {datos.sesiones_abiertas === 1
                ? 'tarjeta apoyada en un grifo' : 'tarjetas apoyadas en grifos'} en este
              momento. Mientras la sesión siga abierta, esa tarjeta no se puede devolver
              ni volver a usar en otra canilla.
            </Nota>
          )}

          <Panel titulo="El cajón"
                 bajada="Lo que entró y salió por el mostrador en este período.">
            <div className="rejilla c3">
              <Stat etiqueta="Cargas" valor={pesos(datos.cargas_centavos)}
                    pie={`${datos.cargas_cantidad} ${datos.cargas_cantidad === 1 ? 'carga' : 'cargas'}`} />
              <Stat etiqueta="Devoluciones" valor={`- ${pesos(datos.devoluciones_centavos)}`}
                    pie={`${datos.devoluciones_cantidad} ${datos.devoluciones_cantidad === 1 ? 'tarjeta devuelta' : 'tarjetas devueltas'}`} />
              <Stat etiqueta="Tiene que haber" valor={pesos(datos.neto_caja_centavos)} hero
                    pie="cargas menos devoluciones" />
            </div>

            <div className="fila" style={{ marginTop: 18, alignItems: 'flex-end' }}>
              <div className="crece">
                <label htmlFor="contado">¿Cuánto contaste en el cajón?</label>
                <input id="contado" className="campo" inputMode="decimal" value={contado}
                       placeholder="0,00" onChange={e => setContado(e.target.value)} />
              </div>
              {diferencia != null && (
                <div style={{ minWidth: 200 }}>
                  <Stat
                    etiqueta={diferencia === 0 ? 'Cuadra' : diferencia > 0 ? 'Sobra' : 'Falta'}
                    valor={<span style={{ color: diferencia === 0 ? 'var(--bien)' : 'var(--grave)' }}>
                      {diferencia === 0 ? '✓' : pesos(Math.abs(diferencia))}
                    </span>} />
                </div>
              )}
            </div>

            {datos.ajustes_cantidad > 0 && (
              <Nota tono="ojo">
                Se hicieron {datos.ajustes_cantidad} {datos.ajustes_cantidad === 1 ? 'ajuste' : 'ajustes'} de
                saldo por un neto de {pesos(datos.ajustes_centavos)}. Los ajustes NO mueven plata del
                cajón: corrigen saldo de tarjetas, así que no entran en el conteo de arriba.
              </Nota>
            )}
          </Panel>

          {datos.consumo && (
          <Panel titulo="Lo que se sirvió"
                 bajada="Facturación real del período, con el costo congelado de cada tirada.">
            <div className="rejilla c4">
              <Stat etiqueta="Servido" valor={volumen(datos.consumo.ml)}
                    pie={`${datos.consumo.sesiones} ${datos.consumo.sesiones === 1 ? 'tirada' : 'tiradas'}`} />
              <Stat etiqueta="Facturado" valor={pesos(datos.consumo.centavos)} />
              <Stat etiqueta="Costo" valor={pesos(datos.consumo.costo_centavos)} />
              <Stat etiqueta="Ganancia" valor={pesos(datos.margen_centavos ?? 0)}
                    pie={datos.consumo.centavos > 0
                      ? `${Math.round(((datos.margen_centavos ?? 0) / datos.consumo.centavos) * 100)}% de margen`
                      : undefined} />
            </div>
          </Panel>
          )}

          {datos.saldo_en_circulacion_centavos != null && (
          <Panel titulo="Saldo en circulación"
                 bajada="Plata que ya cobraste y todavía debés en cerveza.">
            <div className="rejilla c3">
              <Stat etiqueta="En las tarjetas" valor={pesos(datos.saldo_en_circulacion_centavos)} hero />
            </div>
            <Nota tono="info">
              Esto <strong>no es ganancia</strong>: es una deuda. Cada peso de acá es cerveza
              que alguien ya pagó y todavía no se tomó, o plata que va a pedir de vuelta cuando
              devuelva la tarjeta. Confundirla con ingreso es la forma más común de creer que
              te fue mejor de lo que te fue.
            </Nota>
          </Panel>
          )}

          {datos.por_persona && (
          <Panel titulo="Por persona"
                 bajada="Quién movió plata en este período.">
            {datos.por_persona.length === 0 ? (
              <Vacio titulo="Sin movimientos">Nadie movió plata en este período.</Vacio>
            ) : (
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr>
                      <th>Persona</th><th className="num">Cargas</th>
                      <th className="num">Devoluciones</th><th className="num">Ajustes</th>
                      <th className="num">Operaciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.por_persona.map(p => (
                      <tr key={p.nombre}>
                        <td>{p.nombre}</td>
                        <td className="num">{pesos(p.cargas)}</td>
                        <td className="num">{p.devoluciones ? `- ${pesos(p.devoluciones)}` : '—'}</td>
                        <td className="num">{p.ajustes ? pesos(p.ajustes) : '—'}</td>
                        <td className="num">{p.operaciones}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          )}

          <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            Período: {fecha(datos.desde)} → {fecha(datos.hasta)}
          </p>
        </>
      )}
    </>
  )
}
