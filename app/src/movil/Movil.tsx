import { useCallback, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/useSesion'
import { useNFC, porQueNoHayNFC } from '../lib/useNFC'
import { normalizarUid, uidValido } from '../lib/uid'
import { pesos, aCentavos, fecha, volumen } from '../lib/plata'
import { mensajeDeError, type RespuestaFicha, type FichaTarjeta,
         type RespuestaDevolucion } from '../lib/tipos'
import { Nota } from '../componentes/UI'
import { Modal } from '../componentes/Modal'
import { ProveedorAvisos, useAvisos } from '../componentes/Toast'
import { Limite } from '../componentes/Limite'
import Icono, { type Nombre } from '../componentes/Icono'
import Login from '../pantallas/Login'
import './estilos-movil.css'

// ─────────────────────────────────────────────────────────────────────────────
// Caja portátil: el celular del mozo como lector de tarjetas.
//
// Acerca la tarjeta al teléfono, ve el saldo y le carga plata en la mesa, sin
// volver a la caja. Entra con su propio usuario, así que rigen los mismos
// permisos que en la app de escritorio: un cajero carga y consulta, y no lee
// las tablas.
//
// El NFC del navegador (Web NFC) anda en Chrome sobre Android y sobre HTTPS.
// En iPhone no existe. Cuando no está disponible, la pantalla lo dice y ofrece
// cargar el número a mano — es la misma operación, solo cambia cómo entra el
// UID.
// ─────────────────────────────────────────────────────────────────────────────

const RAPIDOS = [200000, 500000, 1000000, 2000000]

const ICONO_MOV: Record<string, Nombre> = {
  carga: 'mas', consumo: 'grifo', ajuste: 'lapiz', devolucion: 'devolver',
}
const NOMBRE_MOV: Record<string, string> = {
  carga: 'Carga', consumo: 'Consumo', ajuste: 'Ajuste', devolucion: 'Devolución',
}

export default function Movil() {
  return (
    <Limite>
      <ProveedorAvisos>
        <Contenido />
      </ProveedorAvisos>
    </Limite>
  )
}

function Contenido() {
  const { sesion, rol, nombre, cargando, esPersonal, salir } = useSesion()
  const { avisar } = useAvisos()

  const [uid, setUid] = useState('')
  const [ficha, setFicha] = useState<FichaTarjeta | null>(null)
  const [esNueva, setEsNueva] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [manual, setManual] = useState(false)
  const [otroMonto, setOtroMonto] = useState<string | null>(null)
  const [modalBloqueo, setModalBloqueo] = useState(false)
  const [modalDevolver, setModalDevolver] = useState(false)
  const [motivo, setMotivo] = useState('')

  const buscar = useCallback(async (crudo: string) => {
    const limpio = normalizarUid(crudo, 'hex')
    if (!limpio) return
    setBuscando(true); setFicha(null); setEsNueva(false); setUid(limpio)

    const { data, error } = await supabase.rpc('caja_buscar_tarjeta', { p_uid: limpio })
    setBuscando(false)
    if (error) { avisar('No pudimos consultar', { tono: 'grave', detalle: error.message }); return }
    const r = data as RespuestaFicha
    if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: mensajeDeError(r) }); return }

    if (r.existe) setFicha(r as FichaTarjeta); else setEsNueva(true)
    // Vibración corta al leer: en un bar ruidoso es la única confirmación que
    // el mozo va a registrar sin mirar la pantalla.
    navigator.vibrate?.(40)
  }, [avisar])

  const nfc = useNFC(buscar)

  if (!sesion) return <Login />
  if (cargando) return <div className="mov"><div className="mov-cuerpo"><div className="hueso" style={{ height: 120 }} /></div></div>

  if (!esPersonal) {
    return (
      <div className="mov"><div className="mov-cuerpo">
        <Nota tono="grave">
          Tu usuario todavía no tiene permisos. Un administrador tiene que darte
          de alta como personal.
        </Nota>
        <button className="btn bloque" onClick={salir}>Salir</button>
      </div></div>
    )
  }

  async function cargar(centavos: number) {
    if (!uid || centavos <= 0) return
    setOcupado(true)
    const { data, error } = await supabase.rpc('caja_cargar_saldo', {
      p_uid: uid, p_centavos: centavos, p_referencia: 'móvil',
      p_clave_idempotencia: `mov:${uid}:${centavos}:${Date.now()}`,
    })
    setOcupado(false); setOtroMonto(null)

    if (error) { avisar('No pudimos cargar', { tono: 'grave', detalle: error.message }); return }
    const r = data as { ok: boolean; motivo?: string; saldo_centavos?: number }
    if (!r.ok) { avisar('No se pudo cargar', { tono: 'grave', detalle: mensajeDeError(r) }); return }

    navigator.vibrate?.([40, 60, 90])
    avisar(`Cargaste ${pesos(centavos)}`, { tono: 'bien', detalle: `Saldo: ${pesos(r.saldo_centavos!)}` })
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

  // El cliente se va de la mesa: se le devuelve lo que le sobró y la tarjeta
  // vuelve limpia a la pila. Si el saldo se queda adentro, el próximo que la
  // agarre se sirve gratis.
  async function devolver() {
    setOcupado(true)
    const { data, error } = await supabase.rpc('caja_devolver_tarjeta', { p_uid: uid })
    setOcupado(false); setModalDevolver(false)
    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return }
    const r = data as RespuestaDevolucion
    if (!r.ok) { avisar('No se pudo devolver', { tono: 'grave', detalle: mensajeDeError(r) }); return }
    if (navigator.vibrate) navigator.vibrate([25, 60, 25])
    avisar(r.devuelto_centavos > 0 ? `Devolvele ${pesos(r.devuelto_centavos)}` : 'Tarjeta liberada',
           { tono: 'bien' })
    void buscar(uid)
  }

  const limpiar = () => { setUid(''); setFicha(null); setEsNueva(false); setManual(false) }
  const hayTarjeta = ficha !== null || esNueva

  return (
    <div className="mov">
      <header className="mov-barra">
        <span aria-hidden="true" style={{ fontSize: 20 }}>🍺</span>
        <div className="crece">
          <div className="marca">Caja móvil</div>
          <div className="quien">{nombre ?? sesion.user.email} · {rol}</div>
        </div>
        {hayTarjeta
          ? <button className="btn sm" onClick={limpiar}>Otra tarjeta</button>
          : <button className="btn fantasma sm" onClick={salir}><Icono nombre="salir" tam={16} /></button>}
      </header>

      <div className="mov-cuerpo">
        {!hayTarjeta && (
          <>
            {nfc.soportado ? (
              <button className="mov-escanear"
                      disabled={buscando}
                      onClick={() => nfc.estado === 'escaneando' ? nfc.parar() : void nfc.empezar()}>
                <span className="mov-antena">
                  {nfc.estado === 'escaneando' && <><i /><i /><i /></>}
                  <Icono nombre="tarjeta" tam={38} />
                </span>
                {nfc.estado === 'escaneando' ? 'Acercá la tarjeta al teléfono' : 'Escanear tarjeta'}
                <span className="sub">
                  {nfc.estado === 'escaneando'
                    ? 'Tocala contra la parte de atrás · tocá para cancelar'
                    : 'Con NFC, sin cables'}
                </span>
              </button>
            ) : (
              <Nota tono="ojo">
                <strong>Este dispositivo no puede escanear.</strong> {porQueNoHayNFC()}
              </Nota>
            )}

            {nfc.error && <Nota tono="grave">{nfc.error}</Nota>}

            {(!nfc.soportado || manual) ? (
              <form onSubmit={(e: FormEvent) => { e.preventDefault(); void buscar(uid) }}>
                <label htmlFor="uid">Número de tarjeta</label>
                <input id="uid" className="campo mono" value={uid} autoFocus={manual}
                       placeholder="A1B2C3D4" spellCheck={false}
                       onChange={e => setUid(e.target.value.toUpperCase())} />
                <button className="btn primario bloque" style={{ marginTop: 10, padding: 15 }}
                        disabled={buscando || !uid}>
                  {buscando ? 'Buscando…' : 'Buscar'}
                </button>
              </form>
            ) : (
              <button className="btn fantasma bloque" onClick={() => setManual(true)}>
                Cargar el número a mano
              </button>
            )}
          </>
        )}

        {buscando && hayTarjeta === false && <div className="hueso" style={{ height: 90 }} />}

        {esNueva && (
          <div className="mov-ficha">
            <div className="uid"><span className="uid">{uid}</span></div>
            <Nota tono="info">
              Tarjeta nueva, todavía sin registrar. Se da de alta sola con la
              primera carga.
            </Nota>
          </div>
        )}

        {ficha && (
          <div className="mov-ficha">
            <span className="uid">{ficha.uid}</span>
            <div className="saldo">{pesos(ficha.saldo_centavos)}</div>
            <div className="cap">
              {ficha.bloqueada
                ? <span style={{ color: 'var(--grave)', fontWeight: 700 }}>
                    Bloqueada{ficha.bloqueada_motivo ? ` · ${ficha.bloqueada_motivo}` : ''}
                  </span>
                : ficha.sesion_abierta
                  ? `Sirviendo ahora en la canilla ${ficha.sesion_abierta.grifo_id} · hasta ${volumen(ficha.sesion_abierta.ml_maximos)}`
                  : 'Tarjeta activa'}
            </div>
          </div>
        )}

        {hayTarjeta && (
          <>
            <div>
              <label>Cargar saldo</label>
              <div className="mov-montos">
                {RAPIDOS.map(c => (
                  <button key={c} disabled={ocupado || ficha?.bloqueada}
                          onClick={() => cargar(c)}>{pesos(c)}</button>
                ))}
              </div>
              <button className="btn bloque" style={{ marginTop: 10, padding: 15 }}
                      disabled={ocupado || ficha?.bloqueada}
                      onClick={() => setOtroMonto('')}>
                <Icono nombre="mas" tam={16} /> Otro monto
              </button>
            </div>

            {ficha && (
              <div className="mov-acciones">
                <button className={ficha.bloqueada ? 'btn' : 'btn grave'} disabled={ocupado}
                        onClick={() => ficha.bloqueada ? cambiarBloqueo(false) : setModalBloqueo(true)}>
                  <Icono nombre={ficha.bloqueada ? 'candado-abierto' : 'candado'} tam={17} />
                  {ficha.bloqueada ? 'Desbloquear tarjeta' : 'Bloquear tarjeta'}
                </button>
                <button className="btn" disabled={ocupado || !!ficha.sesion_abierta}
                        onClick={() => setModalDevolver(true)}>
                  <Icono nombre="devolver" tam={17} />
                  {ficha.sesion_abierta ? 'Está sirviendo ahora' : 'Devolver tarjeta'}
                </button>
              </div>
            )}

            {ficha && ficha.movimientos.length > 0 && (
              <div className="mov-ficha mov-movs">
                <label>Últimos movimientos</label>
                {ficha.movimientos.slice(0, 6).map(m => (
                  <div className="m" key={m.id}>
                    <Icono nombre={ICONO_MOV[m.tipo] ?? 'grifo'} tam={16} />
                    <div>
                      <div>{NOMBRE_MOV[m.tipo] ?? 'Movimiento'}</div>
                      <div className="cuando">{fecha(m.creado_en)}</div>
                    </div>
                    <div className="monto">{pesos(m.centavos)}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mov-pie">v {__VERSION__}</div>

      {otroMonto !== null && (
        <Modal titulo="Cargar otro monto" onCerrar={() => setOtroMonto(null)}
               acciones={
                 <>
                   <button className="btn" onClick={() => setOtroMonto(null)}>Cancelar</button>
                   <button className="btn primario"
                           disabled={!aCentavos(otroMonto) || ocupado}
                           onClick={() => { const c = aCentavos(otroMonto); if (c) cargar(c) }}>
                     Cargar
                   </button>
                 </>
               }>
          <label htmlFor="monto">Monto en pesos</label>
          <input id="monto" className="campo" inputMode="decimal" autoFocus
                 value={otroMonto} placeholder="1500"
                 onChange={e => setOtroMonto(e.target.value)} />
          {aCentavos(otroMonto) != null && (
            <p className="bajada" style={{ marginTop: 8 }}>
              Se van a cargar {pesos(aCentavos(otroMonto)!)}.
            </p>
          )}
        </Modal>
      )}

      {modalDevolver && ficha && (
        <Modal titulo="Devolver la tarjeta"
               bajada={ficha.nota ? `${ficha.uid} · ${ficha.nota}` : ficha.uid}
               onCerrar={() => setModalDevolver(false)}
               acciones={
                 <>
                   <button className="btn" onClick={() => setModalDevolver(false)}>Cancelar</button>
                   <button className="btn primario" disabled={ocupado} onClick={devolver}>
                     Devolver
                   </button>
                 </>
               }>
          {ficha.saldo_centavos > 0 ? (
            <>
              <p style={{ margin: '0 0 10px' }}>Le tenés que devolver en efectivo:</p>
              <p style={{ margin: 0, fontSize: 36, fontWeight: 800, letterSpacing: '-.03em',
                          fontVariantNumeric: 'tabular-nums' }}>
                {pesos(ficha.saldo_centavos)}
              </p>
              <Nota tono="ojo">
                La tarjeta queda en cero y lista para el próximo. Esto no se deshace.
              </Nota>
            </>
          ) : (
            <Nota tono="info">
              No tiene saldo. Igual conviene liberarla para borrar el nombre del
              cliente anterior.
            </Nota>
          )}
        </Modal>
      )}

      {modalBloqueo && (
        <Modal titulo="Bloquear tarjeta"
               bajada={`${uid} no va a poder servir en ninguna canilla. El saldo no se toca.`}
               onCerrar={() => setModalBloqueo(false)}
               acciones={
                 <>
                   <button className="btn" onClick={() => setModalBloqueo(false)}>Cancelar</button>
                   <button className="btn grave" disabled={!motivo.trim() || ocupado}
                           onClick={() => cambiarBloqueo(true)}>Bloquear</button>
                 </>
               }>
          <label htmlFor="mot">Motivo</label>
          <input id="mot" className="campo" value={motivo} autoFocus
                 placeholder="Se perdió / la robaron"
                 onChange={e => setMotivo(e.target.value)} />
        </Modal>
      )}

      {/* Diagnóstico: si el UID que lee el celular no coincide con el que lee el
          ESP32, la misma tarjeta se carga con un número y el grifo la desconoce.
          Tenerlo a la vista al vincular ahorra horas de buscar el problema en
          otro lado. */}
      {uid && !uidValido(uid) && (
        <div style={{ padding: '0 16px 16px' }}>
          <Nota tono="ojo">
            El número leído (<code>{uid}</code>) no tiene la forma de un UID de 4,
            7 o 10 bytes. Comparalo con el que muestra el monitor serial del ESP32.
          </Nota>
        </div>
      )}
    </div>
  )
}
