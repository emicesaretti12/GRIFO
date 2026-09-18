import { useEffect, useId, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// El cantinero sirviendo.
//
// ── Por qué el vaso arranca inclinado ───────────────────────────────────────
// Así se sirve una cerveza: el vaso a 45°, la canilla contra el vidrio, y se
// va enderezando a medida que sube. Enderezarlo al final es lo que le da la
// corona de espuma sin desperdiciar media pinta.
//
// Acá esa inclinación **es** la barra de progreso: el vaso se endereza a medida
// que se llena. Nadie tiene que aprender a leerla — cualquiera que haya visto
// servir una cerveza ya sabe qué significa.
//
//   Es usar el gesto del oficio como indicador, en vez de poner un porcentaje
//   al lado. El dato ya estaba en la escena.
//
// ── El cantinero es una silueta ─────────────────────────────────────────────
// Dibujado en plano, a contraluz sobre la cerveza del fondo. Lo que tiene color
// es lo único que importa: el vaso y lo que cae adentro.
// ─────────────────────────────────────────────────────────────────────────────

/** El vaso pivota sobre su BOCA, no sobre su base.
 *
 *  Si girara sobre la base, la boca se correría casi cincuenta píxeles y el
 *  chorro caería al piso. Girando sobre la boca, la boca queda quieta debajo de
 *  la canilla y lo que se mueve es el cuerpo — que es, además, lo que hace el
 *  cantinero de verdad. */
const BOCA_X = 100
const BOCA_Y = 112
const BASE_Y = 236
const INCLINACION = 30          // grados con el vaso vacío
const VASO = 'M72 112 L128 112 L120 224 Q120 236 108 236 L92 236 Q80 236 80 224 Z'

/** Suaviza el llenado. El ESP32 informa una vez por segundo y a saltos; sin
 *  esto el vaso se endereza de golpe, como una animación rota. */
function useSuave(objetivo: number, ms = 900) {
  const [v, setV] = useState(objetivo)
  const ref = useRef(objetivo)
  useEffect(() => {
    const desde = ref.current
    const t0 = performance.now()
    let raf = 0
    const paso = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      // easeOutCubic: arranca rápido y frena. Un lineal se nota mecánico.
      const e = 1 - Math.pow(1 - k, 3)
      ref.current = desde + (objetivo - desde) * e
      setV(ref.current)
      if (k < 1) raf = requestAnimationFrame(paso)
    }
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
  }, [objetivo, ms])
  return v
}

export default function Cantinero({ llenado, sirviendo, color }: {
  /** 0 a 1. Cuánto lleva del vaso. */
  llenado: number
  /** Si está cayendo cerveza ahora mismo. */
  sirviendo: boolean
  /** El color de esta cerveza. */
  color: string
}) {
  // Los `id` de un SVG son globales al documento. Sin esto, dos pantallas en la
  // misma página compartirían los degradados.
  const id = useId().replace(/:/g, '')
  const cerveza = `c${id}`
  const vidrio  = `v${id}`
  const recorte = `r${id}`
  const chorro  = `h${id}`

  const ll = Math.max(0, Math.min(1, useSuave(llenado)))
  const giro = INCLINACION * (1 - ll)

  // El líquido sube desde la base. Deja un dedo de aire arriba aunque esté
  // "lleno": un vaso desbordando se lee como un error, no como un logro.
  const alto  = (BASE_Y - BOCA_Y - 12) * ll
  const techo = BASE_Y - alto

  return (
    <svg className="cant" viewBox="0 0 340 304" role="img"
         aria-label={sirviendo ? 'Sirviendo cerveza' : 'Listo para servir'}>
      <defs>
        <linearGradient id={cerveza} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity=".78" />
          <stop offset="55%"  stopColor={color} />
          <stop offset="100%" stopColor={color} stopOpacity=".88" />
        </linearGradient>
        <linearGradient id={chorro} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor={color} stopOpacity=".45" />
          <stop offset="45%"  stopColor="#fff6dd" stopOpacity=".95" />
          <stop offset="100%" stopColor={color} stopOpacity=".45" />
        </linearGradient>
        <linearGradient id={vidrio} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#ffffff" stopOpacity=".30" />
          <stop offset="28%"  stopColor="#ffffff" stopOpacity=".06" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity=".16" />
        </linearGradient>
        <clipPath id={recorte}><path d={VASO} /></clipPath>
      </defs>

      {/* ── El cantinero, en silueta ────────────────────────────────────── */}
      {/* Lleva una luz de contorno, y no es adorno: el fondo de esta pantalla
          es la cerveza animada, que cambia de color con cada canilla. Una
          silueta sin borde desaparece contra una rubia clara y contra una
          stout oscura, por motivos opuestos.

            Es no confiar en que el fondo vaya a contrastar. El contorno hace
            que la figura se lea contra cualquiera. */}
      <g className="cant-persona">
        <circle cx="246" cy="76" r="33" />
        <path d="M222 102 L268 102 Q292 110 299 150 L311 304 L182 304 L194 150 Q201 110 222 102 Z" />
        {/* El brazo llega hasta la mano. En la primera versión terminaba en el
            aire y el vaso parecía flotar. */}
        <path d="M208 142 Q170 160 134 150 L128 176 Q174 190 218 166 Z" />
      </g>

      {/* ── La canilla ──────────────────────────────────────────────────── */}
      <g className="cant-canilla">
        <rect x="86" y="0" width="28" height="50" rx="8" />
        <path d="M114 11 L152 1 L154 15 L114 25 Z" />
        <rect x="91" y="42" width="18" height="52" rx="6" />
        <ellipse cx="100" cy="94" rx="11" ry="4" />
      </g>

      {/* ── El chorro ───────────────────────────────────────────────────── */}
      {sirviendo && (
        <g className="cant-chorro">
          <rect x="95" y="94" width="10" height={BOCA_Y - 88} rx="5"
                fill={`url(#${chorro})`} />
          <circle className="cant-burbuja b1" cx="100" cy="100" r="2.4" />
          <circle className="cant-burbuja b2" cx="100" cy="100" r="1.8" />
        </g>
      )}

      {/* ── El vaso, girando sobre su boca ──────────────────────────────── */}
      <g transform={`rotate(${giro} ${BOCA_X} ${BOCA_Y})`}>
        <g clipPath={`url(#${recorte})`}>
          <rect x="68" y={techo} width="66" height={alto + 14}
                fill={`url(#${cerveza})`} />
          {/* La espuma se posa sobre el líquido y crece con el caudal */}
          {ll > 0.02 && (
            <>
              <rect x="68" y={techo - 10} width="66" height="12"
                    fill="#fff8e6" opacity=".92" />
              <ellipse cx="101" cy={techo - 10} rx="32" ry="6.5" fill="#fffdf5" />
            </>
          )}
        </g>

        {/* El vidrio va ENCIMA del líquido: el brillo tiene que verse sobre la
            cerveza, no debajo. */}
        <path d={VASO} fill={`url(#${vidrio})`}
              stroke="rgba(255,255,255,.62)" strokeWidth="2.5" strokeLinejoin="round" />
        <path d="M84 122 L93 122 L88 220 L80 220 Z" fill="#fff" opacity=".22" />

        {/* La mano, agarrando el vaso del lado de afuera */}
        <g className="cant-mano">
          <path d="M116 138 Q144 132 152 148 Q157 164 152 180 Q144 194 116 188 Z" />
          <rect x="114" y="146" width="30" height="7" rx="3.5" opacity=".5" />
          <rect x="114" y="158" width="30" height="7" rx="3.5" opacity=".5" />
          <rect x="114" y="170" width="28" height="7" rx="3.5" opacity=".5" />
        </g>
      </g>
    </svg>
  )
}
