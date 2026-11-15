import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import '@fontsource-variable/big-shoulders-display'
import '@fontsource-variable/archivo'
import { ArrowDown, ArrowUp, BeerStein, Plus, QrCode, SignOut, WarningCircle, WifiSlash, X } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import { aCentavos, pesos, volumen } from '../lib/plata'
import { useIntervalo } from '../lib/useIntervalo'
import QRVector from '../componentes/QRVector'
import './estilos-cliente.css'

// ─────────────────────────────────────────────────────────────────────────────
// La app del cliente:  #/cliente
//
// Lo que hace el que viene al bar con su celular: entra con nombre y DNI, carga
// saldo (Mercado Pago, o efectivo en la caja), y toca su tarjeta para que le
// salga el QR que se muestra en la tablet del grifo.
//
// ── Sin contraseña, pero atada al celular ────────────────────────────────────
// No hay usuario ni clave. La primera vez que alguien entra con un DNI, la
// cuenta queda unida a ESTE celular: el navegador guarda un secreto al azar y
// el servidor guarda solo su huella. Desde otro celular, el mismo DNI no entra.
//
//   Es una cookie de "recordarme" sin el formulario de login adelante. El DNI
//   dice de quién es la cuenta; el secreto, que el que pregunta es el dueño.
//
// Si cambia de celular, la caja lo habilita mirándole el DNI.
//
// ── El QR dura poco a propósito ──────────────────────────────────────────────
// Vale 90 segundos y se renueva solo mientras está en pantalla. Una captura de
// pantalla mandada por WhatsApp ya no sirve cuando el otro llega al grifo.
// Ver docs/qr.md
// ─────────────────────────────────────────────────────────────────────────────

const CLAVE_CUENTA = 'grifo.cliente'
const CLAVE_DISPOSITIVO = 'grifo.cliente.dispositivo'
const CLAVE_PAGO = 'grifo.cliente.pago'

type Cuenta = { dni: string; nombre: string }
type Falla = { ok: false; motivo: string }

type Movimiento = {
  id: number; tipo: 'carga' | 'consumo' | 'ajuste' | 'devolucion'
  centavos: number; medio_pago: string | null; creado_en: string
  ml_servidos: number | null; canilla: string | null
}
type Estado = {
  ok: true; dni: string; nombre: string; saldo_centavos: number; bloqueada: boolean
  movimientos: Movimiento[]
  sirviendo: { canilla: string; ml: number; ml_maximos: number } | null
}
type Pase = { ok: true; codigo: string; codigo_corto: string; segundos: number; saldo_centavos: number }
type EstadoPago = { ok: true; estado: 'pendiente' | 'aprobado' | 'rechazado'; centavos: number; saldo_centavos: number }

const MENSAJES: Record<string, string> = {
  dni_invalido: 'Revisá el DNI: son 7 u 8 números.',
  falta_nombre: 'Escribí tu nombre y apellido.',
  nombre_muy_largo: 'El nombre es demasiado largo.',
  dispositivo_invalido: 'No pudimos identificar este celular. Recargá la página.',
  nombre_no_coincide: 'El nombre no coincide con el de esa cuenta. Escribilo como lo diste la primera vez.',
  otro_dispositivo: 'Esa cuenta ya está abierta en otro celular. Pasá por la caja con tu DNI y te la habilitan en este.',
  tarjeta_bloqueada: 'Tu cuenta está bloqueada. Pasá por la caja.',
  monto_fuera_de_rango: 'El monto tiene que estar entre $ 1.000 y $ 200.000, sin centavos.',
  demasiados_intentos: 'Demasiados intentos seguidos. Esperá unos minutos y probá de nuevo.',
  reintentar: 'No pudimos generar el QR. Probá de nuevo.',
  mp_no_configurado: 'La carga con Mercado Pago todavía no está activada. Podés cargar en la caja.',
  mp_credencial_invalida: 'La carga con Mercado Pago no está disponible. Avisale al personal; mientras, cargá en la caja.',
  mp_error: 'Mercado Pago no respondió. Probá de nuevo en un momento.',
  sin_red: 'No hay conexión. Revisá el WiFi o los datos y probá de nuevo.',
  sin_backend: 'El bar todavía no activó las cuentas por QR. Avisale al personal.',
}
const mensaje = (motivo: string) => MENSAJES[motivo] ?? 'Algo salió mal. Probá de nuevo.'

// ── Lo guardado en el celular ────────────────────────────────────────────────
function leer<T>(clave: string): T | null {
  try { const c = localStorage.getItem(clave); return c ? JSON.parse(c) as T : null } catch { return null }
}
function guardar(clave: string, valor: unknown) {
  try { localStorage.setItem(clave, JSON.stringify(valor)) } catch { /* sin almacenamiento */ }
}
function borrar(clave: string) {
  try { localStorage.removeItem(clave) } catch { /* sin almacenamiento */ }
}

/** El secreto de este celular. Se crea una vez y no sale nunca de acá salvo
 *  para viajar al servidor, que guarda solo su huella. */
function secretoDelCelular(): string | null {
  try {
    let s = localStorage.getItem(CLAVE_DISPOSITIVO)
    if (!s || s.length < 32) {
      const b = new Uint8Array(32)
      crypto.getRandomValues(b)
      s = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(CLAVE_DISPOSITIVO, s)
    }
    return s
  } catch { return null }
}

async function rpc<T>(nombre: string, args: Record<string, unknown>): Promise<T | Falla> {
  const { data, error } = await supabase.rpc(nombre, args)
  if (error) {
    const falta = error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')
    return { ok: false, motivo: falta ? 'sin_backend' : 'sin_red' }
  }
  return data as T | Falla
}

/** Las dos llamadas a la función del servidor que habla con Mercado Pago. */
async function mercadoPago<T>(cuerpo: Record<string, unknown>): Promise<T | Falla> {
  try {
    const { data, error } = await supabase.functions.invoke('mercadopago', { body: cuerpo })
    // Un error acá es que la función no está publicada o no contesta: los
    // rechazos normales llegan como { ok: false, motivo }.
    if (error || !data) return { ok: false, motivo: 'mp_no_configurado' }
    return data as T | Falla
  } catch { return { ok: false, motivo: 'sin_red' } }
}

/** "$ 8.348" y ",64" por separado, para achicar los centavos. */
function partes(centavos: number): { entero: string; decimales: string } {
  const [entero, decimales] = pesos(centavos).split(',')
  return { entero, decimales: decimales ?? '00' }
}

const hora = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

// ═════════════════════════════════════════════════════════════════════════════
export default function Cliente({ volvioDePagar = false, pagoDeVuelta = null }: {
  /** Mercado Pago lo acaba de mandar de vuelta para acá. */
  volvioDePagar?: boolean
  /** El intento de pago que dice la URL de vuelta, por si el celular no lo guardó. */
  pagoDeVuelta?: string | null
}) {
  const [dispositivo] = useState(secretoDelCelular)
  const [cuenta, setCuenta] = useState<Cuenta | null>(() => leer<Cuenta>(CLAVE_CUENTA))
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'GRIFO · Mi cuenta'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#12100d')
  }, [])

  if (!dispositivo) {
    return (
      <div className="cli"><main className="cli-entrar">
        <Marca />
        <p className="cli-nota grave" role="alert">
          <WarningCircle size={22} aria-hidden="true" />
          <span>Este navegador no deja guardar datos, y sin eso no podemos recordar tu cuenta.
            Abrí la página en una pestaña normal (no en modo incógnito).</span>
        </p>
      </main></div>
    )
  }

  if (!cuenta) {
    return <Entrar dispositivo={dispositivo} aviso={aviso}
                   alEntrar={c => { guardar(CLAVE_CUENTA, c); setAviso(null); setCuenta(c) }} />
  }

  return <MiCuenta cuenta={cuenta} dispositivo={dispositivo}
                   volvioDePagar={volvioDePagar} pagoDeVuelta={pagoDeVuelta}
                   alSalir={porque => {
                     borrar(CLAVE_CUENTA); borrar(CLAVE_PAGO)
                     setAviso(porque === 'sesion'
                       ? 'Tu cuenta se abrió en otro celular o se cerró desde la caja. Entrá de nuevo.'
                       : null)
                     setCuenta(null)
                   }} />
}

function Marca() {
  return <p className="cli-marca"><BeerStein size={26} weight="fill" aria-hidden="true" /> GRIFO</p>
}

// ── Entrar ───────────────────────────────────────────────────────────────────
function Entrar({ dispositivo, aviso, alEntrar }: {
  dispositivo: string; aviso: string | null; alEntrar: (c: Cuenta) => void
}) {
  const [nombre, setNombre] = useState('')
  const [dni, setDni] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const dniLimpio = dni.replace(/\D/g, '')
  const valido = nombre.trim().length >= 2 && dniLimpio.length >= 7 && dniLimpio.length <= 8

  async function entrar(e: FormEvent) {
    e.preventDefault()
    if (!valido || ocupado) return
    setOcupado(true); setError(null)
    const r = await rpc<{ ok: true; dni: string; nombre: string }>('cliente_entrar', {
      p_dni: dniLimpio, p_nombre: nombre.trim(), p_dispositivo: dispositivo,
    })
    setOcupado(false)
    if (!r.ok) { setError(mensaje(r.motivo)); return }
    alEntrar({ dni: r.dni, nombre: r.nombre })
  }

  return (
    <div className="cli">
      <main className="cli-entrar">
        <Marca />
        <h1>Tu cuenta del bar</h1>
        <p className="cli-bajada">Cargá saldo, mostrá tu QR en el grifo y servite. Pagás lo que servís, al mililitro.</p>

        {aviso && <p className="cli-nota" role="status"><WarningCircle size={22} aria-hidden="true" /><span>{aviso}</span></p>}

        <form onSubmit={entrar} noValidate>
          <label htmlFor="cli-nombre">Nombre y apellido</label>
          <input id="cli-nombre" value={nombre} autoComplete="name" autoCapitalize="words"
                 placeholder="Sofía Méndez" maxLength={60}
                 onChange={e => setNombre(e.target.value)} />

          <label htmlFor="cli-dni">DNI</label>
          <input id="cli-dni" value={dni} inputMode="numeric" autoComplete="off"
                 placeholder="30123456" maxLength={11}
                 onChange={e => setDni(e.target.value.replace(/[^\d.]/g, ''))} />

          {error && <p className="cli-nota grave" role="alert"><WarningCircle size={22} aria-hidden="true" /><span>{error}</span></p>}

          <button className="cli-btn primario" type="submit" disabled={!valido || ocupado}>
            {ocupado ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="cli-pie">
          No hay contraseña: la cuenta queda unida a este celular. Si lo cambiás,
          en la caja te la habilitan con tu DNI.
        </p>
      </main>
    </div>
  )
}

// ── La cuenta ────────────────────────────────────────────────────────────────
type AvisoPago =
  | { tipo: 'confirmando' }
  | { tipo: 'aprobado'; centavos: number }
  | { tipo: 'pendiente' }
  | { tipo: 'rechazado' }

function MiCuenta({ cuenta, dispositivo, volvioDePagar, pagoDeVuelta, alSalir }: {
  cuenta: Cuenta; dispositivo: string
  volvioDePagar: boolean; pagoDeVuelta: string | null
  alSalir: (porque: 'pedido' | 'sesion') => void
}) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [problema, setProblema] = useState<string | null>(null)
  const [hoja, setHoja] = useState<null | 'qr' | 'carga' | 'salir'>(null)
  const [pago, setPago] = useState<AvisoPago | null>(null)
  const [servido, setServido] = useState<Movimiento | null>(null)
  const credencial = { p_dni: cuenta.dni, p_dispositivo: dispositivo }

  // Para notar que terminó de servir: el consumo más nuevo cambió.
  const ultimoConsumo = useRef<number | null | undefined>(undefined)

  const consultar = useCallback(async () => {
    const r = await rpc<Estado>('cliente_estado', { p_dni: cuenta.dni, p_dispositivo: dispositivo })
    if (!r.ok) {
      if (r.motivo === 'sesion_invalida') alSalir('sesion')
      else setProblema(r.motivo)
      return
    }
    setProblema(null); setEstado(r)

    const consumo = r.movimientos.find(m => m.tipo === 'consumo') ?? null
    if (ultimoConsumo.current !== undefined && consumo && consumo.id !== ultimoConsumo.current) {
      setServido(consumo)
    }
    ultimoConsumo.current = consumo?.id ?? null
  }, [cuenta.dni, dispositivo, alSalir])

  const sirviendo = estado?.sirviendo ?? null
  useEffect(() => { void consultar() }, [consultar])
  // Más seguido cuando hay algo que mirar: el QR en pantalla o la canilla abierta.
  useIntervalo(consultar, sirviendo || hoja === 'qr' ? 1500 : 6000)

  // El QR ya hizo su trabajo: la tablet lo leyó y abrió la canilla.
  useEffect(() => { if (sirviendo && hoja === 'qr') setHoja(null) }, [sirviendo, hoja])
  useEffect(() => { if (sirviendo) setServido(null) }, [sirviendo])

  // ── Al volver de Mercado Pago ────────────────────────────────────────────
  // El saldo se acredita solo, por el aviso que Mercado Pago le manda al
  // servidor. Esto es el cinturón además de los tirantes: se pregunta desde
  // acá por si el aviso se demoró.
  useEffect(() => {
    const guardado = leer<{ id: string; en: number }>(CLAVE_PAGO)
    const id = guardado && Date.now() - guardado.en < 2 * 3600 * 1000 ? guardado.id : pagoDeVuelta
    if (!id) { borrar(CLAVE_PAGO); return }

    let vigente = true
    if (volvioDePagar) setPago({ tipo: 'confirmando' })
    void (async () => {
      const intentos = volvioDePagar ? 14 : 1
      for (let i = 0; i < intentos && vigente; i++) {
        const r = await mercadoPago<EstadoPago>({
          accion: 'verificar', dni: cuenta.dni, dispositivo, pago_id: id,
        })
        if (!vigente) return
        if (r.ok && r.estado === 'aprobado') {
          borrar(CLAVE_PAGO); setPago({ tipo: 'aprobado', centavos: r.centavos }); void consultar(); return
        }
        if (r.ok && r.estado === 'rechazado') {
          borrar(CLAVE_PAGO); setPago(volvioDePagar ? { tipo: 'rechazado' } : null); return
        }
        if (!r.ok && r.motivo === 'pago_desconocido') { borrar(CLAVE_PAGO); setPago(null); return }
        if (i < intentos - 1) await new Promise(ok => setTimeout(ok, 2500))
      }
      if (vigente && volvioDePagar) setPago({ tipo: 'pendiente' })
    })()
    return () => { vigente = false }
  }, [cuenta.dni, dispositivo, volvioDePagar, pagoDeVuelta, consultar])

  async function salir() {
    await rpc('cliente_salir', credencial)
    alSalir('pedido')
  }

  const primerNombre = cuenta.nombre.split(' ')[0]
  const saldo = estado ? partes(estado.saldo_centavos) : null
  const bloqueada = estado?.bloqueada ?? false

  return (
    <div className="cli">
      <header className="cli-barra">
        <Marca />
        <button className="cli-btn fantasma" onClick={() => setHoja('salir')}>
          <SignOut size={20} aria-hidden="true" /> Salir
        </button>
      </header>

      <main className="cli-cuerpo">
        <h1 className="cli-hola">Hola, {primerNombre}</h1>

        <div aria-live="polite">
          {problema && (
            <p className="cli-nota" role="status">
              <WifiSlash size={22} aria-hidden="true" /><span>{mensaje(problema)}</span>
            </p>
          )}
          {bloqueada && (
            <p className="cli-nota grave" role="alert">
              <WarningCircle size={22} aria-hidden="true" /><span>{MENSAJES.tarjeta_bloqueada}</span>
            </p>
          )}
          {pago && <AvisoDePago pago={pago} alCerrar={() => setPago(null)} />}
          {sirviendo && (
            <div className="cli-sirviendo">
              <p className="cli-sirviendo-donde"><span className="cli-pulso" aria-hidden="true" /> Sirviendo en {sirviendo.canilla}</p>
              <p className="cli-sirviendo-ml">{sirviendo.ml}<small> ml</small></p>
              <p className="cli-sirviendo-tope">
                {sirviendo.ml === 0 ? 'La canilla ya está abierta: serví.' : `Te alcanza para ${volumen(sirviendo.ml_maximos)}.`}
              </p>
            </div>
          )}
          {servido && !sirviendo && (
            <div className="cli-nota bien" role="status">
              <BeerStein size={22} weight="fill" aria-hidden="true" />
              <span>
                <strong>Serviste {volumen(servido.ml_servidos)}</strong>{servido.canilla ? ` de ${servido.canilla}` : ''}.
                {' '}Fueron {pesos(Math.abs(servido.centavos))}. ¡Salud!
              </span>
              <button className="cli-cerrar" aria-label="Cerrar aviso" onClick={() => setServido(null)}><X size={18} /></button>
            </div>
          )}
        </div>

        {/* La tarjeta. Tocarla es lo que pide el QR: es el gesto que el cliente
            ya conoce de cualquier billetera. */}
        <button className="cli-tarjeta" onClick={() => setHoja('qr')} disabled={!estado || bloqueada || !!sirviendo}
                aria-label="Mostrar mi QR para el grifo">
          <span className="cli-tarjeta-arriba">
            <span>Tu saldo</span>
            <QrCode size={30} aria-hidden="true" />
          </span>
          <span className="cli-saldo">
            {saldo ? <>{saldo.entero}<small>,{saldo.decimales}</small></> : <span className="cli-hueso" />}
          </span>
          <span className="cli-tarjeta-abajo">
            <span className="cli-titular">{cuenta.nombre}</span>
            <span>DNI ···{cuenta.dni.slice(-3)}</span>
          </span>
          <span className="cli-tocar">{sirviendo ? 'Estás sirviendo' : 'Tocá la tarjeta para mostrar tu QR'}</span>
        </button>

        <div className="cli-acciones">
          <button className="cli-btn primario" onClick={() => setHoja('carga')} disabled={bloqueada}>
            <Plus size={20} weight="bold" aria-hidden="true" /> Cargar saldo
          </button>
          <button className="cli-btn" onClick={() => setHoja('qr')} disabled={!estado || bloqueada || !!sirviendo}>
            <QrCode size={20} aria-hidden="true" /> Mostrar QR
          </button>
        </div>

        <section aria-labelledby="cli-mov">
          <h2 id="cli-mov">Movimientos</h2>
          {!estado ? (
            <div className="cli-lista"><span className="cli-hueso" /><span className="cli-hueso" /><span className="cli-hueso" /></div>
          ) : estado.movimientos.length === 0 ? (
            <p className="cli-vacio">Todavía no hay movimientos. Cargá saldo y acercate a un grifo.</p>
          ) : (
            <ul className="cli-lista">
              {estado.movimientos.map(m => <Fila key={m.id} m={m} />)}
            </ul>
          )}
        </section>
      </main>

      {hoja === 'qr' && (
        <HojaQR credencial={credencial} alCerrar={() => setHoja(null)} alPerderSesion={() => alSalir('sesion')} />
      )}
      {hoja === 'carga' && (
        <HojaCarga cuenta={cuenta} dispositivo={dispositivo}
                   alCerrar={() => setHoja(null)} alMostrarQR={() => setHoja('qr')} />
      )}
      {hoja === 'salir' && (
        <Hoja titulo="¿Salir de tu cuenta?" alCerrar={() => setHoja(null)}>
          <p className="cli-texto">
            Tu saldo no se pierde: queda guardado con tu DNI. Pero al salir, la cuenta deja
            de estar unida a este celular, y <strong>cualquiera que sepa tu nombre y tu DNI
            puede entrar desde otro</strong>.
          </p>
          <p className="cli-texto">Salí solo si vas a cambiar de celular o si este no es tuyo.</p>
          <div className="cli-acciones apiladas">
            <button className="cli-btn peligro" onClick={salir}>Salir de mi cuenta</button>
            <button className="cli-btn" onClick={() => setHoja(null)}>Quedarme</button>
          </div>
        </Hoja>
      )}
    </div>
  )
}

function AvisoDePago({ pago, alCerrar }: { pago: AvisoPago; alCerrar: () => void }) {
  if (pago.tipo === 'confirmando') {
    return <p className="cli-nota" role="status"><span className="cli-pulso" aria-hidden="true" /><span>Confirmando tu pago con Mercado Pago…</span></p>
  }
  const cerrar = <button className="cli-cerrar" aria-label="Cerrar aviso" onClick={alCerrar}><X size={18} /></button>
  if (pago.tipo === 'aprobado') {
    return (
      <div className="cli-nota bien" role="status">
        <ArrowDown size={22} weight="bold" aria-hidden="true" />
        <span><strong>Se acreditaron {pesos(pago.centavos)}.</strong> Ya podés ir al grifo.</span>{cerrar}
      </div>
    )
  }
  if (pago.tipo === 'rechazado') {
    return (
      <div className="cli-nota grave" role="alert">
        <WarningCircle size={22} aria-hidden="true" />
        <span><strong>El pago no se completó.</strong> No se te cobró nada. Probá de nuevo o cargá en la caja.</span>{cerrar}
      </div>
    )
  }
  return (
    <div className="cli-nota" role="status">
      <WarningCircle size={22} aria-hidden="true" />
      <span>Todavía no vemos tu pago. Si lo terminaste, aparece en tu saldo apenas Mercado Pago lo confirme.</span>{cerrar}
    </div>
  )
}

const MEDIOS: Record<string, string> = {
  efectivo: 'en efectivo', debito: 'con débito', credito: 'con crédito',
  transferencia: 'por transferencia', mercadopago: 'con Mercado Pago',
}

function Fila({ m }: { m: Movimiento }) {
  const entra = m.centavos > 0
  const titulo =
    m.tipo === 'consumo' ? `${volumen(m.ml_servidos)}${m.canilla ? ` de ${m.canilla}` : ''}`
    : m.tipo === 'carga' ? `Carga ${m.medio_pago ? MEDIOS[m.medio_pago] ?? '' : ''}`.trim()
    : m.tipo === 'devolucion' ? 'Devolución en la caja'
    : 'Ajuste de la caja'
  // En la base lo que sale va en negativo. Acá el signo se dibuja aparte.
  const monto = Math.abs(m.centavos)
  return (
    <li className="cli-fila">
      <span className={entra ? 'cli-icono entra' : 'cli-icono'} aria-hidden="true">
        {m.tipo === 'consumo' ? <BeerStein size={20} weight="fill" /> : entra ? <ArrowDown size={20} weight="bold" /> : <ArrowUp size={20} weight="bold" />}
      </span>
      <span className="cli-fila-texto">
        <strong>{titulo}</strong>
        <small>{hora.format(new Date(m.creado_en))}</small>
      </span>
      <span className={entra ? 'cli-monto entra' : 'cli-monto'}>{entra ? '+' : '−'} {pesos(monto)}</span>
    </li>
  )
}

// ── Una hoja que sube desde abajo ────────────────────────────────────────────
function Hoja({ titulo, alCerrar, clara, children }: {
  titulo: string; alCerrar: () => void; clara?: boolean; children: ReactNode
}) {
  const caja = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null
    caja.current?.querySelector<HTMLElement>('button, input')?.focus()
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar() }
    document.addEventListener('keydown', tecla)
    return () => { document.removeEventListener('keydown', tecla); antes?.focus() }
  }, [alCerrar])

  return (
    <div className="cli-telon" onMouseDown={e => { if (e.target === e.currentTarget) alCerrar() }}>
      <div className={clara ? 'cli-hoja clara' : 'cli-hoja'} ref={caja} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="cli-hoja-cabeza">
          <h2>{titulo}</h2>
          <button className="cli-cerrar" aria-label="Cerrar" onClick={alCerrar}><X size={22} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── El QR ────────────────────────────────────────────────────────────────────
function HojaQR({ credencial, alCerrar, alPerderSesion }: {
  credencial: { p_dni: string; p_dispositivo: string }
  alCerrar: () => void; alPerderSesion: () => void
}) {
  const [pase, setPase] = useState<{ codigo: string; corto: string; desde: number; hasta: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ahora, setAhora] = useState(Date.now())
  const pidiendo = useRef(false)
  const { p_dni, p_dispositivo } = credencial

  const pedir = useCallback(async () => {
    if (pidiendo.current) return
    pidiendo.current = true
    const r = await rpc<Pase>('cliente_generar_pase', { p_dni, p_dispositivo })
    pidiendo.current = false
    if (!r.ok) {
      if (r.motivo === 'sesion_invalida') { alPerderSesion(); return }
      setError(mensaje(r.motivo)); return
    }
    // El vencimiento se cuenta con el reloj de ESTE celular a partir de ahora,
    // no con la hora que manda el servidor: un celular con la hora corrida
    // mostraría como vencido un QR recién hecho.
    const t = Date.now()
    setError(null)
    setPase({ codigo: r.codigo, corto: r.codigo_corto, desde: t, hasta: t + r.segundos * 1000 })
  }, [p_dni, p_dispositivo, alPerderSesion])

  useEffect(() => { void pedir() }, [pedir])

  // Un reloj por segundo mueve la barra y renueva el código cuando le quedan
  // 30 segundos: así el que está en pantalla siempre tiene margen para que la
  // tablet lo lea.
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000)
    const alVolver = () => { if (document.visibilityState === 'visible') setAhora(Date.now()) }
    document.addEventListener('visibilitychange', alVolver)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', alVolver) }
  }, [])
  const resta = pase ? pase.hasta - ahora : 0
  useEffect(() => { if (pase && resta < 30000) void pedir() }, [pase, resta, pedir])

  // Que el celular no apague la pantalla con el QR a la vista.
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let traba: WakeLockSentinel | null = null
    let vigente = true
    navigator.wakeLock.request('screen').then(t => { if (vigente) traba = t; else void t.release() }).catch(() => {})
    return () => { vigente = false; void traba?.release() }
  }, [])

  const vencido = pase != null && resta <= 0
  // La barra se vacía cuando toca renovar (a los 30 s del final), no cuando
  // vence: así llega a cero justo cuando aparece el código nuevo.
  const fraccion = pase ? Math.max(0, Math.min(1, (resta - 30000) / (pase.hasta - pase.desde - 30000))) : 0

  return (
    <Hoja titulo="Tu QR" alCerrar={alCerrar} clara>
      <p className="cli-qr-guia">Acercalo a la cámara de la tablet del grifo</p>
      <div className="cli-qr">
        {pase && !vencido
          ? <QRVector texto={pase.codigo} titulo="Tu código QR para el grifo" />
          : <div className="cli-qr-espera">{error ? <WarningCircle size={40} aria-hidden="true" /> : <span className="cli-pulso" aria-hidden="true" />}</div>}
      </div>
      {error ? (
        <>
          <p className="cli-nota grave" role="alert"><WarningCircle size={22} aria-hidden="true" /><span>{error}</span></p>
          <button className="cli-btn primario" onClick={() => void pedir()}>Probar de nuevo</button>
        </>
      ) : (
        <>
          <div className="cli-qr-barra" aria-hidden="true"><span style={{ transform: `scaleX(${fraccion})` }} /></div>
          <p className="cli-qr-nota">Se renueva solo. Una captura de pantalla no sirve.</p>
          <div className="cli-codigo">
            <span>Para cargar en la caja, decí este código</span>
            <strong aria-label={pase ? pase.corto.split('').join(' ') : undefined}>
              {pase && !vencido ? `${pase.corto.slice(0, 3)} ${pase.corto.slice(3)}` : '··· ···'}
            </strong>
          </div>
          <p className="cli-qr-nota">Si la tablet no lo lee, subí el brillo del celular.</p>
        </>
      )}
    </Hoja>
  )
}

// ── Cargar saldo ─────────────────────────────────────────────────────────────
const RAPIDOS = [500000, 1000000, 2000000, 3000000]
const MINIMO = 100000, MAXIMO = 20000000

function HojaCarga({ cuenta, dispositivo, alCerrar, alMostrarQR }: {
  cuenta: Cuenta; dispositivo: string; alCerrar: () => void; alMostrarQR: () => void
}) {
  const [elegido, setElegido] = useState<number | null>(RAPIDOS[1])
  const [otro, setOtro] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const escrito = otro.trim() === '' ? null : aCentavos(otro)
  const centavos = otro.trim() === '' ? elegido : escrito
  const valido = centavos != null && centavos >= MINIMO && centavos <= MAXIMO && centavos % 100 === 0

  async function pagar() {
    if (!valido || ocupado || centavos == null) return
    setOcupado(true); setError(null)
    const r = await mercadoPago<{ ok: true; pago_id: string; url: string }>({
      accion: 'crear', dni: cuenta.dni, dispositivo, centavos,
    })
    if (!r.ok) { setOcupado(false); setError(mensaje(r.motivo)); return }
    // Se anota antes de irse: al volver, la app sabe por qué pago preguntar.
    guardar(CLAVE_PAGO, { id: r.pago_id, en: Date.now() })
    location.href = r.url
  }

  return (
    <Hoja titulo="Cargar saldo" alCerrar={alCerrar}>
      <div className="cli-montos" role="group" aria-label="Monto a cargar">
        {RAPIDOS.map(c => (
          <button key={c} className={otro.trim() === '' && elegido === c ? 'cli-monto-btn elegido' : 'cli-monto-btn'}
                  aria-pressed={otro.trim() === '' && elegido === c}
                  onClick={() => { setElegido(c); setOtro(''); setError(null) }}>
            {pesos(c).replace(',00', '')}
          </button>
        ))}
      </div>

      <label htmlFor="cli-otro">Otro monto</label>
      <input id="cli-otro" inputMode="numeric" placeholder="Ej. 7500" value={otro}
             onChange={e => { setOtro(e.target.value.replace(/[^\d.]/g, '')); setError(null) }} />
      {otro.trim() !== '' && !valido && (
        <p className="cli-ayuda grave">{MENSAJES.monto_fuera_de_rango}</p>
      )}

      {error && <p className="cli-nota grave" role="alert"><WarningCircle size={22} aria-hidden="true" /><span>{error}</span></p>}

      <button className="cli-btn primario" onClick={pagar} disabled={!valido || ocupado}>
        {ocupado ? 'Abriendo Mercado Pago…' : `Pagar ${valido && centavos != null ? pesos(centavos).replace(',00', '') : ''} con Mercado Pago`}
      </button>
      <p className="cli-ayuda">Te llevamos a Mercado Pago y volvés solo. El saldo se acredita al instante.</p>

      <div className="cli-efectivo">
        <p><strong>¿Pagás en efectivo?</strong> Andá a la caja, mostrá tu QR y te cargan ahí mismo.</p>
        <button className="cli-btn" onClick={alMostrarQR}><QrCode size={20} aria-hidden="true" /> Mostrar mi QR</button>
      </div>
    </Hoja>
  )
}
