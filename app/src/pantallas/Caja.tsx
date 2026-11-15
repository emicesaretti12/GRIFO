import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/useSesion'
import { pesos, aCentavos, volumen, fecha } from '../lib/plata'
import { mensajeDeError, MEDIOS, NOMBRE_MEDIO,
         type FichaCliente, type RespuestaBusqueda, type RespuestaVenta, type RespuestaPase,
         type RespuestaDevolucion, type RespuestaError, type MedioPago } from '../lib/tipos'
import { Panel, Stat, Chip, Nota, Vacio, Hueso } from '../componentes/UI'
import { Modal } from '../componentes/Modal'
import { useAvisos } from '../componentes/Toast'
import Icono from '../componentes/Icono'
import { Ticket, TicketParaImprimir, leerAnchoPapel, guardarAnchoPapel,
         type DatosTicket, type AnchoPapel } from '../componentes/Ticket'

// ─────────────────────────────────────────────────────────────────────────────
// La caja.
//
// Dos clientes distintos llegan al mostrador:
//
//   · El que NO tiene celular. Da su DNI y su nombre, paga, y se lleva un
//     ticket impreso con un QR. Con ese papel se sirve en los grifos.
//
//   · El que TIENE la app y quiere cargar en efectivo. Abre su QR en el
//     celular y dice el código de 6 números que ve abajo. La plata va directo a
//     su cuenta de la app; no se imprime nada.
//
// ── Por qué el código y no el DNI para la app ────────────────────────────────
// El DNI lo sabe cualquiera. Si con decir un DNI en la caja se cargara la
// cuenta de la app de ese DNI, alguien podría anotarse en la app con el DNI de
// otro y tomarse lo que el dueño verdadero cargue después. El código lo ve solo
// quien tiene el celular en la mano: prueba que la cuenta es de él.
//
// Por eso un mismo DNI puede tener dos saldos (el de la app y el del ticket) y
// no se mezclan. Ver docs/qr.md
// ─────────────────────────────────────────────────────────────────────────────

const RAPIDOS = [500000, 1000000, 2000000, 3000000]

type Vista =
  | { tipo: 'vacia' }
  | { tipo: 'nuevo'; dni: string; tieneApp: boolean }
  | { tipo: 'ficha'; ficha: FichaCliente }

/** Una clave por intento de venta: si la red se corta y el cajero aprieta de
 *  nuevo, el servidor reconoce que es la misma y no carga dos veces. */
function claveNueva(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = new Uint8Array(16); crypto.getRandomValues(b)
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('')
}

function faltaBackend(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')
}

export default function Caja({ abrir, alAbrir }: {
  /** Una cuenta para abrir apenas se entra (viene del padrón). */
  abrir?: string | null
  alAbrir?: () => void
}) {
  const { avisar } = useAvisos()
  const { esAdmin, nombre: cajero } = useSesion()
  const [texto, setTexto] = useState('')
  const [vista, setVista] = useState<Vista>({ tipo: 'vacia' })
  const [buscando, setBuscando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [nombre, setNombre] = useState('')
  const [venta, setVenta] = useState(0)
  const [ticket, setTicket] = useState<DatosTicket | null>(null)
  const [modal, setModal] = useState<null | 'bloqueo' | 'devolver' | 'ajuste' | 'perdido' | 'celular'>(null)
  const [motivo, setMotivo] = useState('')
  const entrada = useRef<HTMLInputElement>(null)

  const ficha = vista.tipo === 'ficha' ? vista.ficha : null

  /** Devuelve los datos si salió bien; si no, avisa y devuelve null. */
  const llamar = useCallback(async <T extends { ok: true }>(
    funcion: string, args: Record<string, unknown>, titulo: string,
  ): Promise<T | null> => {
    const { data, error } = await supabase.rpc(funcion, args)
    if (error) {
      avisar(titulo, { tono: 'grave', detalle: faltaBackend(error) ? mensajeDeError({ motivo: 'sin_backend' }) : error.message })
      return null
    }
    const r = data as T | RespuestaError
    if (!r.ok) { avisar(titulo, { tono: 'grave', detalle: mensajeDeError(r) }); return null }
    return r
  }, [avisar])

  const refrescar = useCallback(async (uid: string) => {
    const r = await llamar<FichaCliente>('caja_ficha', { p_uid: uid }, 'No pudimos actualizar la cuenta')
    if (r) setVista({ tipo: 'ficha', ficha: r })
  }, [llamar])

  const buscar = useCallback(async (crudo: string) => {
    const numeros = crudo.replace(/\D/g, '')
    if (numeros.length < 6 || numeros.length > 8) {
      avisar('Revisá el número', {
        tono: 'grave', detalle: 'Escribí un DNI (7 u 8 números) o el código de 6 números de la app.',
      })
      return
    }
    setBuscando(true); setVista({ tipo: 'vacia' }); setNombre('')
    // Seis números es un código de la app: ningún DNI tiene seis.
    const r = numeros.length === 6
      ? await llamar<FichaCliente>('caja_buscar_por_codigo', { p_codigo: numeros }, 'No encontramos esa cuenta')
      : await llamar<Exclude<RespuestaBusqueda, RespuestaError>>('caja_buscar_cliente', { p_dni: numeros }, 'No pudimos consultar')
    setBuscando(false)
    if (!r) return
    setVenta(v => v + 1)
    if (r.existe) setVista({ tipo: 'ficha', ficha: r })
    else setVista({ tipo: 'nuevo', dni: r.dni, tieneApp: r.tiene_app })
  }, [avisar, llamar])

  // Abrir una cuenta que mandó el padrón.
  useEffect(() => {
    if (!abrir) return
    void refrescar(abrir).then(() => alAbrir?.())
  }, [abrir, refrescar, alAbrir])

  // F2 vuelve el foco al buscador desde cualquier parte de la pantalla.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); entrada.current?.focus(); entrada.current?.select() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  function limpiar() {
    setTexto(''); setVista({ tipo: 'vacia' }); setNombre(''); setVenta(v => v + 1)
    entrada.current?.focus()
  }

  // ── Vender: cobra, carga y deja el ticket listo ──────────────────────────
  // Todo en una sola llamada. Si fueran dos (cargar y después pedir el QR), un
  // corte en el medio dejaría la plata cobrada y al cliente sin ticket.
  async function vender(dni: string, nombreCliente: string, centavos: number, medio: MedioPago, clave: string) {
    setOcupado(true)
    const r = await llamar<Extract<RespuestaVenta, { ok: true }>>('caja_vender', {
      p_dni: dni, p_nombre: nombreCliente, p_centavos: centavos, p_medio: medio, p_clave: clave,
    }, 'No se pudo cobrar')
    setOcupado(false)
    if (!r) return

    avisar(r.repetida ? 'Esa venta ya estaba hecha' : `Cobraste ${pesos(centavos)}`, {
      tono: 'bien',
      detalle: r.repetida
        ? 'No se cargó de nuevo. Te dejo el ticket para imprimir.'
        : `${r.nombre} queda con ${pesos(r.saldo_centavos)}.`,
    })
    setTicket({
      nombre: r.nombre, dni: r.dni, codigo: r.pase.codigo, venceEn: r.pase.vence_en,
      saldoCentavos: r.saldo_centavos,
      cargadoCentavos: r.repetida ? undefined : centavos, medio: r.repetida ? undefined : medio,
      cajero, emitido: new Date(),
    })
    setVenta(v => v + 1)
    void refrescar(r.uid)
  }

  // ── Cargar a la cuenta de la app: sin ticket ─────────────────────────────
  async function cargarApp(f: FichaCliente, centavos: number, medio: MedioPago, clave: string) {
    setOcupado(true)
    const r = await llamar<{ ok: true; saldo_centavos: number; repetida?: boolean }>('caja_cargar', {
      p_uid: f.uid, p_centavos: centavos, p_medio: medio, p_clave: clave,
    }, 'No se pudo cargar')
    setOcupado(false)
    if (!r) return
    avisar(r.repetida ? 'Esa carga ya estaba hecha' : `Cargaste ${pesos(centavos)} a ${f.nombre}`, {
      tono: 'bien', detalle: `Ya lo ve en su celular. Saldo: ${pesos(r.saldo_centavos)}.`,
    })
    setVenta(v => v + 1)
    void refrescar(f.uid)
  }

  // ── Volver a imprimir, o dar un QR nuevo si lo perdió ────────────────────
  async function emitir(f: FichaCliente, renovar: boolean) {
    setOcupado(true)
    const r = await llamar<Extract<RespuestaPase, { ok: true }>>('caja_emitir_pase', {
      p_dni: f.dni, p_renovar: renovar,
    }, 'No se pudo emitir el ticket')
    setOcupado(false); setModal(null)
    if (!r) return
    if (renovar) avisar('QR nuevo', { tono: 'bien', detalle: 'El ticket anterior ya no sirve en ningún grifo.' })
    setTicket({
      nombre: r.nombre, dni: r.dni, codigo: r.pase.codigo, venceEn: r.pase.vence_en,
      saldoCentavos: r.saldo_centavos, cajero, emitido: new Date(),
    })
    void refrescar(r.uid)
  }

  async function cambiarBloqueo(f: FichaCliente, bloquear: boolean) {
    setOcupado(true)
    const r = await llamar<{ ok: true }>('caja_bloquear_tarjeta', {
      p_uid: f.uid, p_bloquear: bloquear, p_motivo: bloquear ? motivo : null,
    }, 'No se pudo')
    setOcupado(false); setModal(null); setMotivo('')
    if (!r) return
    avisar(bloquear ? 'Cuenta bloqueada' : 'Cuenta desbloqueada', { tono: 'bien' })
    void refrescar(f.uid)
  }

  // Devolver: el cliente se va y se lleva en efectivo lo que no tomó.
  async function devolver(f: FichaCliente) {
    setOcupado(true)
    const r = await llamar<Extract<RespuestaDevolucion, { ok: true }>>('caja_devolver_tarjeta', {
      p_uid: f.uid,
    }, 'No se pudo devolver')
    setOcupado(false); setModal(null)
    if (!r) return
    avisar(
      r.devuelto_centavos > 0 ? `Devolvele ${pesos(r.devuelto_centavos)} en efectivo` : 'No había nada que devolver',
      { tono: 'bien', detalle: r.devuelto_centavos > 0 ? 'La cuenta quedó en cero.' : undefined })
    void refrescar(f.uid)
  }

  async function ajustar(f: FichaCliente, centavos: number, porque: string) {
    setOcupado(true)
    const r = await llamar<{ ok: true; saldo_centavos: number }>('admin_ajustar_saldo', {
      p_uid: f.uid, p_centavos: centavos, p_motivo: porque,
    }, 'No se pudo ajustar')
    setOcupado(false); setModal(null)
    if (!r) return
    avisar('Saldo ajustado', { tono: 'bien', detalle: `Nuevo saldo: ${pesos(r.saldo_centavos)}` })
    void refrescar(f.uid)
  }

  // Cambió de celular: se suelta el anterior para que pueda entrar con el nuevo.
  async function habilitarCelular(dni: string) {
    setOcupado(true)
    const r = await llamar<{ ok: true; nombre: string }>('caja_habilitar_celular', { p_dni: dni }, 'No se pudo')
    setOcupado(false); setModal(null)
    if (!r) return
    avisar('Listo: ya puede entrar desde otro celular', {
      tono: 'bien', detalle: `Que entre a la app con su DNI y su nombre (${r.nombre}).`,
    })
    if (ficha) void refrescar(ficha.uid)
  }

  const dniDeLaVista = vista.tipo === 'nuevo' ? vista.dni : ficha?.dni ?? ''

  return (
    <>
      <Panel>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); void buscar(texto) }}>
          <div className="fila">
            <div className="crece" style={{ minWidth: 260 }}>
              <label htmlFor="buscar">
                DNI del cliente <span style={{ fontWeight: 500, color: 'var(--ink-3)' }}>· o el código de 6 números de su app (F2)</span>
              </label>
              <input id="buscar" ref={entrada} className="campo mono xl" value={texto} autoFocus
                     inputMode="numeric" autoComplete="off" placeholder="30123456" spellCheck={false}
                     onChange={e => setTexto(e.target.value.replace(/[^\d. ]/g, ''))} />
            </div>
            <button className="btn primario lg" disabled={buscando || texto.replace(/\D/g, '').length < 6}>
              <Icono nombre="buscar" tam={16} /> Buscar
            </button>
            {vista.tipo !== 'vacia' && (
              <button type="button" className="btn lg" onClick={limpiar}>Limpiar</button>
            )}
          </div>
        </form>
      </Panel>

      {buscando && (
        <div className="panel"><div style={{ display: 'grid', gap: 14 }}>
          <Hueso alto={18} ancho="35%" /><Hueso alto={40} ancho="45%" /><Hueso alto={14} ancho="70%" />
        </div></div>
      )}

      {!buscando && vista.tipo === 'vacia' && (
        <Panel>
          <Vacio icono="personas" titulo="Ningún cliente consultado">
            Sin celular: pedile el DNI, cobrale y dale el ticket con su QR.
            Con la app: pedile el código de 6 números que ve debajo de su QR.
          </Vacio>
        </Panel>
      )}

      {/* ── Alguien que viene por primera vez ─────────────────────────────── */}
      {vista.tipo === 'nuevo' && (
        <Panel titulo="Cliente nuevo" bajada={`DNI ${vista.dni}. Todavía no tiene ticket.`}>
          {vista.tieneApp && (
            <Nota tono="info">
              Este DNI ya tiene cuenta en la app. Si trajo el celular, pedile el código de
              6 números y cargale ahí. Lo que cobres acá va a un ticket aparte: son dos
              saldos distintos.{' '}
              <button className="btn sm" style={{ marginLeft: 6 }} disabled={ocupado} onClick={() => setModal('celular')}>
                Cambió de celular
              </button>
            </Nota>
          )}

          <div style={{ marginTop: 14 }}>
            <label htmlFor="cli">Nombre y apellido, como figura en el DNI</label>
            <input id="cli" className="campo" autoFocus value={nombre} maxLength={60}
                   placeholder="Sofía Méndez" autoComplete="off"
                   onChange={e => setNombre(e.target.value)} />
          </div>

          <div style={{ marginTop: 16 }}>
            <Cobro key={venta} ocupado={ocupado} deshabilitado={nombre.trim().length < 2}
                   textoBoton={c => `Cobrar ${pesos(c)} e imprimir el ticket`}
                   onCobrar={(c, m, k) => vender(vista.dni, nombre.trim(), c, m, k)} />
          </div>
        </Panel>
      )}

      {/* ── Una cuenta que ya existe ──────────────────────────────────────── */}
      {ficha && (
        <div className="rejilla lado">
          <div>
            <Panel>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0 }}>{ficha.nombre}</h2>
                {ficha.tipo === 'app' ? <Chip tono="dato">App</Chip> : <Chip>Ticket</Chip>}
                {ficha.bloqueada ? <Chip tono="grave">Bloqueada</Chip> : <Chip tono="bien">Activa</Chip>}
                {ficha.sesion_abierta && <Chip tono="dato">Sirviendo</Chip>}
              </div>
              <p className="bajada" style={{ marginBottom: 14 }}>
                DNI {ficha.dni}
                {ficha.tipo === 'ticket' && (ficha.pase
                  ? ` · QR válido hasta ${fecha(ficha.pase.vence_en)}`
                  : ' · sin QR vigente: se imprime uno nuevo al cargar o reimprimir')}
                {ficha.tipo === 'app' && (ficha.celular_vinculado ? ' · celular vinculado' : ' · sin celular vinculado')}
              </p>

              <Stat etiqueta="Saldo disponible" valor={pesos(ficha.saldo_centavos)} hero />

              {ficha.bloqueada && (
                <Nota tono="grave">
                  Bloqueada{ficha.bloqueada_motivo ? `: ${ficha.bloqueada_motivo}` : '.'} No puede
                  servirse en ninguna canilla hasta desbloquearla.
                </Nota>
              )}
              {ficha.sesion_abierta && (
                <Nota tono="info">
                  Está sirviendo ahora en la canilla {ficha.sesion_abierta.grifo_id}, con un tope
                  de {volumen(ficha.sesion_abierta.ml_maximos)}. Empezó {fecha(ficha.sesion_abierta.abierta_en)}.
                </Nota>
              )}
              {ficha.tipo === 'ticket' && ficha.tiene_app && (
                <Nota tono="info">
                  Este DNI también tiene cuenta en la app, con otro saldo. Lo que cargues acá
                  va al ticket.
                </Nota>
              )}

              <div style={{ marginTop: 18 }}>
                <span className="etiqueta-campo">Cargar saldo</span>
                {ficha.tipo === 'ticket' ? (
                  <Cobro key={venta} ocupado={ocupado} deshabilitado={ficha.bloqueada}
                         textoBoton={c => `Cobrar ${pesos(c)} e imprimir el ticket`}
                         onCobrar={(c, m, k) => vender(ficha.dni, ficha.nombre, c, m, k)} />
                ) : (
                  <Cobro key={venta} ocupado={ocupado} deshabilitado={ficha.bloqueada}
                         textoBoton={c => `Cobrar ${pesos(c)} y cargar a su app`}
                         onCobrar={(c, m, k) => cargarApp(ficha, c, m, k)} />
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                {ficha.tipo === 'ticket' && (
                  <>
                    <button className="btn crece" disabled={ocupado || ficha.bloqueada} onClick={() => emitir(ficha, false)}>
                      <Icono nombre="descargar" tam={16} /> Reimprimir ticket
                    </button>
                    <button className="btn crece" disabled={ocupado || ficha.bloqueada} onClick={() => setModal('perdido')}>
                      <Icono nombre="refrescar" tam={16} /> Perdió el ticket
                    </button>
                  </>
                )}
                {ficha.tipo === 'app' && (
                  <button className="btn crece" disabled={ocupado} onClick={() => setModal('celular')}>
                    <Icono nombre="refrescar" tam={16} /> Cambió de celular
                  </button>
                )}
                <button className="btn crece" disabled={ocupado || !!ficha.sesion_abierta}
                        onClick={() => setModal('devolver')}
                        title={ficha.sesion_abierta ? 'Está sirviendo en un grifo. Esperá a que termine.' : undefined}>
                  <Icono nombre="devolver" tam={16} /> Devolver saldo
                </button>
                <button className={ficha.bloqueada ? 'btn crece' : 'btn grave crece'} disabled={ocupado}
                        onClick={() => ficha.bloqueada ? cambiarBloqueo(ficha, false) : setModal('bloqueo')}>
                  <Icono nombre={ficha.bloqueada ? 'candado-abierto' : 'candado'} tam={16} />
                  {ficha.bloqueada ? 'Desbloquear' : 'Bloquear'}
                </button>
                {/* Corregir un error de carga es cosa de admin y siempre con
                    motivo: un ajuste sin explicación es un agujero por donde se
                    va la plata sin que nadie pueda reconstruir qué pasó. */}
                {esAdmin && (
                  <button className="btn crece" disabled={ocupado} onClick={() => setModal('ajuste')}>
                    <Icono nombre="lapiz" tam={16} /> Ajustar saldo
                  </button>
                )}
              </div>
            </Panel>
          </div>

          <Panel titulo="Movimientos" bajada="Las 15 operaciones más recientes." pegado>
            {ficha.movimientos.length === 0 ? (
              <Vacio icono="reloj" titulo="Sin movimientos">Esta cuenta todavía no se usó.</Vacio>
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
                          {m.tipo === 'carga'      ? <Chip tono="bien">Carga{m.medio_pago ? ` · ${NOMBRE_MEDIO[m.medio_pago] ?? m.medio_pago}` : ''}</Chip>
                          : m.tipo === 'ajuste'     ? <Chip tono="ojo">Ajuste</Chip>
                          : m.tipo === 'devolucion' ? <Chip tono="grave">Devolución</Chip>
                          :                           <Chip tono="dato">Consumo</Chip>}
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

      {ticket && <ModalTicket datos={ticket} onCerrar={() => { setTicket(null); entrada.current?.focus() }} />}

      {modal === 'perdido' && ficha && (
        <Modal titulo="Darle un QR nuevo"
               bajada={`${ficha.nombre} · DNI ${ficha.dni}`}
               onCerrar={() => setModal(null)}
               acciones={
                 <>
                   <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
                   <button className="btn primario" disabled={ocupado} onClick={() => emitir(ficha, true)}>
                     Anular el anterior e imprimir
                   </button>
                 </>
               }>
          <Nota tono="ojo">
            Pedile el DNI y mirá que sea la persona. El ticket anterior deja de servir en el
            momento: si alguien lo encontró, ya no puede servirse. El saldo no cambia.
          </Nota>
        </Modal>
      )}

      {modal === 'celular' && dniDeLaVista && (
        <Modal titulo="Habilitar otro celular"
               bajada={`DNI ${dniDeLaVista}`}
               onCerrar={() => setModal(null)}
               acciones={
                 <>
                   <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
                   <button className="btn primario" disabled={ocupado} onClick={() => habilitarCelular(dniDeLaVista)}>
                     Habilitar
                   </button>
                 </>
               }>
          <Nota tono="ojo">
            Hacelo solo con el DNI en la mano y mirando que sea la persona. La cuenta de la app
            se suelta del celular anterior, y el primero que entre con este DNI y el nombre
            correcto se queda con el saldo.
          </Nota>
        </Modal>
      )}

      {modal === 'devolver' && ficha && (
        <Modal titulo="Devolver el saldo"
               bajada={`${ficha.nombre} · DNI ${ficha.dni}`}
               onCerrar={() => setModal(null)}
               acciones={
                 <>
                   <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
                   <button className="btn primario" disabled={ocupado || ficha.saldo_centavos <= 0} onClick={() => devolver(ficha)}>
                     Devolver
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
                Pedile el DNI. La cuenta queda en cero{ficha.tipo === 'ticket' ? ' y el ticket deja de servir' : ''}.
                Esto no se deshace: si te equivocaste, hay que volver a cargarle el saldo.
              </Nota>
            </>
          ) : (
            <Nota tono="info">No tiene saldo: no hay nada que devolver.</Nota>
          )}
        </Modal>
      )}

      {modal === 'ajuste' && ficha && (
        <ModalAjuste ficha={ficha} ocupado={ocupado} onCerrar={() => setModal(null)}
                     onAjustar={(c, m) => ajustar(ficha, c, m)} />
      )}

      {modal === 'bloqueo' && ficha && (
        <Modal titulo="Bloquear la cuenta"
               bajada={`${ficha.nombre} no va a poder servirse en ninguna canilla hasta que la desbloquees. El saldo no se toca.`}
               onCerrar={() => setModal(null)}
               acciones={
                 <>
                   <button className="btn" onClick={() => setModal(null)}>Cancelar</button>
                   <button className="btn grave" disabled={!motivo.trim() || ocupado}
                           onClick={() => cambiarBloqueo(ficha, true)}>Bloquear</button>
                 </>
               }>
          <label htmlFor="motivo">Motivo</label>
          <input id="motivo" className="campo" value={motivo} autoFocus
                 placeholder="Perdió el celular / a pedido del cliente"
                 onChange={e => setMotivo(e.target.value)} />
        </Modal>
      )}
    </>
  )
}

/** Monto, medio de pago y el botón de cobrar.
 *
 *  El botón dice el monto: el cajero lee lo que está por cobrar en el mismo
 *  lugar donde aprieta, y no en un campo más arriba. */
function Cobro({ ocupado, deshabilitado, textoBoton, onCobrar }: {
  ocupado: boolean; deshabilitado?: boolean
  textoBoton: (centavos: number) => string
  onCobrar: (centavos: number, medio: MedioPago, clave: string) => void
}) {
  const [monto, setMonto] = useState('')
  const [medio, setMedio] = useState<MedioPago>('efectivo')
  const centavos = aCentavos(monto)
  // La clave cambia si cambia lo que se está por cobrar: reintentar LO MISMO no
  // duplica, pero corregir el monto es otra venta.
  const clave = useMemo(claveNueva, [centavos, medio])
  const listo = !!centavos && centavos > 0 && !deshabilitado && !ocupado

  return (
    <>
      <div className="rejilla c4" style={{ gap: 8, marginBottom: 10 }}>
        {RAPIDOS.map(c => (
          <button key={c} type="button" className="btn" disabled={ocupado}
                  aria-pressed={centavos === c}
                  style={centavos === c ? { borderColor: 'var(--acento)', color: 'var(--acento)' } : undefined}
                  onClick={() => setMonto(String(c / 100))}>
            {pesos(c).replace(',00', '')}
          </button>
        ))}
      </div>
      <input className="campo" inputMode="decimal" placeholder="Otro monto" aria-label="Monto a cobrar"
             value={monto} onChange={e => setMonto(e.target.value)}
             onKeyDown={e => { if (e.key === 'Enter' && listo && centavos) onCobrar(centavos, medio, clave) }} />

      <span className="etiqueta-campo" style={{ display: 'block', marginTop: 12 }}>Cómo paga</span>
      <div className="grupo-btn" role="group" aria-label="Medio de pago" style={{ flexWrap: 'wrap' }}>
        {MEDIOS.map(m => (
          <button key={m.id} type="button" aria-pressed={medio === m.id} onClick={() => setMedio(m.id)}>
            {m.texto}
          </button>
        ))}
      </div>

      <button className="btn primario lg bloque" style={{ marginTop: 14 }} disabled={!listo}
              onClick={() => centavos && onCobrar(centavos, medio, clave)}>
        {ocupado ? 'Un segundo…' : centavos && centavos > 0 ? textoBoton(centavos) : 'Elegí un monto'}
      </button>
    </>
  )
}

/** El ticket recién hecho: se manda a imprimir solo y queda a la vista por si
 *  hay que repetirlo. */
function ModalTicket({ datos, onCerrar }: { datos: DatosTicket; onCerrar: () => void }) {
  const [ancho, setAncho] = useState<AnchoPapel>(leerAnchoPapel)
  // Arranca en 1: imprime apenas aparece. Cada "Imprimir" lo sube.
  const [imprimir, setImprimir] = useState(1)

  return (
    <Modal titulo="Ticket del cliente"
           bajada="Dáselo: con este QR se sirve en los grifos."
           onCerrar={onCerrar}
           acciones={
             <>
               <div className="grupo-btn" role="group" aria-label="Ancho del papel" style={{ marginRight: 'auto' }}>
                 {([80, 58] as const).map(a => (
                   <button key={a} type="button" aria-pressed={ancho === a}
                           onClick={() => { setAncho(a); guardarAnchoPapel(a) }}>{a} mm</button>
                 ))}
               </div>
               <button className="btn" onClick={onCerrar}>Listo</button>
               <button className="btn primario" onClick={() => setImprimir(n => n + 1)}>
                 <Icono nombre="descargar" tam={16} /> Imprimir
               </button>
             </>
           }>
      <div className="ticket-previa"><Ticket datos={datos} ancho={ancho} /></div>
      <TicketParaImprimir datos={datos} ancho={ancho} imprimir={imprimir} />
    </Modal>
  )
}

/** Ajuste de saldo. Se escribe la diferencia, con signo, y la pantalla muestra
 *  en qué saldo va a quedar la cuenta antes de confirmar — que es exactamente
 *  la pregunta que uno se hace justo antes de apretar. */
function ModalAjuste({ ficha, ocupado, onCerrar, onAjustar }: {
  ficha: FichaCliente
  ocupado: boolean
  onCerrar: () => void
  onAjustar: (centavos: number, motivo: string) => void
}) {
  const [monto, setMonto] = useState('')
  const [porque, setPorque] = useState('')
  const centavos = aCentavos(monto.replace('-', ''))
  const negativo = monto.trim().startsWith('-')
  const delta = centavos == null ? null : (negativo ? -centavos : centavos)
  const resultante = delta == null ? null : ficha.saldo_centavos + delta
  const valido = delta != null && delta !== 0 && porque.trim() !== '' &&
                 resultante != null && resultante >= 0

  return (
    <Modal titulo="Ajustar saldo"
           bajada={`${ficha.nombre} · saldo actual ${pesos(ficha.saldo_centavos)}`}
           onCerrar={onCerrar}
           acciones={
             <>
               <button className="btn" onClick={onCerrar}>Cancelar</button>
               <button className="btn primario" disabled={!valido || ocupado}
                       onClick={() => delta && onAjustar(delta, porque.trim())}>
                 Ajustar
               </button>
             </>
           }>
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label htmlFor="aj">Diferencia</label>
          <input id="aj" className="campo" autoFocus value={monto}
                 placeholder="-1500 para quitar · 1500 para sumar"
                 onChange={e => setMonto(e.target.value)} />
          {resultante != null && (
            <small style={{ color: resultante < 0 ? 'var(--grave)' : 'var(--ink-3)' }}>
              {resultante < 0
                ? 'El ajuste dejaría la cuenta en negativo.'
                : `La cuenta queda en ${pesos(resultante)}.`}
            </small>
          )}
        </div>
        <div>
          <label htmlFor="mot2">Motivo</label>
          <input id="mot2" className="campo" value={porque}
                 placeholder="Se cargó de más por error"
                 onChange={e => setPorque(e.target.value)} />
          <small style={{ color: 'var(--ink-3)' }}>
            Queda guardado con tu nombre en el historial de la cuenta.
          </small>
        </div>
      </div>
    </Modal>
  )
}
