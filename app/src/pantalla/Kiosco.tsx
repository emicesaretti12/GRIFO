import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, volumen } from '../lib/plata'
import FondoCerveza from './FondoCerveza'
import './estilos-kiosco.css'

// ─────────────────────────────────────────────────────────────────────────────
// Pantalla de una canilla, para correr en modo kiosco en la tablet / monitor
// que está al lado del grifo.
//
// SE CONECTA SOLA. La primera vez se abre con el link que da el panel de
// administración:
//
//     https://…/#/pantalla?grifo=1&token=8537a4ed…
//
// Guarda la configuración en el navegador de ESE dispositivo y **borra el token
// de la barra de direcciones**: la pantalla está a la vista de todos y el token
// no tiene por qué quedar ahí ni en el historial. De ahí en adelante, con abrir
// el navegador alcanza — sobrevive a reinicios y cortes de luz.
//
// Se autentica con el MISMO token del grifo que usa el ESP32: no hay
// credenciales nuevas que administrar, y rotar el token desconecta a los dos.
// ─────────────────────────────────────────────────────────────────────────────

type Grifo = {
  id: number; nombre: string; estilo: string | null; descripcion: string | null
  abv: number | null; ibu: number | null; color: string; imagen_url: string | null
  precio_litro_centavos: number; activo: boolean; listo: boolean
}
type Sesion = {
  id: number; tarjeta: string; saldo_centavos: number
  ml_maximos: number; ml_parcial: number; abierta_en: string; visto_en: string | null
}
type Ultima = {
  ml_servidos: number; costo_centavos: number
  saldo_final_centavos: number; tarjeta: string; cerrada_en: string
}
type Estado = { ok: true; grifo: Grifo; sesion: Sesion | null; ultima: Ultima | null }

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
  const sinRed = useRef(0)

  // Enganche automático desde el link del panel.
  useEffect(() => {
    const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
    const grifo = Number(q.get('grifo'))
    const token = q.get('token')
    if (grifo > 0 && token) {
      const nueva = { grifo, token }
      localStorage.setItem(CLAVE, JSON.stringify(nueva))
      setConfig(nueva)
      // El token fuera de la URL: la pantalla es pública.
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

  // Mientras alguien sirve consultamos más seguido, para que el vaso se llene
  // suave. Quieta, cada dos segundos alcanza y no castiga la conexión del bar.
  const sirviendo = estado?.sesion != null
  useEffect(() => {
    if (!config) return
    void consultar()
    const id = setInterval(consultar, sirviendo ? 500 : 2000)
    return () => clearInterval(id)
  }, [config, consultar, sirviendo])

  if (!config) return <Config onListo={setConfig} />

  const g = estado?.grifo
  const color = g?.color ?? '#c8811f'
  const s = estado?.sesion ?? null
  const u = estado?.ultima ?? null

  const llenado = s ? Math.min(1, s.ml_parcial / Math.max(1, s.ml_maximos)) : (u ? 1 : 0.16)
  const energia = s ? (s.ml_parcial > 0 ? 1 : 0.45) : 0.12

  const restante = s ? Math.max(0, s.ml_maximos - s.ml_parcial) : 0
  const gastado = useMemo(() => {
    if (!s || !g) return 0
    return Math.ceil((s.ml_parcial * g.precio_litro_centavos) / 1000)
  }, [s, g])

  return (
    <div className="kiosco" style={{ ['--cerveza' as string]: color }}>
      <FondoCerveza color={color} llenado={llenado} energia={energia} />

      <div className="kiosco-capa">
        <header className="kiosco-arriba">
          {g?.imagen_url
            ? <img className="kiosco-logo" src={g.imagen_url} alt="" />
            : <div className="kiosco-logo marcador">🍺</div>}
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
            s.ml_parcial > 0 ? (
              // ── Sirviendo ─────────────────────────────────────────────────
              <div>
                <div className="kiosco-cifra">
                  {s.ml_parcial}<small>ml</small>
                </div>
                <div className="kiosco-barra">
                  <i style={{ width: `${Math.round(llenado * 100)}%` }} />
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
            ) : (
              // ── Autorizado, esperando que apriete el botón ────────────────
              <div>
                <div className="kiosco-cartel">¡Hola! Ya podés servirte</div>
                <div className="kiosco-sub kiosco-late">Mantené apretado el botón del grifo</div>
                <div className="kiosco-fila">
                  <div className="kiosco-dato">
                    <div className="et">Tu saldo</div>
                    <div className="va">{pesos(s.saldo_centavos)}</div>
                  </div>
                  <div className="kiosco-dato">
                    <div className="et">Te alcanza para</div>
                    <div className="va">{volumen(s.ml_maximos)}</div>
                  </div>
                </div>
              </div>
            )
          ) : u ? (
            // ── Ticket, unos segundos después de cerrar ─────────────────────
            <div>
              <div className="kiosco-sub">Serviste</div>
              <div className="kiosco-cifra">{u.ml_servidos}<small>ml</small></div>
              <div className="kiosco-fila">
                <div className="kiosco-dato">
                  <div className="et">Te cobramos</div>
                  <div className="va">{pesos(u.costo_centavos)}</div>
                </div>
                <div className="kiosco-dato">
                  <div className="et">Te queda</div>
                  <div className="va">{pesos(u.saldo_final_centavos)}</div>
                </div>
              </div>
            </div>
          ) : (
            // ── Libre ───────────────────────────────────────────────────────
            <div>
              <div className="kiosco-cartel">Apoyá tu tarjeta</div>
              <div className="kiosco-sub kiosco-late">en el lector de abajo</div>
            </div>
          )}
        </main>

        <footer className="kiosco-abajo">
          <div className="kiosco-precio">
            {g ? pesos(g.precio_litro_centavos) : '—'} <small>el litro</small>
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
    </div>
  )
}

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
            Lo más fácil es abrir el link que da el panel de administración en
            <strong> Canillas → Pantalla</strong>: se configura sola y no hay
            nada que tipear. Si preferís, cargalo a mano.
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
    </div>
  )
}
