import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import '@fontsource-variable/big-shoulders-display'
import '@fontsource-variable/archivo'
import { ContactlessPayment, WarningCircle, WifiSlash } from '@phosphor-icons/react'
import { supabase } from '../lib/supabase'
import { pesos, volumen } from '../lib/plata'
import { veredicto, punteria } from './veredicto'
import './estilos-kiosco.css'
import Pinta from './Pinta'
import type { Modo } from './pinta/motor'
import { useNFC, porQueNoHayNFC } from '../lib/useNFC'
import { mensajeDeError } from '../lib/tipos'

// ─────────────────────────────────────────────────────────────────────────────
// Pantalla de una canilla, para correr en modo kiosco en la tablet que está al
// lado del grifo.
//
// SE CONECTA SOLA con el link/QR que da el panel, y borra el token de la barra
// de direcciones: la pantalla está a la vista de todos. Ver docs/pantalla-canilla.md
//
// ── Una sola cosa protagonista ───────────────────────────────────────────────
// La escena (la torre, la canilla y el vaso) queda montada todo el tiempo y es
// la que cuenta lo que pasa: se apaga, espera, sirve, decanta. El texto al
// costado cambia, la escena no se desmonta nunca. Por eso pasar de "tu turno" a
// "sirviendo" a "el ticket" se ve como un mismo vaso que se llena, y no como
// tres pantallas distintas.
// ─────────────────────────────────────────────────────────────────────────────

type Grifo = {
  id: number; nombre: string; estilo: string | null; descripcion: string | null
  abv: number | null; ibu: number | null; color: string; imagen_url: string | null
  precio_litro_centavos: number; ml_vaso: number; activo: boolean; listo: boolean
}
type Sesion = {
  id: number; tarjeta: string; saldo_centavos: number
  ml_maximos: number; ml_parcial: number; abierta_en: string; visto_en: string | null
}
type Ultima = {
  ml_servidos: number; costo_centavos: number
  saldo_final_centavos: number; tarjeta: string; cerrada_en: string
}
type Cliente = { veces: number; ml_total: number; es_primera: boolean }
type Puesto = { tarjeta: string; ml: number; veces: number }
type Estado = {
  ok: true; grifo: Grifo; sesion: Sesion | null; ultima: Ultima | null
  cliente: Cliente | null; ranking: Puesto[]
}

const CLAVE = 'grifo.pantalla'

function leerConfig(): { grifo: number; token: string } | null {
  try {
    const crudo = localStorage.getItem(CLAVE)
    return crudo ? JSON.parse(crudo) : null
  } catch { return null }
}

const litros = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

export default function Kiosco() {
  const [config, setConfig] = useState(leerConfig)
  const [estado, setEstado] = useState<Estado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [escena, setEscena] = useState(0)
  const sinRed = useRef(0)

  useEffect(() => {
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
    const grifo = Number(q.get('grifo'))
    const token = q.get('token')
    if (grifo > 0 && token) {
      const nueva = { grifo, token }
      localStorage.setItem(CLAVE, JSON.stringify(nueva))
      setConfig(nueva)
      history.replaceState(null, '', location.pathname + '#/pantalla')
    }
  }, [])

  const consultar = useCallback(async () => {
    if (!config) return
    const { data, error: err } = await supabase.rpc('pantalla_estado', {
      p_grifo: config.grifo, p_token: config.token,
    })
    if (err) {
      // Tolerante a cortes: recién al tercer fallo seguido avisamos. Un parpadeo
      // de WiFi no tiene por qué llenar de errores una pantalla del salón.
      if (++sinRed.current >= 3) setError('Sin conexión con el servidor.')
      return
    }
    sinRed.current = 0
    const r = data as Estado | { ok: false; motivo: string }
    if (!r.ok) {
      setError(r.motivo === 'token_invalido'
        ? 'El token de esta canilla ya no sirve. Volvé a vincular la pantalla desde el panel.'
        : 'Esta canilla no existe.')
      return
    }
    setError(null); setEstado(r)
  }, [config])

  // ── El lector NFC de la tablet ───────────────────────────────────────────
  // Acá la tablet deja de ser una pantalla y pasa a ser el lector: es la que
  // identifica al cliente y abre la sesión. El ESP32 se entera sondeando.
  const [avisoNfc, setAvisoNfc] = useState<string | null>(null)
  const abriendo = useRef(false)
  const ultimaLectura = useRef(0)

  const alLeerTarjeta = useCallback(async (uid: string) => {
    if (!config) return

    // Una tarjeta apoyada dispara `onreading` varias veces por segundo. Sin
    // esto, un solo apoyo manda diez pedidos iguales.
    //
    //   Es el debounce del submit. El usuario hizo una cosa; que salga un
    //   pedido.
    const ahora = Date.now()
    if (abriendo.current || ahora - ultimaLectura.current < 2500) return
    ultimaLectura.current = ahora
    abriendo.current = true
    setAvisoNfc(null)

    const { data, error: err } = await supabase.rpc('tablet_abrir_sesion', {
      p_uid: uid, p_grifo: config.grifo, p_token: config.token,
    })
    abriendo.current = false

    if (err) {
      // ── Decir QUÉ falló, no "revisá la conexión" ─────────────────────────
      // El mensaje genérico mandó a revisar el WiFi cuando lo que faltaba era
      // una función en la base. Media hora buscando en el lugar equivocado.
      //
      //   Un error que no dice qué pasó es peor que ninguno: manda a buscar a
      //   ciegas, y casi siempre al lugar más caro.
      const falta = err.code === 'PGRST202' ||
                    /could not find the function/i.test(err.message ?? '')
      setAvisoNfc(falta
        ? 'Falta instalar el backend: corré 26-sesion-activa.sql en Supabase.'
        : `No se pudo abrir la sesión: ${err.message}`)
      return
    }
    const r = data as { ok: boolean; motivo?: string; cliente?: string | null }
    if (!r.ok) {
      setAvisoNfc(r.motivo === 'canilla_ocupada' && r.cliente
        ? `Esperá: ${r.cliente} está sirviendo.`
        : mensajeDeError(r))
      return
    }

    // No esperamos al sondeo: el cliente acaba de apoyar la tarjeta y tiene
    // que ver su nombre ahora.
    await consultar()
  }, [config, consultar])

  const nfc = useNFC(alLeerTarjeta)

  // El aviso se borra solo. Es una pantalla de salón: nadie va a ir a cerrarlo.
  useEffect(() => {
    if (!avisoNfc) return
    // Diez segundos: los errores de instalación hay que poder leerlos y
    // anotarlos, no cazarlos al vuelo.
    const id = setTimeout(() => setAvisoNfc(null), 10000)
    return () => clearTimeout(id)
  }, [avisoNfc])

  const sirviendo = estado?.sesion != null
  useEffect(() => {
    if (!config) return
    void consultar()
    const id = setInterval(consultar, sirviendo ? 500 : 2000)
    return () => clearInterval(id)
  }, [config, consultar, sirviendo])

  // Con la canilla libre se va rotando qué se muestra al costado: la invitación,
  // el precio del vaso, el podio del día. Una pantalla fija se vuelve invisible
  // en un día.
  useEffect(() => {
    if (sirviendo || estado?.ultima) return
    const id = setInterval(() => setEscena(e => e + 1), 9000)
    return () => clearInterval(id)
  }, [sirviendo, estado?.ultima])

  // ── El contador que sube con el vaso ─────────────────────────────────────
  // Lo escribe la escena directo en el DOM, cuadro a cuadro. Pasarlo por el
  // estado de React re-renderizaría toda la pantalla 60 veces por segundo.
  const contado = useRef(0)
  const datos = useRef({ precio: 0, maximo: 0 })
  const refMl = useRef<HTMLSpanElement>(null)
  const refGastado = useRef<HTMLSpanElement>(null)
  const refQueda = useRef<HTMLSpanElement>(null)
  const pintarContador = useCallback(() => {
    const ml = contado.current
    const { precio, maximo } = datos.current
    if (refMl.current) refMl.current.textContent = String(ml)
    if (refGastado.current) refGastado.current.textContent = pesos(Math.ceil((ml * precio) / 1000))
    if (refQueda.current) refQueda.current.textContent = volumen(Math.max(0, maximo - ml))
  }, [])
  const alContar = useCallback((ml: number) => { contado.current = ml; pintarContador() }, [pintarContador])
  useLayoutEffect(() => { pintarContador() })

  if (!config) return <Config onListo={setConfig} />

  const g = estado?.grifo
  const color = g?.color ?? '#d9a21b'
  const s = estado?.sesion ?? null
  const u = estado?.ultima ?? null
  const cli = estado?.cliente ?? null
  const vaso = g?.ml_vaso ?? 473
  datos.current = { precio: g?.precio_litro_centavos ?? 0, maximo: s?.ml_maximos ?? 0 }

  const fuera = !!error || (estado != null && !g!.listo)
  const modo: Modo = !estado || fuera ? 'apagada'
    : s ? (s.ml_parcial > 0 ? 'sirviendo' : 'lista')
    : u ? 'servida'
    : 'exhibicion'
  const ml = s ? s.ml_parcial : u ? u.ml_servidos : 0
  const sesion = s ? `s${s.id}` : u ? `u${u.cerrada_en}` : null

  // Si el estilo es igual al nombre, decirlo dos veces es ruido.
  const estilo = g?.estilo && g.estilo.trim().toLowerCase() !== g.nombre.trim().toLowerCase() ? g.estilo : null
  const ficha = [g?.abv != null ? `${litros.format(g.abv)} % alc.` : null, g?.ibu != null ? `${g.ibu} IBU` : null]
    .filter(Boolean).join('   ')

  return (
    <div className="kiosco" style={{ '--cerveza': color } as React.CSSProperties}>
      <Pinta modo={modo} ml={ml} vaso={vaso} color={color} etiqueta={g?.nombre ?? ''}
             sesion={sesion} alContar={alContar} />

      <section className={s || u ? 'k-panel ocupado' : 'k-panel'}>
        <header className="k-cerveza">
          {g?.imagen_url && <img className="k-logo" src={g.imagen_url} alt={`Logo de ${g.nombre}`} />}
          <h1 className="k-nombre">{g?.nombre ?? 'GRIFO'}</h1>
          {(estilo || g?.descripcion) && (
            <p className="k-desc">{[estilo, g?.descripcion].filter(Boolean).join('. ')}</p>
          )}
          {ficha && <p className="k-ficha">{ficha}</p>}
        </header>

        <div className="k-centro">
          {error ? (
            <Aviso clave="error" icono={<WifiSlash size="1em" weight="regular" />}
                   titulo="Fuera de servicio" texto={error} />
          ) : !estado ? (
            <div className="k-estado" key="conectando">
              <p className="k-titulo k-respira">Conectando</p>
            </div>
          ) : !g!.listo ? (
            <Aviso clave="apagada" icono={<WarningCircle size="1em" weight="regular" />}
                   titulo="Fuera de servicio" texto="Esta canilla no está habilitada." />
          ) : s ? (
            s.ml_parcial > 0 ? (
              <div className="k-estado" key="sirviendo">
                <p className="k-contador" aria-live="off">
                  <span ref={refMl} className="k-num" /><span className="k-unidad">ml</span>
                </p>
                <p className="k-sub">
                  {s.ml_parcial > vaso ? `Vas por el vaso ${Math.ceil(s.ml_parcial / vaso)}` : `El vaso es de ${vaso} ml`}
                </p>
                <dl className="k-cifras">
                  <div><dt>Llevás</dt><dd><span ref={refGastado} /></dd></div>
                  <div><dt>Te quedan</dt><dd><span ref={refQueda} /></dd></div>
                </dl>
              </div>
            ) : (
              <Bienvenida saldo={s.saldo_centavos} maximo={s.ml_maximos} cliente={cli} />
            )
          ) : u ? (
            <Ticket ultima={u} vaso={vaso} cliente={cli} />
          ) : (
            <Libre escena={escena} ranking={estado.ranking} vaso={vaso}
                   precio={g!.precio_litro_centavos} />
          )}

          {/* El lector hay que encenderlo con un toque: el navegador exige un
              gesto para pedir el permiso de NFC, y no lo da al cargar la página.
              Una vez encendido queda escaneando solo. */}
          {!error && estado && g!.listo && !s && nfc.soportado && nfc.estado !== 'escaneando' && (
            <button className="k-encender" onClick={() => void nfc.empezar()}>
              <ContactlessPayment size={30} weight="regular" aria-hidden="true" />
              <span>
                <strong>Encender el lector</strong>
                <small>{nfc.error ?? 'Un toque cuando abre el bar'}</small>
              </span>
            </button>
          )}
        </div>

        {avisoNfc && <p className="k-alerta" role="alert">{avisoNfc}</p>}

        <footer className="k-pie">
          {g ? (
            <p className="k-precio">
              <span className="k-num">{pesos(g.precio_litro_centavos)}</span> el litro
              <span className="k-vaso">Vaso de {vaso} ml: {pesos(Math.ceil((vaso * g.precio_litro_centavos) / 1000))}</span>
            </p>
          ) : <span />}
          <p className="k-estado-red">
            {!nfc.soportado
              ? <span className="k-marca mal" title={porQueNoHayNFC()}>Sin NFC</span>
              : nfc.estado === 'escaneando'
                ? <span className="k-marca bien">Lector listo</span>
                : <span className="k-marca mal">Lector apagado</span>}
            <span>{s ? s.tarjeta : `Canilla ${config.grifo}`}</span>
          </p>
        </footer>
      </section>

      <div className="kiosco-version">{__VERSION__}</div>
    </div>
  )
}

function Aviso({ clave, icono, titulo, texto }: {
  clave: string; icono: React.ReactNode; titulo: string; texto: string
}) {
  return (
    <div className="k-estado" key={clave}>
      <p className="k-titulo"><span className="k-icono">{icono}</span>{titulo}</p>
      <p className="k-sub">{texto}</p>
    </div>
  )
}

/* ── Canilla libre: va rotando qué decir al costado ───────────────────────── */
function Libre({ escena, ranking, vaso, precio }: {
  escena: number; ranking: Puesto[]; vaso: number; precio: number
}) {
  const escenas = ranking.length > 0 ? 3 : 2
  const cual = escena % escenas

  if (cual === 0) return (
    <div className="k-estado" key="invita">
      <p className="k-titulo">Apoyá tu tarjeta</p>
      <p className="k-sub k-con-icono">
        <ContactlessPayment size="1.3em" weight="regular" aria-hidden="true" />
        Acercala al dorso de la tablet
      </p>
    </div>
  )

  if (cual === 1) return (
    <div className="k-estado" key="precio">
      <p className="k-sub">Un vaso de {vaso} ml</p>
      <p className="k-grande k-num">{pesos(Math.ceil((vaso * precio) / 1000))}</p>
      <p className="k-sub">Pagás lo que servís, al mililitro.</p>
    </div>
  )

  return (
    <div className="k-estado" key="podio">
      <p className="k-sub">Los que más tomaron hoy en esta canilla</p>
      <ol className="k-podio">
        {ranking.map(p => (
          <li key={p.tarjeta}>
            <span className="quien">{p.tarjeta}</span>
            <span className="cuanto k-num">{volumen(p.ml)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ── Tarjeta apoyada, todavía sin servir ──────────────────────────────────── */
function Bienvenida({ saldo, maximo, cliente }: {
  saldo: number; maximo: number; cliente: Cliente | null
}) {
  const saludo = !cliente || cliente.es_primera
    ? { t: 'Bienvenido', s: 'Es tu primera cerveza acá.' }
    : cliente.veces < 5
      ? { t: 'Hola de nuevo', s: `Es tu cerveza número ${cliente.veces + 1} acá.` }
      : { t: 'Qué bueno verte', s: `Van ${cliente.veces} cervezas y ${volumen(cliente.ml_total)} en total.` }

  return (
    <div className="k-estado" key="bienvenida">
      <p className="k-titulo">{saludo.t}</p>
      <p className="k-sub">{saludo.s}</p>
      <dl className="k-cifras">
        <div><dt>Tu saldo</dt><dd className="k-num">{pesos(saldo)}</dd></div>
        <div><dt>Te alcanza para</dt><dd className="k-num">{volumen(maximo)}</dd></div>
      </dl>
      {/* La válvula ya está abierta: lo que falta lo hace el cliente. */}
      <p className="k-accion">Abrí la canilla y serví</p>
    </div>
  )
}

/* ── El ticket, con el veredicto ──────────────────────────────────────────── */
function Ticket({ ultima, vaso, cliente }: {
  ultima: Ultima; vaso: number; cliente: Cliente | null
}) {
  const v = veredicto(ultima.ml_servidos, vaso)
  const p = punteria(ultima.ml_servidos, vaso)
  return (
    <div className="k-estado" key="ticket">
      <p className="k-titulo">{v.titulo}</p>
      <p className="k-sub">{v.sub}. {p} % de puntería.</p>
      <p className="k-contador"><span className="k-num">{ultima.ml_servidos}</span><span className="k-unidad">ml</span></p>
      <dl className="k-cifras">
        <div><dt>Te cobramos</dt><dd className="k-num">{pesos(ultima.costo_centavos)}</dd></div>
        <div><dt>Te queda</dt><dd className="k-num">{pesos(ultima.saldo_final_centavos)}</dd></div>
        {cliente && cliente.veces > 1 && (
          <div><dt>Llevás acá</dt><dd className="k-num">{volumen(cliente.ml_total)}</dd></div>
        )}
      </dl>
    </div>
  )
}

/* ── Vinculación inicial ──────────────────────────────────────────────────── */
function Config({ onListo }: { onListo: (c: { grifo: number; token: string }) => void }) {
  const [grifo, setGrifo] = useState('')
  const [token, setToken] = useState('')
  const valido = Number(grifo) > 0 && token.trim().length >= 16

  return (
    <div className="kiosco">
      <Pinta modo="apagada" ml={0} vaso={473} color="#d9a21b" etiqueta="GRIFO" sesion={null} />
      <div className="kiosco-config">
        <form className="caja" onSubmit={e => {
          e.preventDefault()
          if (!valido) return
          const c = { grifo: Number(grifo), token: token.trim() }
          localStorage.setItem(CLAVE, JSON.stringify(c))
          onListo(c)
        }}>
          <h1>Vincular esta pantalla</h1>
          <p>
            Lo más fácil es escanear el QR que da el panel en
            <strong> Canillas, Token</strong>: se configura sola y no hay nada
            que tipear. Si preferís, cargalo a mano.
          </p>

          <label htmlFor="g">Número de canilla</label>
          <input id="g" inputMode="numeric" value={grifo} placeholder="1"
                 onChange={e => setGrifo(e.target.value)} />

          <label htmlFor="t">Token de la canilla</label>
          <input id="t" value={token} placeholder="8537a4ed…" autoComplete="off"
                 onChange={e => setToken(e.target.value)} />

          <button type="submit" disabled={!valido}>Vincular</button>

          <p className="nota">
            El token se guarda solo en este dispositivo. Si lo perdés o se
            compromete, rotalo desde el panel: la pantalla y el ESP32 de esta
            canilla se desconectan juntos.
          </p>
        </form>
      </div>
      <div className="kiosco-version">{__VERSION__}</div>
    </div>
  )
}
