import { useEffect, useId, useRef, useState } from 'react'

/* ─────────────────────────────────────────────────────────────────────────────
 * El vaso de cerveza de la pantalla de la canilla.
 *
 * Es lo que mira el cliente mientras se sirve, a un metro de distancia. Tiene
 * que leerse de un vistazo y tiene que dar ganas.
 *
 * ── Por qué está hecho a mano y no con una librería ──────────────────────────
 *
 * Con three.js o una librería de animación serían cientos de kilobytes que una
 * tablet vieja tarda en bajar y en arrancar, para dibujar una forma que no
 * cambia nunca. SVG + CSS pesa cero, arranca instantáneo, escala sin pixelarse,
 * y las animaciones las hace la placa de video.
 *
 * ── Lo que hace que se lea como un vaso y no como un gráfico de barras ──────
 *
 * **La superficie del líquido es una elipse, no una línea recta.** Al vaso lo
 * mirás desde un poco arriba, así que la superficie se ve en perspectiva. Una
 * línea horizontal lo aplana de golpe, y ningún brillo lo arregla.
 *
 * Lo mismo el borde del vaso: una elipse abierta arriba dice "esto tiene
 * adentro". Un rectángulo dice "esto es un dibujo".
 *
 * ── De dónde sale cada cosa ─────────────────────────────────────────────────
 *
 *   · La ALTURA sale de los ml servidos, que llegan del ESP32.
 *   · El COLOR sale de `grifos.color`: una IPA y una stout se ven distintas.
 *   · La ESPUMA crece con el caudal. Al abrir se dispara y baja sola.
 *   · Las BURBUJAS suben más rápido cuanto más caudal.
 * ─────────────────────────────────────────────────────────────────────────── */

const RIM    = 46          // borde de arriba del vaso
const BASE   = 272         // fondo
const TOPE   = 74          // donde llega el líquido con el vaso lleno
const RX_RIM = 52          // medio ancho arriba
const RX_PIE = 40          // medio ancho abajo
const CX     = 100

/** Medio ancho del vaso a una altura dada. El vaso es troncocónico: se angosta
 *  hacia abajo, como casi todos los vasos de cerveza. */
function rxEn(y: number): number {
  const t = (y - RIM) / (BASE - RIM)
  return RX_RIM - t * (RX_RIM - RX_PIE)
}

/** Mezcla un color con blanco (positivo) o con negro (negativo), sin depender
 *  de `color-mix`: la tablet de la canilla puede ser vieja. */
function mezclar(hex: string, hacia: number): string {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16))
  const m = (v: number) => Math.round(hacia >= 0 ? v + (255 - v) * hacia : v * (1 + hacia))
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`
}

/** Cuánto está saliendo ahora mismo, de 0 a 1.
 *
 *  Se calcula mirando cuánto cambió el volumen entre dos refrescos. No es una
 *  medición para cobrar —eso lo hace el ESP32— sino para saber cuánta espuma
 *  dibujar. Baja suave: si cortara de golpe, la espuma desaparecería de un
 *  frame al otro y se vería falso. */
function useCaudal(ml: number): number {
  const [caudal, setCaudal] = useState(0)
  const previo = useRef({ ml, t: Date.now() })

  useEffect(() => {
    const ahora = Date.now()
    const dt = Math.max(1, ahora - previo.current.t)
    const dml = Math.max(0, ml - previo.current.ml)
    previo.current = { ml, t: ahora }
    setCaudal(c => Math.max(Math.min(1, (dml / dt) * 1000 / 40), c))
  }, [ml])

  useEffect(() => {
    const t = setInterval(() => setCaudal(c => (c < 0.02 ? 0 : c * 0.9)), 130)
    return () => clearInterval(t)
  }, [])

  return caudal
}

export default function Vaso({ ml, objetivo, color }: {
  ml: number; objetivo: number; color: string
}) {
  const caudal = useCaudal(ml)

  // Los `id` de un SVG son globales al documento: si dos vasos usaran los
  // mismos, el segundo heredaría los degradados del primero y saldría del color
  // equivocado. `useId` le da a cada instancia los suyos.
  const uid = useId().replace(/:/g, '')
  const id = (n: string) => `${n}-${uid}`

  const frac     = Math.max(0, Math.min(1.06, ml / Math.max(1, objetivo)))
  const yL       = BASE - frac * (BASE - TOPE)      // superficie del líquido
  const rxL      = rxEn(yL)
  const ryL      = rxL * 0.19                        // la elipse de la superficie
  const pasado   = ml > objetivo
  const enMedida = Math.abs(ml - objetivo) / objetivo < 0.05

  // Una cerveza servida conserva un dedo de espuma aunque no esté saliendo
  // nada. Sin ese piso, el vaso quieto parece jugo de manzana.
  const espuma = ml <= 0 ? 0 : 9 + caudal * 30

  const claro  = mezclar(color, 0.30)
  const medio  = color
  const hondo  = mezclar(color, -0.38)
  const borde  = mezclar(color, 0.55)

  const siluetaExterior =
    `M ${CX - RX_RIM} ${RIM} L ${CX - RX_PIE} ${BASE} Q ${CX} ${BASE + 14} ${CX + RX_PIE} ${BASE} L ${CX + RX_RIM} ${RIM}`

  return (
    <div className="vaso-caja">
      <svg viewBox="0 0 200 310" className="vaso-svg" role="img"
           aria-label={`Vaso con ${ml} mililitros de ${objetivo}`}>
        <defs>
          {/* El líquido es más oscuro abajo: es el mismo líquido, pero hay más
              centímetros de cerveza que atravesar. Sin eso se ve plano. */}
          <linearGradient id={id('liq')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={claro} />
            <stop offset="38%"  stopColor={medio} />
            <stop offset="100%" stopColor={hondo} />
          </linearGradient>

          {/* La luz entra por la izquierda. El lado opuesto queda más oscuro, y
              justo en el borde vuelve a brillar: es el vidrio curvo. */}
          <linearGradient id={id('vol')} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="rgba(255,255,255,.34)" />
            <stop offset="22%"  stopColor="rgba(255,255,255,.04)" />
            <stop offset="62%"  stopColor="rgba(0,0,0,.20)" />
            <stop offset="88%"  stopColor="rgba(0,0,0,.30)" />
            <stop offset="100%" stopColor="rgba(255,255,255,.22)" />
          </linearGradient>

          <linearGradient id={id('foam')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#fffdf6" />
            <stop offset="55%"  stopColor="#f3e9d2" />
            <stop offset="100%" stopColor="#dcc9a3" />
          </linearGradient>

          {/* Un desenfoque chico sobre la espuma. Sin él, los círculos se leen
              como círculos; con él, se funden y se leen como espuma. Es el
              mismo truco del `blur` sobre un grupo de formas en cualquier
              editor de diseño. */}
          <filter id={id('suave')} x="-20%" y="-40%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>

          <clipPath id={id('dentro')}>
            <path d={`${siluetaExterior} Z`} />
          </clipPath>
        </defs>

        {/* ── El vaso vacío, por detrás ────────────────────────────────────── */}
        <path d={`${siluetaExterior} Z`} fill="rgba(255,255,255,.045)" />

        <g clipPath={`url(#${id('dentro')})`}>
          {/* ── Líquido ───────────────────────────────────────────────────── */}
          {/* Con el vaso vacío no se dibuja nada: sin este `if`, la elipse de la
              superficie asomaba en el fondo y parecía un culito de cerveza que
              nadie sirvió. */}
          {ml > 0 && (
          <g className="vaso-nivel" style={{ transform: `translateY(${yL}px)` }}>
            <rect x="0" y="0" width="200" height="320" fill={`url(#${id('liq')})`} />
            {/* La superficie, vista en perspectiva. Esta elipse es lo que hace
                que el vaso deje de parecer un gráfico de barras. */}
            <ellipse cx={CX} cy="0" rx={rxL} ry={ryL} fill={claro} opacity=".85" />
            <ellipse cx={CX} cy="0" rx={rxL * 0.72} ry={ryL * 0.66}
                     fill="rgba(255,255,255,.16)" />
          </g>
          )}

          {/* ── Burbujas ──────────────────────────────────────────────────── */}
          {ml > 0 && BURBUJAS.map((b, i) => (
            <circle key={i} cx={b.x} cy={BASE - 6} r={b.r}
                    fill="rgba(255,255,255,.62)" className="vaso-burbuja"
                    style={{ animationDelay: `${b.d}s`,
                             animationDuration: `${Math.max(1.6, b.v - caudal * 1.8)}s` }} />
          ))}

          {/* ── Espuma ────────────────────────────────────────────────────── */}
          {espuma > 0 && (
            <g className="vaso-nivel" filter={`url(#${id('suave')})`}
               style={{ transform: `translateY(${yL}px)` }}>
              {/* El cuerpo: un bloque con el techo redondeado. */}
              <path d={`M ${CX - rxL - 2} 2
                        L ${CX - rxL - 2} ${-espuma * 0.5}
                        Q ${CX} ${-espuma * 1.25} ${CX + rxL + 2} ${-espuma * 0.5}
                        L ${CX + rxL + 2} 2 Z`}
                    fill={`url(#${id('foam')})`} />
              {/* Burbujas de distinto tamaño y opacidad sobre el techo. Todas
                  iguales se leen como un patrón; desparejas se leen como
                  espuma. */}
              {CRESTA.map((c, i) => (
                <circle key={i}
                        cx={CX + c.dx * (rxL / RX_RIM)}
                        cy={-espuma * (0.52 + c.dy)}
                        r={c.r * (0.55 + caudal * 0.6)}
                        fill={`url(#${id('foam')})`} opacity={c.o}
                        className="vaso-cresta"
                        style={{ animationDelay: `${i * 0.17}s` }} />
              ))}
            </g>
          )}

          {/* ── Volumen del vidrio, por encima de todo lo de adentro ───────── */}
          <path d={`${siluetaExterior} Z`} fill={`url(#${id('vol')})`} />
        </g>

        {/* ── Contorno, boca y brillos ─────────────────────────────────────── */}
        {/* La boca abierta: la elipse de arriba dice "esto tiene adentro". */}
        <ellipse cx={CX} cy={RIM} rx={RX_RIM} ry="11"
                 fill="rgba(0,0,0,.28)" stroke={borde} strokeWidth="2.2" />
        <ellipse cx={CX} cy={RIM} rx={RX_RIM - 4} ry="8"
                 fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1" />

        <path d={siluetaExterior} fill="none"
              stroke="rgba(255,255,255,.42)" strokeWidth="1.6" strokeLinecap="round" />

        {/* Los dos reflejos verticales son lo que termina de decir "vidrio". */}
        <rect x={CX - RX_RIM + 9} y={RIM + 16} width="6" height={BASE - RIM - 40}
              rx="3" fill="rgba(255,255,255,.30)" />
        <rect x={CX + RX_RIM - 15} y={RIM + 30} width="3" height={BASE - RIM - 70}
              rx="1.5" fill="rgba(255,255,255,.16)" />

        {/* El culo del vaso tiene espesor, y se nota. */}
        <path d={`M ${CX - RX_PIE} ${BASE - 6} Q ${CX} ${BASE + 8} ${CX + RX_PIE} ${BASE - 6}`}
              fill="none" stroke="rgba(255,255,255,.26)" strokeWidth="3" />

        {/* ── La marca: adónde hay que apuntar ────────────────────────────── */}
        <line x1={CX - RX_RIM - 6} y1={TOPE} x2={CX + RX_RIM + 6} y2={TOPE}
              stroke={enMedida ? '#8ef29b' : 'rgba(255,255,255,.45)'}
              strokeWidth="2" strokeDasharray="6 6" className="vaso-marca-linea" />
      </svg>

      <div className={`vaso-cifra${pasado ? ' pasado' : ''}${enMedida ? ' justo' : ''}`}>
        <span className="n">{ml}</span>
        <span className="u">ml de {objetivo}</span>
      </div>
    </div>
  )
}

/* Posiciones fijas y no al azar: si cambiaran en cada render, las burbujas
   saltarían de lugar en vez de subir. */
const BURBUJAS = [
  { x: 78,  r: 2.4, d: 0.0, v: 4.0 }, { x: 95,  r: 1.6, d: 1.2, v: 4.8 },
  { x: 110, r: 2.9, d: 0.5, v: 3.6 }, { x: 124, r: 1.9, d: 1.9, v: 4.4 },
  { x: 86,  r: 1.3, d: 2.4, v: 5.2 }, { x: 118, r: 2.2, d: 3.1, v: 3.9 },
  { x: 101, r: 1.7, d: 2.7, v: 4.7 }, { x: 131, r: 1.2, d: 0.9, v: 5.0 },
  { x: 70,  r: 1.8, d: 3.5, v: 4.2 }, { x: 108, r: 1.4, d: 4.1, v: 5.4 },
]

/* Desparejas a propósito: es lo que separa "espuma" de "patrón". */
const CRESTA = [
  { dx: -44, dy: 0.10, r: 9,  o: .95 }, { dx: -30, dy: 0.30, r: 13, o: .88 },
  { dx: -14, dy: 0.16, r: 10, o: 1   }, { dx:   2, dy: 0.36, r: 15, o: .92 },
  { dx:  17, dy: 0.14, r: 11, o: .85 }, { dx:  32, dy: 0.30, r: 12, o: .97 },
  { dx:  45, dy: 0.12, r: 8,  o: .9  },
]
