import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLectorRFID } from '../lib/useLectorRFID'
import { useSesion } from '../lib/useSesion'
import { normalizarUid, type FormatoLector } from '../lib/uid'
import { pesos, aCentavos, volumen, fecha } from '../lib/plata'
import { mensajeDeError, type RespuestaFicha, type FichaTarjeta,
         type RespuestaDevolucion } from '../lib/tipos'
import { Panel, Stat, Chip, Nota, Vacio, Hueso } from '../componentes/UI'
import { Modal } from '../componentes/Modal'
import { useAvisos } from '../componentes/Toast'
import Icono from '../componentes/Icono'

const RAPIDOS = [200000, 500000, 1000000, 2000000]

export default function Caja() {
  const { avisar } = useAvisos()
  const { esAdmin } = useSesion()
  const [uid, setUid] = useState('')
  const [ficha, setFicha] = useState<FichaTarjeta | null>(null)
  const [esNueva, setEsNueva] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [monto, setMonto] = useState('')
  const [modalBloqueo, setModalBloqueo] = useState(false)
  const [ajuste, setAjuste] = useState<{ monto: string; motivo: string } | null>(null)
  const [modalDevolver, setModalDevolver] = useState(false)
  const [motivo, setMotivo] = useState('')
  const entrada = useRef<HTMLInputElement>(null)

  const [formato, setFormato] = useState<FormatoLector>(
    () => (localStorage.getItem('grifo.formatoLector') as FormatoLector) ?? 'hex'
  )
  useEffect(() => { localStorage.setItem('grifo.formatoLector', formato) }, [formato])

  const buscar = useCallback(async (crudo: string) => {
    const limpio = normalizarUid(crudo, 'hex')
    if (!limpio) return
    setBuscando(true); setFicha(null); setEsNueva(false)

    const { data, error } = await supabase.rpc('caja_buscar_tarjeta', { p_uid: limpio })
    setBuscando(false)

    if (error) { avisar('No pudimos consultar', { tono: 'grave', detalle: error.message }); return }
    const r = data as RespuestaFicha
    if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: mensajeDeError(r) }); return }

    setUid(r.uid)
    if (r.existe) setFicha(r as FichaTarjeta); else setEsNueva(true)
  }, [avisar])

  useLectorRFID({ alLeer: u => { setUid(u); void buscar(u) }, formato })

  // F2 vuelve el foco al campo de la tarjeta desde cualquier parte de la pantalla.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); entrada.current?.focus(); entrada.current?.select() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function cargar(centavos: number) {
    if (!uid || centavos <= 0) return
    setOcupado(true)
    const { data, error } = await supabase.rpc('caja_cargar_saldo', {
      p_uid: uid, p_centavos: centavos, p_referencia: 'caja',
      p_clave_idempotencia: `caja:${uid}:${centavos}:${Date.now()}`,
    })
    setOcupado(false)

    if (error) { avisar('No pudimos cargar', { tono: 'grave', detalle: error.message }); return }
    const r = data as { ok: boolean; motivo?: string; saldo_centavos?: number }
    if (!r.ok) { avisar('No se pudo cargar', { tono: 'grave', detalle: mensajeDeError(r) }); return }

    avisar(`Cargaste ${pesos(centavos)}`, { tono: 'bien', detalle: `Saldo nuevo: ${pesos(r.saldo_centavos!)}` })
    setMonto('')
    void buscar(uid)
  }

  async function cambiarBloqueo(bloquear: boolean) {
    setOcupado(true)
    const { data, error } = await supabase.rpc('caja_bloquear_tarjeta', {
      p_uid: uid, p_bloquear: bloquear, p_motivo: bloquear ? motivo : null,
    })
    setOcupado(false); setModalBloqueo(false); setMotivo('')

    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return }
    const r = data as { ok: boolean; motivo?: string }
    if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: mensajeDeError(r) }); return }

    avisar(bloquear ? 'Tarjeta bloqueada' : 'Tarjeta desbloqueada', { tono: 'bien' })
    void buscar(uid)
  }

  // Devolver la tarjeta: el cliente se va, se le da en efectivo lo que le
  // sobró y la tarjeta vuelve limpia a la pila. Sin esto, el saldo se queda
  // adentro y el próximo que agarre esa tarjeta se sirve gratis.
  async function devolver() {
    setOcupado(true)
    const { data, error } = await supabase.rpc('caja_devolver_tarjeta', { p_uid: uid })
    setOcupado(false); setModalDevolver(false)
    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return }
    const r = data as RespuestaDevolucion
    if (!r.ok) { avisar('No se pudo devolver', { tono: 'grave', detalle: mensajeDeError(r) }); return }
    avisar(
      r.devuelto_centavos > 0 ? `Devolvele ${pesos(r.devuelto_centavos)} en efectivo` : 'Tarjeta liberada',
      { tono: 'bien',
        detalle: r.devuelto_centavos > 0
          ? 'La tarjeta quedó en cero y lista para el próximo cliente.'
          : 'No tenía saldo. Ya está lista para el próximo cliente.' }
    )
    void buscar(uid)
  }

  async function ajustar(centavos: number, motivo: string) {
    setOcupado(true)
    const { data, error } = await supabase.rpc('admin_ajustar_saldo', {
      p_uid: uid, p_centavos: centavos, p_motivo: motivo,
    })
    setOcupado(false); setAjuste(null)
    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return }
    const r = data as { ok: boolean; motivo?: string; detalle?: string; saldo_centavos?: number }
    if (!r.ok) { avisar('No se pudo ajustar', { tono: 'grave', detalle: mensajeDeError(r) }); return }
    avisar('Saldo ajustado', { tono: 'bien', detalle: `Nuevo saldo: ${pesos(r.saldo_centavos!)}` })
    void buscar(uid)
  }

  const montoCentavos = aCentavos(monto)

  return (
    <>
      <Panel>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); void buscar(uid) }}>
          <div className="fila">
            <div className="crece" style={{ minWidth: 260 }}>
              <label htmlFor="uid">
                Tarjeta <span style={{ fontWeight: 500, color: 'var(--ink-3)' }}>· apoyala en el lector o escribí el número (F2)</span>
              </label>
              <input id="uid" ref={entrada} className="campo mono xl" value={uid} autoFocus
                     placeholder="A1B2C3D4" spellCheck={false}
                     onChange={e => setUid(e.target.value.toUpperCase())} />
            </div>
            <div>
              <label htmlFor="formato">Lector</label>
              <select id="formato" className="campo" value={formato} style={{ width: 165 }}
                      onChange={e => setFormato(e.target.value as FormatoLector)}>
                <option value="hex">Hexadecimal</option>
                <option value="decimal">Decimal</option>
              </select>
            </div>
            <button className="btn primario lg" disabled={buscando || !uid}>
              <Icono nombre="buscar" tam={16} /> Buscar
            </button>
            {(ficha || esNueva) && (
              <button type="button" className="btn lg" onClick={() => {
                setUid(''); setFicha(null); setEsNueva(false); setMonto('')
                entrada.current?.focus()
              }}>Limpiar</button>
            )}
          </div>
        </form>
      </Panel>

      {buscando && (
        <div className="panel"><div style={{ display: 'grid', gap: 14 }}>
          <Hueso alto={18} ancho="35%" /><Hueso alto={40} ancho="45%" /><Hueso alto={14} ancho="70%" />
        </div></div>
      )}

      {!buscando && !ficha && !esNueva && (
        <Panel>
          <Vacio icono="tarjeta" titulo="Ninguna tarjeta consultada">
            Apoyá una tarjeta en el lector para ver su saldo y cargarle plata.
          </Vacio>
        </Panel>
      )}

      {esNueva && (
        <Panel titulo="Tarjeta nueva" bajada={`${uid} todavía no está registrada.`}>
          <Nota tono="info">
            No es un error: la tarjeta se da de alta sola con la primera carga.
          </Nota>
          <Cargador monto={monto} setMonto={setMonto} montoCentavos={montoCentavos}
                    ocupado={ocupado} onCargar={cargar} />
        </Panel>
      )}

      {ficha && (
        <div className="rejilla lado">
          <div>
            <Panel>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span className="uid">{ficha.uid}</span>
                {ficha.bloqueada ? <Chip tono="grave">Bloqueada</Chip> : <Chip tono="bien">Activa</Chip>}
                {ficha.sesion_abierta && <Chip tono="dato">Sirviendo</Chip>}
              </div>

              <Stat etiqueta="Saldo disponible" valor={pesos(ficha.saldo_centavos)} hero />

              {ficha.bloqueada && (
                <Nota tono="grave">
                  Bloqueada{ficha.bloqueada_motivo ? `: ${ficha.bloqueada_motivo}` : '.'} No puede
                  abrir sesión en ninguna canilla hasta desbloquearla.
                </Nota>
              )}

              {ficha.sesion_abierta && (
                <Nota tono="info">
                  Está sirviendo ahora en la canilla {ficha.sesion_abierta.grifo_id}, con un tope
                  de {volumen(ficha.sesion_abierta.ml_maximos)}. Empezó {fecha(ficha.sesion_abierta.abierta_en)}.
                </Nota>
              )}

              <div style={{ marginTop: 18 }}>
                <span className="etiqueta-campo">Cargar saldo</span>
                <Cargador monto={monto} setMonto={setMonto} montoCentavos={montoCentavos}
                          ocupado={ocupado || ficha.bloqueada} onCargar={cargar} />
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <button className={ficha.bloqueada ? 'btn crece' : 'btn grave crece'}
                        disabled={ocupado}
                        onClick={() => ficha.bloqueada ? cambiarBloqueo(false) : setModalBloqueo(true)}>
                  <Icono nombre={ficha.bloqueada ? 'candado-abierto' : 'candado'} tam={16} />
                  {ficha.bloqueada ? 'Desbloquear' : 'Bloquear'}
                </button>
                {/* Corregir un error de carga es cosa de admin y siempre con
                    motivo: un ajuste sin explicación es un agujero por donde se
                    va la plata sin que nadie pueda reconstruir qué pasó. */}
                {esAdmin && (
                  <button className="btn" disabled={ocupado}
                          onClick={() => setAjuste({ monto: '', motivo: '' })}>
                    <Icono nombre="lapiz" tam={16} /> Ajustar saldo
                  </button>
                )}
                {/* Las tarjetas se reusan. Devolverla es lo que la deja en cero
                    y borra al cliente anterior antes de que vuelva a la pila. */}
                <button className="btn crece" disabled={ocupado || !!ficha.sesion_abierta}
                        onClick={() => setModalDevolver(true)}
                        title={ficha.sesion_abierta ? 'Está apoyada en un grifo. Retirala primero.' : undefined}>
                  <Icono nombre="devolver" tam={16} /> Devolver tarjeta
                </button>
              </div>
            </Panel>
          </div>

          <Panel titulo="Movimientos" bajada="Las 15 operaciones más recientes." pegado>
            {ficha.movimientos.length === 0 ? (
              <Vacio icono="reloj" titulo="Sin movimientos">Esta tarjeta todavía no se usó.</Vacio>
            ) : (
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr><th>Cuándo</th><th>Qué</th><th className="num">Monto</th><th className="num">Saldo</th></tr>
                  </thead>
                  <tbody>
                    {ficha.movimientos.map(m => (
                      <tr key={m.id}>
                        <td style={{ color: 'var(--ink-2)' }}>{fecha(m.creado_en)}</td>
                        <td title={m.motivo ?? undefined}>
                          {m.tipo === 'carga'   ? <Chip tono="bien">Carga</Chip>
                          : m.tipo === 'ajuste' ? <Chip tono="ojo">Ajuste</Chip>
                          :                       <Chip tono="dato">Consumo</Chip>}
                        </td>
                        <td className="num" style={{ fontWeight: 600 }}>{pesos(m.centavos)}</td>
                        <td className="num" style={{ color: 'var(--ink-2)' }}>{pesos(m.saldo_resultante)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      {modalDevolver && ficha && (
        <Modal titulo="Devolver la tarjeta"
               bajada={ficha.nota ? `${ficha.uid} · ${ficha.nota}` : ficha.uid}
               onCerrar={() => setModalDevolver(false)}
               acciones={
                 <>
                   <button className="btn" onClick={() => setModalDevolver(false)}>Cancelar</button>
                   <button className="btn primario" disabled={ocupado} onClick={devolver}>
                     Devolver y liberar
                   </button>
                 </>
               }>
          {ficha.saldo_centavos > 0 ? (
            <>
              <p style={{ margin: '0 0 12px' }}>Le tenés que devolver en efectivo:</p>
              <p style={{ margin: 0, fontSize: 40, fontWeight: 800, letterSpacing: '-.03em',
                          fontVariantNumeric: 'tabular-nums' }}>
                {pesos(ficha.saldo_centavos)}
              </p>
              <Nota tono="ojo">
                La tarjeta queda en cero y se borra el nombre del cliente, lista para el próximo.
                Esto no se deshace: si te equivocaste, hay que volver a cargarle el saldo.
              </Nota>
            </>
          ) : (
            <Nota tono="info">
              No tiene saldo, no hay nada que devolver. Igual conviene liberarla para
              que se borre el nombre del cliente anterior.
            </Nota>
          )}
        </Modal>
      )}

      {ajuste && ficha && (
        <ModalAjuste ficha={ficha} ajuste={ajuste} setAjuste={setAjuste}
                     ocupado={ocupado} onAjustar={ajustar} />
      )}

      {modalBloqueo && (
        <Modal titulo="Bloquear tarjeta"
               bajada={`${uid} no va a poder servir en ninguna canilla hasta que la desbloquees. El saldo no se toca.`}
               onCerrar={() => setModalBloqueo(false)}
               acciones={
                 <>
                   <button className="btn" onClick={() => setModalBloqueo(false)}>Cancelar</button>
                   <button className="btn grave" disabled={!motivo.trim() || ocupado}
                           onClick={() => cambiarBloqueo(true)}>Bloquear</button>
                 </>
               }>
          <label htmlFor="motivo">Motivo</label>
          <input id="motivo" className="campo" value={motivo} autoFocus
                 placeholder="Se perdió / la robaron / a pedido del cliente"
                 onChange={e => setMotivo(e.target.value)} />
        </Modal>
      )}
    </>
  )
}

function Cargador({ monto, setMonto, montoCentavos, ocupado, onCargar }: {
  monto: string; setMonto: (v: string) => void; montoCentavos: number | null
  ocupado: boolean; onCargar: (c: number) => void
}) {
  return (
    <>
      <div className="rejilla c4" style={{ gap: 8, marginBottom: 10 }}>
        {RAPIDOS.map(c => (
          <button key={c} className="btn" disabled={ocupado} onClick={() => onCargar(c)}>
            {pesos(c)}
          </button>
        ))}
      </div>
      <div className="fila">
        <div className="crece">
          <input className="campo" inputMode="decimal" placeholder="Otro monto"
                 value={monto} onChange={e => setMonto(e.target.value)}
                 onKeyDown={e => { if (e.key === 'Enter' && montoCentavos) onCargar(montoCentavos) }} />
        </div>
        <button className="btn primario" disabled={ocupado || !montoCentavos}
                onClick={() => montoCentavos && onCargar(montoCentavos)}>
          <Icono nombre="mas" tam={16} /> Cargar
        </button>
      </div>
    </>
  )
}

/** Ajuste de saldo. Se escribe la diferencia, con signo, y la pantalla muestra
 *  en qué saldo va a quedar la tarjeta antes de confirmar — que es exactamente
 *  la pregunta que uno se hace justo antes de apretar. */
function ModalAjuste({ ficha, ajuste, setAjuste, ocupado, onAjustar }: {
  ficha: FichaTarjeta
  ajuste: { monto: string; motivo: string }
  setAjuste: (a: { monto: string; motivo: string } | null) => void
  ocupado: boolean
  onAjustar: (centavos: number, motivo: string) => void
}) {
  const centavos = aCentavos(ajuste.monto.replace('-', ''))
  const negativo = ajuste.monto.trim().startsWith('-')
  const delta = centavos == null ? null : (negativo ? -centavos : centavos)
  const resultante = delta == null ? null : ficha.saldo_centavos + delta
  const valido = delta != null && delta !== 0 && ajuste.motivo.trim() !== '' &&
                 resultante != null && resultante >= 0

  return (
    <Modal titulo="Ajustar saldo"
           bajada={`${ficha.uid} · saldo actual ${pesos(ficha.saldo_centavos)}`}
           onCerrar={() => setAjuste(null)}
           acciones={
             <>
               <button className="btn" onClick={() => setAjuste(null)}>Cancelar</button>
               <button className="btn primario" disabled={!valido || ocupado}
                       onClick={() => delta && onAjustar(delta, ajuste.motivo.trim())}>
                 Ajustar
               </button>
             </>
           }>
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label htmlFor="aj">Diferencia</label>
          <input id="aj" className="campo" autoFocus value={ajuste.monto}
                 placeholder="-1500 para quitar · 1500 para sumar"
                 onChange={e => setAjuste({ ...ajuste, monto: e.target.value })} />
          {resultante != null && (
            <small style={{ color: resultante < 0 ? 'var(--grave)' : 'var(--ink-3)' }}>
              {resultante < 0
                ? 'El ajuste dejaría la tarjeta en negativo.'
                : `La tarjeta queda en ${pesos(resultante)}.`}
            </small>
          )}
        </div>
        <div>
          <label htmlFor="mot2">Motivo</label>
          <input id="mot2" className="campo" value={ajuste.motivo}
                 placeholder="Se cargó de más por error"
                 onChange={e => setAjuste({ ...ajuste, motivo: e.target.value })} />
          <small style={{ color: 'var(--ink-3)' }}>
            Queda guardado con tu nombre en el historial de la tarjeta.
          </small>
        </div>
      </div>
    </Modal>
  )
}
