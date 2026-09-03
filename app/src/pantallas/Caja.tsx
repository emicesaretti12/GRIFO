import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLectorRFID } from '../lib/useLectorRFID'
import { normalizarUid, type FormatoLector } from '../lib/uid'
import { pesos, aCentavos, volumen, fecha } from '../lib/plata'
import { mensajeDeError, type RespuestaFicha, type FichaTarjeta } from '../lib/tipos'
import { Panel, Stat, Chip, Nota, Vacio, Hueso } from '../componentes/UI'
import { Modal } from '../componentes/Modal'
import { useAvisos } from '../componentes/Toast'
import Icono from '../componentes/Icono'

const RAPIDOS = [200000, 500000, 1000000, 2000000]

export default function Caja() {
  const { avisar } = useAvisos()
  const [uid, setUid] = useState('')
  const [ficha, setFicha] = useState<FichaTarjeta | null>(null)
  const [esNueva, setEsNueva] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [monto, setMonto] = useState('')
  const [modalBloqueo, setModalBloqueo] = useState(false)
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

              <button className={ficha.bloqueada ? 'btn bloque' : 'btn grave bloque'}
                      style={{ marginTop: 14 }} disabled={ocupado}
                      onClick={() => ficha.bloqueada ? cambiarBloqueo(false) : setModalBloqueo(true)}>
                <Icono nombre={ficha.bloqueada ? 'candado-abierto' : 'candado'} tam={16} />
                {ficha.bloqueada ? 'Desbloquear tarjeta' : 'Bloquear tarjeta'}
              </button>
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
                        <td>{m.tipo === 'carga'
                          ? <Chip tono="bien">Carga</Chip>
                          : <Chip tono="dato">Consumo</Chip>}</td>
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
