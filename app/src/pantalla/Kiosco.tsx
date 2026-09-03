import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, volumen } from '../lib/plata'
import FondoCerveza, { type FondoAPI } from './FondoCerveza'
import { veredicto, punteria } from './veredicto'
import './estilos-kiosco.css'

// ─────────────────────────────────────────────────────────────────────────────
// Pantalla de una canilla, para correr en modo kiosco en la tablet / monitor
// que está al lado del grifo.
//
// SE CONECTA SOLA con el link/QR que da el panel, y borra el token de la barra
// de direcciones: la pantalla está a la vista de todos. Ver docs/pantalla-canilla.md
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

export default function Kiosco() {
  const [config, setConfig] = useState(leerConfig)
  const [estado, setEstado] = useState<Estado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pops, setPops] = useState(0)
  const [escena, setEscena] = useState(0)
  const sinRed = useRef(0)
  const fondo = useRef<FondoAPI>(null)
  const ultimaVista = useRef<string | null>(null)

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

  const sirviendo = estado?.sesion != null
  useEffect(() => {
    if (!config) return
    void consultar()
    const id = setInterval(consultar, sirviendo ? 500 : 2000)
    return () => clearInterval(id)
  }, [config, consultar, sirviendo])

  // Estallido dorado cuando aparece un ticket nuevo — una sola vez por tirada.
  useEffect(() => {
    const u = estado?.ultima
    if (u && u.cerrada_en !== ultimaVista.current) {
      ultimaVista.current = u.cerrada_en
      fondo.current?.celebrar()
    }
  }, [estado?.ultima])

  // Con la canilla libre vamos rotando qué se muestra: la cerveza, el podio del
  // día, la invitación a jugar. Una pantalla fija se vuelve invisible en un día.
  useEffect(() => {
    if (sirviendo || estado?.ultima) return
    const id = setInterval(() => setEscena(e => e + 1), 8000)
    return () => clearInterval(id)
  }, [sirviendo, estado?.ultima])

  if (!config) return <Config onListo={setConfig} />

  const g = estado?.grifo
  const color = g?.color ?? '#c8811f'
  const s = estado?.sesion ?? null
  const u = estado?.ultima ?? null
  const cli = estado?.cliente ?? null
  const vaso = g?.ml_vaso ?? 473

  const llenado = s ? Math.min(1, s.ml_parcial / Math.max(1, s.ml_maximos)) : (u ? 1 : 0.14)
  const energia = s ? (s.ml_parcial > 0 ? 1 : 0.4) : 0.1
  const restante = s ? Math.max(0, s.ml_maximos - s.ml_parcial) : 0
  const gastado = s && g ? Math.ceil((s.ml_parcial * g.precio_litro_centavos) / 1000) : 0

  return (
    <div className="kiosco">
      <FondoCerveza ref={fondo} color={color} llenado={llenado} energia={energia}
                    alReventar={setPops} />

      <div className="kiosco-capa">
        <header className="kiosco-arriba">
          {g?.imagen_url
            ? <img className="kiosco-logo" src={g.imagen_url} alt="" />
            : <div className="kiosco-logo marcador" style={{ background: color }}>🍺</div>}
          <div>
            <div className="kiosco-nombre">{g?.nombre ?? 'Conectando…'}</div>
            {g?.estilo && <div className="kiosco-estilo">{g.estilo}</div>}
            <div className="kiosco-datos">
              {g?.abv != null && <span>{g.abv}% alc.</span>}
              {g?.ibu != null && <span>{g.ibu} IBU</span>}
              {g?.descripcion && <span>{g.descripcion}</span>}
            </div>
          </div>
        </header>

        <main className="kiosco-medio">
          {error ? (
            <div>
              <div className="kiosco-cartel">Fuera de servicio</div>
              <div className="kiosco-sub">{error}</div>
            </div>
          ) : !estado ? (
            <div className="kiosco-cartel kiosco-late">Conectando…</div>
          ) : !g!.listo ? (
            <div>
              <div className="kiosco-cartel">Fuera de servicio</div>
              <div className="kiosco-sub">Esta canilla no está habilitada.</div>
            </div>
          ) : s ? (
            s.ml_parcial > 0
              ? <Sirviendo ml={s.ml_parcial} vaso={vaso} gastado={gastado} restante={restante} />
              : <Bienvenida saldo={s.saldo_centavos} maximo={s.ml_maximos} cliente={cli} />
          ) : u ? (
            <Ticket ultima={u} vaso={vaso} cliente={cli} />
          ) : (
            <Libre escena={escena} ranking={estado.ranking} vaso={vaso}
                   precio={g!.precio_litro_centavos} pops={pops} />
          )}
        </main>

        <footer className="kiosco-abajo">
          <div className="kiosco-precio">
            {g ? pesos(g.precio_litro_centavos) : '—'} <small>el litro</small>
            {g && <span style={{ opacity: .6, fontSize: '.5em', marginLeft: 10 }}>
              vaso de {vaso} ml · {pesos(Math.ceil((vaso * g.precio_litro_centavos) / 1000))}
            </span>}
          </div>
          <div>
            {error
              ? <span className="kiosco-tag mal">Sin conexión</span>
              : s
                ? <span className="kiosco-tag bien">{s.tarjeta}</span>
                : <span className="kiosco-tag">Canilla {config.grifo}</span>}
          </div>
        </footer>
      </div>

      {pops > 0 && !sirviendo && (
        <div className="kiosco-pops">{pops} burbujas reventadas 🫧</div>
      )}
      <div className="kiosco-version">{__VERSION__}</div>
    </div>
  )
}

/* ── Canilla libre: va rotando qué mostrar ────────────────────────────────── */
function Libre({ escena, ranking, vaso, precio, pops }: {
  escena: number; ranking: Puesto[]; vaso: number; precio: number; pops: number
}) {
  // Con podio son tres escenas; sin podio, dos.
  const escenas = ranking.length > 0 ? 3 : 2
  const cual = escena % escenas

  if (cual === 0) return (
    <div className="kiosco-rota" key="a">
      <div className="kiosco-cartel">Apoyá tu tarjeta</div>
      <div className="kiosco-sub kiosco-late">en el lector de abajo</div>
    </div>
  )

  if (cual === 1) return (
    <div className="kiosco-rota" key="b">
      <div className="kiosco-sub">Un vaso de {vaso} ml</div>
      <div className="kiosco-cifra">{pesos(Math.ceil((vaso * precio) / 1000))}</div>
      <div className="kiosco-sub">
        {pops > 0
          ? `Ya reventaste ${pops} burbujas mientras esperás`
          : 'Tocá la pantalla mientras esperás 🫧'}
      </div>
    </div>
  )

  return (
    <div className="kiosco-rota" key="c">
      <div className="kiosco-sub" style={{ marginBottom: 14 }}>Los que más tomaron hoy acá</div>
      <div className="kiosco-podio">
        {ranking.map((p, i) => (
          <div className="p" key={p.tarjeta}>
            <span className="medalla">{['🥇', '🥈', '🥉'][i]}</span>
            <span className="quien">{p.tarjeta}</span>
            <span className="cuanto">{volumen(p.ml)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Tarjeta apoyada, todavía sin servir ──────────────────────────────────── */
function Bienvenida({ saldo, maximo, cliente }: {
  saldo: number; maximo: number; cliente: Cliente | null
}) {
  const saludo = !cliente || cliente.es_primera
    ? { t: '¡Bienvenido!', s: 'Es tu primera acá. Mantené apretado el botón del grifo' }
    : cliente.veces < 5
      ? { t: '¡Hola de nuevo!', s: `Es tu cerveza número ${cliente.veces + 1} acá` }
      : { t: '¡Qué gusto verte!', s: `Van ${cliente.veces} cervezas y ${volumen(cliente.ml_total)} en total` }

  return (
    <div className="kiosco-rota">
      <div className="kiosco-cartel">{saludo.t}</div>
      <div className="kiosco-sub kiosco-late">{saludo.s}</div>
      <div className="kiosco-fila">
        <div className="kiosco-dato">
          <div className="et">Tu saldo</div>
          <div className="va">{pesos(saldo)}</div>
        </div>
        <div className="kiosco-dato">
          <div className="et">Te alcanza para</div>
          <div className="va">{volumen(maximo)}</div>
        </div>
      </div>
    </div>
  )
}

/* ── Sirviendo: el medidor de puntería ────────────────────────────────────── */
function Sirviendo({ ml, vaso, gastado, restante }: {
  ml: number; vaso: number; gastado: number; restante: number
}) {
  const cerca = Math.abs(ml - vaso) / vaso < 0.05
  return (
    <div>
      <Aro valor={ml} objetivo={vaso} unidad="ml" acertado={cerca} />
      <div className="kiosco-sub" style={{ marginTop: 10 }}>
        {cerca ? '¡Ahí está la medida justa!' : `apuntá a los ${vaso} ml`}
      </div>
      <div className="kiosco-fila">
        <div className="kiosco-dato">
          <div className="et">Llevás gastado</div>
          <div className="va">{pesos(gastado)}</div>
        </div>
        <div className="kiosco-dato">
          <div className="et">Te queda</div>
          <div className="va">{volumen(restante)}</div>
        </div>
      </div>
    </div>
  )
}

/* ── Ticket con el veredicto ──────────────────────────────────────────────── */
function Ticket({ ultima, vaso, cliente }: {
  ultima: Ultima; vaso: number; cliente: Cliente | null
}) {
  const v = veredicto(ultima.ml_servidos, vaso)
  const p = punteria(ultima.ml_servidos, vaso)
  return (
    <div className="kiosco-rota">
      <div className="kiosco-veredicto">{v.titulo}</div>
      <div className="kiosco-sub">{v.sub} · {p}% de puntería</div>
      <div className="kiosco-cifra">{ultima.ml_servidos}<small>ml</small></div>
      <div className="kiosco-fila">
        <div className="kiosco-dato">
          <div className="et">Te cobramos</div>
          <div className="va">{pesos(ultima.costo_centavos)}</div>
        </div>
        <div className="kiosco-dato">
          <div className="et">Te queda</div>
          <div className="va">{pesos(ultima.saldo_final_centavos)}</div>
        </div>
        {cliente && cliente.veces > 1 && (
          <div className="kiosco-dato">
            <div className="et">Llevás acá</div>
            <div className="va">{volumen(cliente.ml_total)}</div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Aro de progreso ──────────────────────────────────────────────────────── */
function Aro({ valor, objetivo, unidad, acertado }: {
  valor: number; objetivo: number; unidad: string; acertado: boolean
}) {
  const r = 118, C = 2 * Math.PI * r
  const frac = Math.min(1.35, valor / objetivo)
  const lleno = Math.min(1, frac)
  return (
    <div className="kiosco-aro" style={{ width: 280, height: 280, margin: '0 auto' }}>
      <svg width={280} height={280} viewBox="0 0 280 280">
        <circle cx={140} cy={140} r={r} fill="none" stroke="rgba(255,255,255,.16)" strokeWidth={16} />
        <circle cx={140} cy={140} r={r} fill="none"
                stroke={acertado ? '#7ef08a' : '#fff'} strokeWidth={16} strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - lleno)}
                style={{ transition: 'stroke-dashoffset .35s ease-out, stroke .3s' }} />
        {/* La marca del vaso: adónde hay que apuntar */}
        <circle cx={140} cy={22} r={5} fill={acertado ? '#7ef08a' : 'rgba(255,255,255,.85)'} />
      </svg>
      <div className="adentro">
        <div>
          <div className="n">{valor}</div>
          <div className="u">{unidad} de {objetivo}</div>
        </div>
      </div>
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
      <FondoCerveza color="#c8811f" llenado={0.2} energia={0.15} />
      <div className="kiosco-config">
        <div className="caja">
          <h1>Vincular esta pantalla</h1>
          <p>
            Lo más fácil es escanear el QR que da el panel en
            <strong> Canillas → Token</strong>: se configura sola y no hay nada
            que tipear. Si preferís, cargalo a mano.
          </p>

          <label htmlFor="g">Número de canilla</label>
          <input id="g" inputMode="numeric" value={grifo} placeholder="1"
                 onChange={e => setGrifo(e.target.value)} />

          <label htmlFor="t">Token de la canilla</label>
          <input id="t" value={token} placeholder="8537a4ed…" autoComplete="off"
                 onChange={e => setToken(e.target.value)} />

          <button disabled={!valido} onClick={() => {
            const c = { grifo: Number(grifo), token: token.trim() }
            localStorage.setItem(CLAVE, JSON.stringify(c))
            onListo(c)
          }}>Vincular</button>

          <div className="error" style={{ background: 'rgba(255,255,255,.07)', borderColor: 'rgba(255,255,255,.16)' }}>
            El token se guarda solo en este dispositivo. Si lo perdés o se
            compromete, rotalo desde el panel: la pantalla y el ESP32 de esta
            canilla se desconectan juntos.
          </div>
        </div>
      </div>
      <div className="kiosco-version">{__VERSION__}</div>
    </div>
  )
}
