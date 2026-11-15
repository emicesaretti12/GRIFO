import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, volumen, fecha } from '../lib/plata'
import { NOMBRE_MEDIO, MEDIOS, type Arqueo as DatosArqueo } from '../lib/tipos'
import { inicioDeJornada as inicioDelDia } from '../lib/jornada'
import { Panel, Stat, Nota, Vacio, Hueso } from '../componentes/UI'
import { useAvisos } from '../componentes/Toast'
import Icono from '../componentes/Icono'

/** Para los <input type="datetime-local">, que quieren hora local sin zona. */
function paraInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function Arqueo() {
  const { avisar } = useAvisos()
  const [desde, setDesde] = useState(() => paraInput(inicioDelDia()))
  // null = "hasta ahora mismo". Mientras nadie fije una hora, cada actualización
  // llega hasta el instante en que se pide. Antes quedaba clavada en el minuto
  // en que se abrió la pantalla: lo cobrado después no entraba en el cierre.
  const [hasta, setHasta] = useState<string | null>(null)
  const [datos, setDatos] = useState<DatosArqueo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [contado, setContado] = useState('')

  const traer = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabase.rpc('arqueo', {
      p_desde: new Date(desde).toISOString(),
      p_hasta: hasta ? new Date(hasta).toISOString() : null,
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
            <input id="h" className="campo" type="datetime-local"
                   value={hasta ?? paraInput(datos ? new Date(datos.hasta) : new Date())}
                   onChange={e => setHasta(e.target.value || null)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => {
              setDesde(paraInput(inicioDelDia())); setHasta(null)
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
                ? 'cliente sirviendo' : 'clientes sirviendo'} en este momento. Lo que
              están tomando todavía no figura acá: entra cuando cierran la canilla.
            </Nota>
          )}

          <Panel titulo="El cajón"
                 bajada="Los billetes que entraron y salieron por el mostrador en este período.">
            <div className="rejilla c3">
              <Stat etiqueta="Cobrado en efectivo" valor={pesos(datos.efectivo_centavos ?? datos.cargas_centavos)}
                    pie={`de ${pesos(datos.cargas_centavos)} cargados en total`} />
              <Stat etiqueta="Devoluciones" valor={`- ${pesos(datos.devoluciones_centavos)}`}
                    pie={`${datos.devoluciones_cantidad} ${datos.devoluciones_cantidad === 1 ? 'devolución' : 'devoluciones'}, siempre en efectivo`} />
              <Stat etiqueta="Tiene que haber" valor={pesos(datos.neto_caja_centavos)} hero
                    pie="efectivo cobrado menos devoluciones" />
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

            {datos.cargas_por_medio && Object.keys(datos.cargas_por_medio).length > 0 && (
              <div className="scroll-x" style={{ marginTop: 18 }}>
                <table>
                  <caption className="sr">Cargas del período, por medio de pago</caption>
                  <thead>
                    <tr><th>Cómo pagaron</th><th className="num">Cargas</th><th className="num">Total</th><th>Dónde está la plata</th></tr>
                  </thead>
                  <tbody>
                    {/* En el orden de la caja, y al final cualquier medio que la app no conozca. */}
                    {[...MEDIOS.map(m => m.id as string),
                      ...Object.keys(datos.cargas_por_medio).filter(k => !MEDIOS.some(m => m.id === k))]
                      .filter(k => datos.cargas_por_medio![k])
                      .map(k => (
                        <tr key={k}>
                          <td style={{ fontWeight: 600 }}>{NOMBRE_MEDIO[k] ?? k}</td>
                          <td className="num">{datos.cargas_por_medio![k].cantidad}</td>
                          <td className="num" style={{ fontWeight: 600 }}>{pesos(datos.cargas_por_medio![k].centavos)}</td>
                          <td style={{ color: 'var(--ink-2)' }}>
                            {k === 'efectivo' ? 'En el cajón'
                              : k === 'mercadopago' ? 'En la cuenta de Mercado Pago'
                              : k === 'transferencia' ? 'En la cuenta del banco'
                              : 'En la liquidación del posnet'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            {datos.ajustes_cantidad > 0 && (
              <Nota tono="ojo">
                Se hicieron {datos.ajustes_cantidad} {datos.ajustes_cantidad === 1 ? 'ajuste' : 'ajustes'} de
                saldo por un neto de {pesos(datos.ajustes_centavos)}. Los ajustes NO mueven plata del
                cajón: corrigen el saldo de una cuenta, así que no entran en el conteo de arriba.
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
              <Stat etiqueta="En las cuentas" valor={pesos(datos.saldo_en_circulacion_centavos)} hero />
            </div>
            <Nota tono="info">
              Esto <strong>no es ganancia</strong>: es una deuda. Cada peso de acá es cerveza
              que alguien ya pagó y todavía no se tomó, o plata que va a pedir de vuelta antes
              de irse. Confundirla con ingreso es la forma más común de creer que
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
                      <th>Persona</th><th className="num">Cargas</th><th className="num">En efectivo</th>
                      <th className="num">Devoluciones</th><th className="num">Ajustes</th>
                      <th className="num">Operaciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos.por_persona.map(p => (
                      <tr key={p.nombre}>
                        <td>{p.nombre}</td>
                        <td className="num">{pesos(p.cargas)}</td>
                        <td className="num">{p.efectivo != null ? pesos(p.efectivo) : '—'}</td>
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
