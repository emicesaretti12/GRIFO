import { useEffect, useId, useRef, useState } from 'react'

/* ─────────────────────────────────────────────────────────────────────────────
 * El recipiente de la pantalla de la canilla.
 *
 * Lo mira el cliente mientras se sirve, a un metro y con gente alrededor. Tiene
 * que leerse de un vistazo y tiene que dar ganas.
 *
 * ── La decisión de diseño que manda sobre todas las demás ────────────────────
 *
 * **El recipiente es la unidad.** Mostrar "510 de 473" en un vaso que se
 * desborda no dice nada: hay que leer dos números y hacer la cuenta. Cambiar a
 * una jarra da una referencia que se entiende sin leer.
 *
 * Y arregla algo peor: pasarse del vaso **no es un error**. El cliente está
 * comprando más cerveza, que es exactamente lo que el bar quiere. Pintarlo de
 * naranja como una advertencia es castigar al cliente por gastar más.
 *
 * Acá pasarse es un **ascenso**: el vaso se convierte en jarra, con su
 * animación y su cartel. La meta se mueve con vos en vez de quedar atrás.
 *
 *   Es la diferencia entre un validador que te dice "excediste el límite" y uno
 *   que te dice "desbloqueaste el plan siguiente".
 *
 * ── Lo que hace que se lea como un recipiente y no como un gráfico ──────────
 *
 * **La superficie del líquido es una elipse, no una línea recta.** Al vaso lo
 * mirás desde un poco arriba, así que la superficie se ve en perspectiva. Una
 * línea horizontal lo aplana de golpe, y ningún brillo lo arregla.
 *
 * ── Sin librerías ───────────────────────────────────────────────────────────
 *
 * three.js o una librería de animación serían cientos de kilobytes que una
 * tablet vieja tarda en bajar y en arrancar, para dibujar dos formas que no
 * cambian nunca. SVG + CSS pesa cero y lo anima la placa de video.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Una jarra estándar. Cuando alguien se pasa del vaso, va por esto. */
export const JARRA_ML = 1000

type Forma = {
  clave: 'vaso' | 'jarra'
  nombre: string
  cx: number
  rim: number      // borde de arriba
  base: number     // fondo
  tope: number     // hasta dónde llega el líquido cuando está lleno
  rxRim: number
  rxPie: number
  ryBoca: number   // qué tan abierta se ve la boca
  asa?: string     // el trazo del asa, si tiene
}

const VASO: Forma = {
  clave: 'vaso', nombre: 'vaso', cx: 96,
  rim: 46, base: 272, tope: 74, rxRim: 50, rxPie: 39, ryBoca: 11,
}

/* La jarra es más ancha, más recta y tiene asa. Las tres cosas juntas son las
   que la hacen reconocible de lejos: si solo fuera "un vaso más grande", nadie
   notaría el cambio. */
const JARRA: Forma = {
  clave: 'jarra', nombre: 'jarra', cx: 86,
  rim: 54, base: 268, tope: 80, rxRim: 66, rxPie: 62, ryBoca: 13,
  asa: 'M 150 112 q 46 8 46 44 q 0 36 -46 44',
}

function rxEn(f: Forma, y: number): number {
  const t = (y - f.rim) / (f.base - f.rim)
  return f.rxRim - t * (f.rxRim - f.rxPie)
}

function silueta(f: Forma): string {
  return `M ${f.cx - f.rxRim} ${f.rim} L ${f.cx - f.rxPie} ${f.base}
          Q ${f.cx} ${f.base + 14} ${f.cx + f.rxPie} ${f.base}
          L ${f.cx + f.rxRim} ${f.rim}`
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
 *  No es una medición para cobrar —eso lo hace el ESP32— sino para saber cuánta
 *  espuma dibujar. Baja suave: si cortara de golpe, la espuma desaparecería de
 *  un frame al otro y se vería falso. */
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

/** El cartel de ascenso, que aparece al cambiar de recipiente y se va solo.
 *
 *  Dura 2,2 s: alcanza para leerlo sin quedarse tapando el vaso justo cuando
 *  el cliente quiere ver cuánto lleva. Un cartel que hay que cerrar sería
 *  peor que no tenerlo, porque las manos están ocupadas. */
function useAscenso(clave: string): boolean {
  const [visible, setVisible] = useState(false)
  const primera = useRef(true)

  useEffect(() => {
    if (primera.current) { primera.current = false; return }
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 2200)
    return () => clearTimeout(t)
  }, [clave])

  return visible
}

export default function Recipiente({ ml, vasoMl, color }: {
  ml: number; vasoMl: number; color: string
}) {
  const caudal = useCaudal(ml)

  // El recipiente se elige por cuánto hay servido. La meta se mueve con vos.
  const forma    = ml > vasoMl ? JARRA : VASO
  const capacidad = forma.clave === 'vaso' ? vasoMl : JARRA_ML
  const ascenso  = useAscenso(forma.clave)

  // Los `id` de un SVG son globales al documento: dos recipientes en la misma
  // página compartirían los degradados y el segundo saldría del color del
  // primero. `useId` le da a cada instancia los suyos.
  const uid = useId().replace(/:/g, '')
  const id = (n: string) => `${n}-${uid}`

  const frac     = Math.max(0, Math.min(1, ml / capacidad))
  const yL       = forma.base - frac * (forma.base - forma.tope)
  const rxL      = rxEn(forma, yL)
  const ryL      = rxL * 0.19
  const lleno    = ml >= capacidad
  const enMedida = Math.abs(ml - capacidad) / capacidad < 0.04

  // Una cerveza servida conserva un dedo de espuma aunque no esté saliendo
  // nada. Sin ese piso, el recipiente quieto parece jugo de manzana.
  const espuma = ml <= 0 ? 0 : 9 + caudal * 30

  const claro = mezclar(color, 0.30)
  const medio = color
  const hondo = mezclar(color, -0.38)
  const borde = mezclar(color, 0.55)

  const d = silueta(forma)

  return (
    <div className="vaso-caja">
      {/* El resplandor del color de la cerveza, detrás. Es lo que hace que la
          pantalla se sienta encendida y no impresa. */}
      <div className="vaso-halo"
           style={{ background: `radial-gradient(circle, ${medio}55 0%, transparent 68%)`,
                    opacity: 0.35 + frac * 0.45 }} />

      {ascenso && (
        <div className="vaso-ascenso">
          <span className="ico">🍺</span> ¡Ahora vas por una {forma.nombre}!
        </div>
      )}

      <svg key={forma.clave} viewBox="0 0 220 315" className="vaso-svg vaso-entra"
           role="img" aria-label={`${forma.nombre} con ${ml} mililitros de ${capacidad}`}>
        <defs>
          {/* Más oscuro abajo: es el mismo líquido, pero hay más centímetros de
              cerveza que atravesar. Sin esto se ve plano. */}
          <linearGradient id={id('liq')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={claro} />
            <stop offset="38%" stopColor={medio} />
            <stop offset="100%" stopColor={hondo} />
          </linearGradient>

          {/* La luz entra por la izquierda; el lado opuesto queda oscuro y en el
              borde vuelve a brillar. Eso es vidrio curvo. */}
          <linearGradient id={id('vol')} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(255,255,255,.34)" />
            <stop offset="22%" stopColor="rgba(255,255,255,.04)" />
            <stop offset="62%" stopColor="rgba(0,0,0,.20)" />
            <stop offset="88%" stopColor="rgba(0,0,0,.30)" />
            <stop offset="100%" stopColor="rgba(255,255,255,.22)" />
          </linearGradient>

          <linearGradient id={id('foam')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fffdf6" />
            <stop offset="55%" stopColor="#f3e9d2" />
            <stop offset="100%" stopColor="#dcc9a3" />
          </linearGradient>

          {/* Un desenfoque chico sobre la espuma. Sin él los círculos se leen
              como círculos; con él se funden y se leen como espuma. */}
          <filter id={id('suave')} x="-20%" y="-40%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>

          <clipPath id={id('dentro')}><path d={`${d} Z`} /></clipPath>
        </defs>

        {/* ── El asa, por detrás del cuerpo ────────────────────────────────── */}
        {forma.asa && (
          <>
            <path d={forma.asa} fill="none" stroke="rgba(255,255,255,.10)"
                  strokeWidth="15" strokeLinecap="round" />
            <path d={forma.asa} fill="none" stroke="rgba(255,255,255,.42)"
                  strokeWidth="2" strokeLinecap="round" />
            <path d={forma.asa} fill="none" stroke="rgba(255,255,255,.20)"
                  strokeWidth="5" strokeLinecap="round"
                  transform="translate(-3,-2)" />
          </>
        )}

        <path d={`${d} Z`} fill="rgba(255,255,255,.045)" />

        <g clipPath={`url(#${id('dentro')})`}>
          {ml > 0 && (
            <g className="vaso-nivel" style={{ transform: `translateY(${yL}px)` }}>
              <rect x="0" y="0" width="220" height="330" fill={`url(#${id('liq')})`} />
              {/* La superficie en perspectiva. Esta elipse es lo que hace que
                  deje de parecer un gráfico de barras. */}
              <ellipse cx={forma.cx} cy="0" rx={rxL} ry={ryL} fill={claro} opacity=".85" />
              <ellipse cx={forma.cx} cy="0" rx={rxL * 0.72} ry={ryL * 0.66}
                       fill="rgba(255,255,255,.16)" />
            </g>
          )}

          {ml > 0 && BURBUJAS.map((b, i) => (
            <circle key={i} cx={forma.cx + b.dx} cy={forma.base - 6} r={b.r}
                    fill="rgba(255,255,255,.62)" className="vaso-burbuja"
                    style={{ animationDelay: `${b.d}s`,
                             animationDuration: `${Math.max(1.6, b.v - caudal * 1.8)}s` }} />
          ))}

          {espuma > 0 && (
            <g className="vaso-nivel" filter={`url(#${id('suave')})`}
               style={{ transform: `translateY(${yL}px)` }}>
              <path d={`M ${forma.cx - rxL - 2} 2
                        L ${forma.cx - rxL - 2} ${-espuma * 0.5}
                        Q ${forma.cx} ${-espuma * 1.25} ${forma.cx + rxL + 2} ${-espuma * 0.5}
                        L ${forma.cx + rxL + 2} 2 Z`}
                    fill={`url(#${id('foam')})`} />
              {/* Desparejas en tamaño y opacidad: todas iguales se leen como un
                  patrón, así se leen como espuma. */}
              {CRESTA.map((c, i) => (
                <circle key={i}
                        cx={forma.cx + c.dx * (rxL / 50)}
                        cy={-espuma * (0.52 + c.dy)}
                        r={c.r * (0.55 + caudal * 0.6)}
                        fill={`url(#${id('foam')})`} opacity={c.o}
                        className="vaso-cresta"
                        style={{ animationDelay: `${i * 0.17}s` }} />
              ))}
            </g>
          )}

          <path d={`${d} Z`} fill={`url(#${id('vol')})`} />
        </g>

        {/* ── Boca, contorno y brillos ─────────────────────────────────────── */}
        <ellipse cx={forma.cx} cy={forma.rim} rx={forma.rxRim} ry={forma.ryBoca}
                 fill="rgba(0,0,0,.28)" stroke={borde} strokeWidth="2.2" />
        <ellipse cx={forma.cx} cy={forma.rim} rx={forma.rxRim - 4} ry={forma.ryBoca - 3}
                 fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1" />

        <path d={d} fill="none" stroke="rgba(255,255,255,.42)"
              strokeWidth="1.6" strokeLinecap="round" />

        <rect x={forma.cx - forma.rxRim + 9} y={forma.rim + 16}
              width="6" height={forma.base - forma.rim - 40}
              rx="3" fill="rgba(255,255,255,.30)" />
        <rect x={forma.cx + forma.rxRim - 15} y={forma.rim + 30}
              width="3" height={forma.base - forma.rim - 70}
              rx="1.5" fill="rgba(255,255,255,.16)" />

        <path d={`M ${forma.cx - forma.rxPie} ${forma.base - 6}
                  Q ${forma.cx} ${forma.base + 8} ${forma.cx + forma.rxPie} ${forma.base - 6}`}
              fill="none" stroke="rgba(255,255,255,.26)" strokeWidth="3" />

        {/* La marca de la medida. Solo mientras falte: una vez lleno estorba. */}
        {!lleno && (
          <line x1={forma.cx - forma.rxRim - 6} y1={forma.tope}
                x2={forma.cx + forma.rxRim + 6} y2={forma.tope}
                stroke={enMedida ? '#8ef29b' : 'rgba(255,255,255,.40)'}
                strokeWidth="2" strokeDasharray="6 6" className="vaso-marca-linea" />
        )}
      </svg>

      <div className={`vaso-cifra${enMedida || lleno ? ' justo' : ''}`}>
        <span className="n">{ml}</span>
        <span className="u">
          ml · {frase(ml, vasoMl)}
        </span>
      </div>
    </div>
  )
}

/** El número en unidades de bar. Lo que alguien diría en voz alta.
 *
 *  "1,2 jarras" se entiende sin pensar; "1180 ml" hay que traducirlo. El número
 *  exacto sigue estando arriba para el que lo quiera. */
function frase(ml: number, vasoMl: number): string {
  if (ml <= 0) return 'todavía nada'
  if (ml < vasoMl) {
    const p = Math.round((ml / vasoMl) * 100)
    return `${p}% de un vaso`
  }
  if (ml <= JARRA_ML) {
    const j = ml / JARRA_ML
    if (j >= 0.97) return 'una jarra entera'
    return `${(ml / vasoMl).toFixed(1).replace('.', ',')} vasos`
  }
  const j = ml / JARRA_ML
  return `${j.toFixed(1).replace('.', ',')} jarras`
}

/* Posiciones fijas y no al azar: si cambiaran en cada render, las burbujas
   saltarían de lugar en vez de subir. */
const BURBUJAS = [
  { dx: -18, r: 2.4, d: 0.0, v: 4.0 }, { dx:  -1, r: 1.6, d: 1.2, v: 4.8 },
  { dx:  14, r: 2.9, d: 0.5, v: 3.6 }, { dx:  28, r: 1.9, d: 1.9, v: 4.4 },
  { dx: -10, r: 1.3, d: 2.4, v: 5.2 }, { dx:  22, r: 2.2, d: 3.1, v: 3.9 },
  { dx:   5, r: 1.7, d: 2.7, v: 4.7 }, { dx:  35, r: 1.2, d: 0.9, v: 5.0 },
  { dx: -26, r: 1.8, d: 3.5, v: 4.2 }, { dx:  12, r: 1.4, d: 4.1, v: 5.4 },
]

const CRESTA = [
  { dx: -44, dy: 0.10, r: 9,  o: .95 }, { dx: -30, dy: 0.30, r: 13, o: .88 },
  { dx: -14, dy: 0.16, r: 10, o: 1   }, { dx:   2, dy: 0.36, r: 15, o: .92 },
  { dx:  17, dy: 0.14, r: 11, o: .85 }, { dx:  32, dy: 0.30, r: 12, o: .97 },
  { dx:  45, dy: 0.12, r: 8,  o: .9  },
]
