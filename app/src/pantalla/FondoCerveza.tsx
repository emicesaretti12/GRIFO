import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Fondo animado de la pantalla de canilla.
//
// Un canvas a pantalla completa con la cerveza de ESA canilla: el líquido sube
// según cuánto lleva servido, las burbujas nacen del fondo y suben, y arriba se
// forma espuma.
//
// Es un juguete, a propósito. La gente que espera en la barra va a tocar la
// pantalla — que haga algo lindo cuando la tocan es la diferencia entre un
// cartel y algo que se mira dos veces.
//
//   · Tocar revienta las burbujas que estén cerca y manda una onda.
//   · Al terminar de servir, `celebrar()` tira un estallido dorado.
//
// Por qué canvas y no CSS: son cientos de partículas moviéndose a 60 fps. Con
// elementos del DOM el navegador tendría que recalcular estilos y layout en cada
// cuadro; en canvas es una sola superficie que se repinta.
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  color: string
  /** 0 a 1: cuánto del vaso va lleno. */
  llenado: number
  /** 0 = quieto, 1 = sirviendo a full. Manda cuántas burbujas y qué tan rápido. */
  energia: number
  /** Se llama con el total acumulado cada vez que el cliente revienta burbujas. */
  alReventar?: (total: number) => void
}

export type FondoAPI = { celebrar: () => void }

type Burbuja = { x: number; y: number; r: number; vy: number; vx: number; fase: number }
type Onda = { x: number; y: number; r: number; vida: number }
type Chispa = { x: number; y: number; vx: number; vy: number; vida: number; r: number; giro: number }

function aRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [200, 129, 31]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const FondoCerveza = forwardRef<FondoAPI, Props>(function FondoCerveza(
  { color, llenado, energia, alReventar }, ref
) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  // Los props van a una ref para que el bucle los lea sin reiniciarse en cada
  // render: si el efecto dependiera de ellos, cada cambio de mililitros mataría
  // y recrearía toda la simulación.
  const props = useRef({ color, llenado, energia, alReventar })
  useEffect(() => { props.current = { color, llenado, energia, alReventar } })

  const chispas = useRef<Chispa[]>([])
  const celebrarRef = useRef<() => void>(() => {})
  useImperativeHandle(ref, () => ({ celebrar: () => celebrarRef.current() }), [])

  useEffect(() => {
    const cv = cvRef.current!
    const ctx = cv.getContext('2d')!
    const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let w = 0, h = 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const redimensionar = () => {
      w = cv.clientWidth; h = cv.clientHeight
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    redimensionar()
    const ro = new ResizeObserver(redimensionar); ro.observe(cv)

    const burbujas: Burbuja[] = []
    const ondas: Onda[] = []
    let nivel = 0
    let reventadas = 0
    let t = 0
    let corriendo = true

    const nacer = (x?: number, y?: number, fuerte = false): Burbuja => ({
      x: x ?? Math.random() * w,
      y: y ?? h + 10,
      r: 1.5 + Math.random() * (fuerte ? 7 : 5),
      vy: -(0.3 + Math.random() * 1.4) * (fuerte ? 3 : 1),
      vx: (Math.random() - 0.5) * (fuerte ? 3 : 0.35),
      fase: Math.random() * Math.PI * 2,
    })

    celebrarRef.current = () => {
      if (quieto) return
      const [R, G, B] = aRgb(props.current.color)
      for (let i = 0; i < 90; i++) {
        const a = Math.random() * Math.PI * 2
        const v = 3 + Math.random() * 11
        chispas.current.push({
          x: w / 2, y: h * 0.45,
          vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3,
          vida: 1, r: 2 + Math.random() * 5,
          giro: Math.random() * Math.PI,
        })
      }
      // Y un chorro de burbujas grandes desde abajo, como cuando se destapa
      for (let i = 0; i < 50; i++) burbujas.push(nacer(undefined, undefined, true))
      void R; void G; void B
    }

    function alTocar(e: PointerEvent) {
      const r = cv.getBoundingClientRect()
      const x = e.clientX - r.left, y = e.clientY - r.top
      ondas.push({ x, y, r: 0, vida: 1 })

      // Revienta las burbujas del radio: eso es lo que hace que tocar sea
      // satisfactorio en vez de decorativo.
      let popeadas = 0
      for (let i = burbujas.length - 1; i >= 0; i--) {
        const b = burbujas[i]
        if ((b.x - x) ** 2 + (b.y - y) ** 2 < 90 ** 2) {
          burbujas.splice(i, 1); popeadas++
          for (let k = 0; k < 3; k++) {
            const a = Math.random() * Math.PI * 2
            chispas.current.push({
              x: b.x, y: b.y, vx: Math.cos(a) * 2.5, vy: Math.sin(a) * 2.5 - 1,
              vida: 0.7, r: 1.5 + Math.random() * 2, giro: 0,
            })
          }
        }
      }
      if (popeadas > 0) {
        reventadas += popeadas
        props.current.alReventar?.(reventadas)
      }
      for (let i = 0; i < 16; i++) burbujas.push(nacer(x, y, true))
    }
    cv.addEventListener('pointerdown', alTocar)

    function cuadro() {
      if (!corriendo) return
      const { color, llenado, energia } = props.current
      const [R, G, B] = aRgb(color)
      t += 0.016

      // El nivel persigue al objetivo en vez de saltar: un vaso que da un brinco
      // cuando llega un dato nuevo se ve roto, aunque el dato sea correcto.
      nivel += (Math.max(0, Math.min(1, llenado)) - nivel) * 0.06

      const supBase = h * (1 - nivel * 0.9) - 4
      const amplitud = quieto ? 0 : 5 + energia * 12
      const superficie = (x: number) => supBase
        + Math.sin(x / 190 + t * 1.1) * amplitud
        + Math.sin(x / 70 - t * 1.9) * amplitud * 0.45

      ctx.clearRect(0, 0, w, h)

      // ── Líquido ───────────────────────────────────────────────────────────
      const grad = ctx.createLinearGradient(0, supBase, 0, h)
      grad.addColorStop(0, `rgba(${R},${G},${B},0.94)`)
      grad.addColorStop(1, `rgba(${Math.round(R * 0.55)},${Math.round(G * 0.45)},${Math.round(B * 0.36)},0.99)`)

      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let x = 0; x <= w; x += 8) ctx.lineTo(x, superficie(x))
      ctx.lineTo(w, h); ctx.closePath()
      ctx.fillStyle = grad; ctx.fill()

      // ── Espuma ────────────────────────────────────────────────────────────
      if (nivel > 0.02) {
        ctx.save()
        for (let x = -10; x <= w + 10; x += 9) {
          const y = superficie(x)
          const rr = 5 + Math.sin(x * 0.31 + t * 2) * 3 + energia * 4
          ctx.beginPath(); ctx.arc(x, y - 1, Math.abs(rr), 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255,250,238,${0.42 + Math.sin(x * 0.17 + t) * 0.14})`
          ctx.fill()
        }
        ctx.restore()
      }

      // ── Burbujas ──────────────────────────────────────────────────────────
      const objetivo = quieto ? 0 : Math.round(34 + energia * 150)
      if (burbujas.length < objetivo && Math.random() < 0.85) burbujas.push(nacer())

      for (let i = burbujas.length - 1; i >= 0; i--) {
        const b = burbujas[i]
        b.fase += 0.05
        b.y += b.vy * (1 + energia * 1.6)
        b.x += b.vx + Math.sin(b.fase) * 0.5
        b.vx *= 0.97
        if (b.y < superficie(b.x) - 4 || b.y < -20 || burbujas.length > objetivo + 80) {
          burbujas.splice(i, 1); continue
        }
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,250,235,${0.10 + (b.r / 9) * 0.30})`
        ctx.fill()
        // Brillito: una burbuja plana no se lee como burbuja
        ctx.beginPath(); ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.3, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill()
      }

      // ── Ondas del toque ───────────────────────────────────────────────────
      for (let i = ondas.length - 1; i >= 0; i--) {
        const o = ondas[i]
        o.r += 9; o.vida -= 0.022
        if (o.vida <= 0) { ondas.splice(i, 1); continue }
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(255,251,240,${o.vida * 0.5})`
        ctx.lineWidth = 2; ctx.stroke()
      }

      // ── Chispas (celebración y reventones) ────────────────────────────────
      for (let i = chispas.current.length - 1; i >= 0; i--) {
        const c = chispas.current[i]
        c.x += c.vx; c.y += c.vy
        c.vy += 0.22            // gravedad
        c.vx *= 0.99
        c.vida -= 0.014
        c.giro += 0.15
        if (c.vida <= 0) { chispas.current.splice(i, 1); continue }
        ctx.save()
        ctx.translate(c.x, c.y); ctx.rotate(c.giro)
        ctx.fillStyle = `rgba(255,${210 + Math.round(c.vida * 40)},150,${c.vida})`
        ctx.fillRect(-c.r / 2, -c.r / 2, c.r, c.r * 1.6)
        ctx.restore()
      }

      requestAnimationFrame(cuadro)
    }
    requestAnimationFrame(cuadro)

    return () => {
      corriendo = false
      ro.disconnect()
      cv.removeEventListener('pointerdown', alTocar)
    }
  }, [])

  return <canvas ref={cvRef} className="kiosco-fondo" aria-hidden="true" />
})

export default FondoCerveza
