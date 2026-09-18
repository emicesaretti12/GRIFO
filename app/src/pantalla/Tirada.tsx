import { useEffect, useId, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// La tirada: la canilla y el vaso.
//
// ── El vaso arranca inclinado y se endereza ─────────────────────────────────
// Así se sirve una cerveza: el vaso a 45° contra la canilla, enderezándolo
// sobre el final para que la espuma quede en la corona y no en el vaso.
//
// Esa inclinación **es** la barra de progreso. Nadie tiene que aprender a
// leerla: cualquiera que haya visto servir una cerveza ya sabe qué significa.
//
//   Es usar el gesto del oficio como indicador, en vez de poner un porcentaje
//   al lado. El dato ya estaba en la escena.
//
// ── Por qué no hay una persona ──────────────────────────────────────────────
// Hubo una, dibujada a mano, y quedó mal: círculo, losa y fideo. Una figura
// humana mal dibujada arruina todo lo que tiene alrededor, porque el ojo la
// mira primero y perdona menos.
//
// El objeto no tiene ese problema: un vaso es geometría, y la geometría en SVG
// sale bien. Si algún día hay una ilustración de verdad, entra acá sin tocar
// nada más.
// ─────────────────────────────────────────────────────────────────────────────

/** El vaso pivota sobre su BOCA, no sobre su base.
 *
 *  Girando sobre la base, la boca se correría medio vaso y el chorro caería
 *  afuera. Girando sobre la boca, la boca queda quieta bajo la canilla y lo que
 *  se mueve es el cuerpo — que es lo que hace la mano de verdad. */
const BOCA_X = 151
const BOCA_Y = 110
const BASE_Y = 258
const INCLINACION = 26
const VASO = 'M113 110 L189 110 L179 244 Q179 258 164 258 L138 258 Q123 258 123 244 Z'

/** Suaviza el llenado: el ESP32 informa una vez por segundo y a saltos. Sin
 *  esto el vaso se endereza de golpe y se ve como una animación rota. */
function useSuave(objetivo: number, ms = 900) {
  const [v, setV] = useState(objetivo)
  const ref = useRef(objetivo)
  useEffect(() => {
    const desde = ref.current
    const t0 = performance.now()
    let raf = 0
    const paso = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      const e = 1 - Math.pow(1 - k, 3)      // easeOutCubic: un lineal se nota mecánico
      ref.current = desde + (objetivo - desde) * e
      setV(ref.current)
      if (k < 1) raf = requestAnimationFrame(paso)
    }
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
  }, [objetivo, ms])
  return v
}

export default function Tirada({ llenado, sirviendo, color }: {
  llenado: number
  sirviendo: boolean
  color: string
}) {
  // Los `id` de un SVG son globales al documento: dos pantallas en la misma
  // página compartirían los degradados.
  const id = useId().replace(/:/g, '')
  const gCerveza = `a${id}`
  const gVidrio  = `b${id}`
  const gChorro  = `c${id}`
  const gMetal   = `d${id}`
  const recorte  = `e${id}`

  const ll = Math.max(0, Math.min(1, useSuave(llenado)))
  const giro = INCLINACION * (1 - ll)

  // Deja un dedo de aire arriba aunque esté lleno: un vaso desbordando se lee
  // como un error, no como un logro.
  const alto  = (BASE_Y - BOCA_Y - 16) * ll
  const techo = BASE_Y - alto

  return (
    <svg className="tir" viewBox="0 0 302 300" role="img"
         aria-label={sirviendo ? 'Sirviendo cerveza' : 'Listo para servir'}>
      <defs>
        <linearGradient id={gCerveza} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor={color} stopOpacity=".72" />
          <stop offset="32%"  stopColor={color} />
          <stop offset="78%"  stopColor={color} />
          <stop offset="100%" stopColor="#000" stopOpacity=".22" />
        </linearGradient>
        <linearGradient id={gVidrio} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#fff" stopOpacity=".34" />
          <stop offset="22%"  stopColor="#fff" stopOpacity=".05" />
          <stop offset="82%"  stopColor="#fff" stopOpacity=".05" />
          <stop offset="100%" stopColor="#fff" stopOpacity=".24" />
        </linearGradient>
        <linearGradient id={gChorro} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor={color} stopOpacity=".35" />
          <stop offset="42%"  stopColor="#fff4d6" stopOpacity=".92" />
          <stop offset="100%" stopColor={color} stopOpacity=".35" />
        </linearGradient>
        <linearGradient id={gMetal} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"   stopColor="#6d7278" />
          <stop offset="26%"  stopColor="#eef2f5" />
          <stop offset="52%"  stopColor="#9aa1a8" />
          <stop offset="100%" stopColor="#4d5257" />
        </linearGradient>
        <clipPath id={recorte}><path d={VASO} /></clipPath>
      </defs>

      {/* ── La canilla ──────────────────────────────────────────────────── */}
      <g fill={`url(#${gMetal})`}>
        {/* La manija, del lado de afuera como en una barra de verdad */}
        <path d="M166 22 L206 8 Q214 6 215 13 L216 24 Q216 31 208 33 L166 40 Z" />
        <rect x="134" y="14" width="34" height="44" rx="10" />
        <rect x="140" y="52" width="22" height="42" rx="7" />
        <ellipse cx="151" cy="93" rx="13" ry="4.5" />
      </g>
      {/* El brillo del cromo: una línea, no un degradado más */}
      <rect x="140" y="20" width="5" height="70" rx="2.5" fill="#fff" opacity=".5" />

      {/* ── El chorro ───────────────────────────────────────────────────── */}
      {/* Se angosta al caer, porque al acelerar el mismo caudal pasa por menos
          sección. Es un trapecio, no un rectángulo. */}
      {sirviendo && (
        <g className="tir-chorro">
          <path d={`M144 93 L158 93 L${155.5} ${BOCA_Y + 6} L${146.5} ${BOCA_Y + 6} Z`}
                fill={`url(#${gChorro})`} />
          <circle className="tir-gota g1" cx="151" cy="100" r="2.6" />
          <circle className="tir-gota g2" cx="151" cy="100" r="1.9" />
        </g>
      )}

      {/* ── El vaso ─────────────────────────────────────────────────────── */}
      <g transform={`rotate(${giro} ${BOCA_X} ${BOCA_Y})`}>
        <g clipPath={`url(#${recorte})`}>
          <rect x="110" y={techo} width="82" height={alto + 20}
                fill={`url(#${gCerveza})`} />
          {ll > 0.015 && (
            <>
              {/* La espuma: dos óvalos corridos, que no quede una línea recta */}
              <rect x="110" y={techo - 11} width="82" height="13"
                    fill="#fff9ea" opacity=".95" />
              <ellipse cx="142" cy={techo - 11} rx="26" ry="7"   fill="#fffdf6" />
              <ellipse cx="166" cy={techo - 9}  rx="21" ry="5.5" fill="#fffdf6" />
            </>
          )}
        </g>

        {/* El vidrio va ENCIMA del líquido: el brillo se ve sobre la cerveza */}
        <path d={VASO} fill={`url(#${gVidrio})`}
              stroke="rgba(255,255,255,.66)" strokeWidth="2.6" strokeLinejoin="round" />
        {/* El reflejo largo de la izquierda y el fino de la derecha */}
        <path d="M127 122 L137 122 L131 240 L122 240 Z" fill="#fff" opacity=".24" />
        <path d="M175 126 L180 126 L174 236 L170 236 Z" fill="#fff" opacity=".13" />
        {/* Condensación: lo que hace que un vaso dibujado parezca frío */}
        <g className="tir-frio" fill="#fff">
          <circle cx="135" cy="166" r="2.6" /><circle cx="128" cy="196" r="1.9" />
          <circle cx="140" cy="215" r="2.2" /><circle cx="168" cy="178" r="2" />
          <circle cx="173" cy="208" r="2.7" /><circle cx="160" cy="232" r="1.8" />
        </g>
      </g>
    </svg>
  )
}
