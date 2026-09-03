import { useEffect, useRef } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Fondo animado de la pantalla de canilla.
//
// Un canvas a pantalla completa con la cerveza de ESA canilla: el líquido sube
// según cuánto lleva servido, las burbujas nacen del fondo y suben, y arriba se
// forma espuma. Al tocar la pantalla, las burbujas salen disparadas desde el
// dedo y se dibuja una onda.
//
// Por qué canvas y no CSS: son cientos de partículas moviéndose a 60 fps. Con
// elementos del DOM el navegador tendría que recalcular estilos y layout en cada
// cuadro; en canvas es una sola superficie que se repinta.
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  /** Color de la cerveza, en hex. */
  color: string
  /** 0 a 1: cuánto del vaso va lleno. */
  llenado: number
  /** 0 = quieto, 1 = sirviendo a full. Manda cuántas burbujas y qué tan rápido. */
  energia: number
}

type Burbuja = { x: number; y: number; r: number; vy: number; vx: number; fase: number }
type Onda = { x: number; y: number; r: number; vida: number }

function aRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [200, 129, 31]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export default function FondoCerveza({ color, llenado, energia }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  // Los props van a una ref para que el bucle de animación los lea sin
  // reiniciarse en cada render: si el efecto dependiera de ellos, cada cambio
  // de mililitros mataría y recrearía toda la simulación.
  const props = useRef({ color, llenado, energia })
  useEffect(() => { props.current = { color, llenado, energia } }, [color, llenado, energia])

  useEffect(() => {
    const cv = ref.current!
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
    let nivel = 0            // nivel dibujado, persigue al objetivo con suavidad
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

    function alTocar(e: PointerEvent) {
      const r = cv.getBoundingClientRect()
      const x = e.clientX - r.left, y = e.clientY - r.top
      ondas.push({ x, y, r: 0, vida: 1 })
      for (let i = 0; i < 22; i++) burbujas.push(nacer(x, y, true))
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

      const supBase = h * (1 - nivel * 0.92) - 4
      ctx.clearRect(0, 0, w, h)

      // ── Líquido ───────────────────────────────────────────────────────────
      const grad = ctx.createLinearGradient(0, supBase, 0, h)
      grad.addColorStop(0, `rgba(${R},${G},${B},0.92)`)
      grad.addColorStop(1, `rgba(${Math.round(R * 0.62)},${Math.round(G * 0.52)},${Math.round(B * 0.42)},0.98)`)

      ctx.beginPath()
      ctx.moveTo(0, h)
      const amplitud = quieto ? 0 : 5 + energia * 12
      for (let x = 0; x <= w; x += 8) {
        const y = supBase
          + Math.sin(x / 190 + t * 1.1) * amplitud
          + Math.sin(x / 70 - t * 1.9) * amplitud * 0.45
        ctx.lineTo(x, y)
      }
      ctx.lineTo(w, h); ctx.closePath()
      ctx.fillStyle = grad; ctx.fill()

      // ── Espuma ────────────────────────────────────────────────────────────
      if (nivel > 0.02) {
        ctx.save(); ctx.globalAlpha = 0.85
        for (let x = 0; x <= w; x += 11) {
          const y = supBase
            + Math.sin(x / 190 + t * 1.1) * amplitud
            + Math.sin(x / 70 - t * 1.9) * amplitud * 0.45
          const rr = 6 + Math.sin(x * 0.31 + t * 2) * 3.5 + energia * 5
          ctx.beginPath(); ctx.arc(x, y - 2, Math.abs(rr), 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255,251,240,${0.5 + Math.sin(x * 0.17 + t) * 0.18})`
          ctx.fill()
        }
        ctx.restore()
      }

      // ── Burbujas ──────────────────────────────────────────────────────────
      const objetivo = quieto ? 0 : Math.round(28 + energia * 150)
      if (burbujas.length < objetivo && Math.random() < 0.85) burbujas.push(nacer())

      for (let i = burbujas.length - 1; i >= 0; i--) {
        const b = burbujas[i]
        b.fase += 0.05
        b.y += b.vy * (1 + energia * 1.6)
        b.x += b.vx + Math.sin(b.fase) * 0.5
        b.vx *= 0.97
        // Se deshacen al llegar a la superficie, o al salirse de cuadro
        const sup = supBase + Math.sin(b.x / 190 + t * 1.1) * amplitud
        if (b.y < sup - 4 || b.y < -20 || burbujas.length > objetivo + 60) {
          burbujas.splice(i, 1); continue
        }
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,250,235,${0.10 + (b.r / 9) * 0.30})`
        ctx.fill()
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

      requestAnimationFrame(cuadro)
    }
    requestAnimationFrame(cuadro)

    return () => {
      corriendo = false
      ro.disconnect()
      cv.removeEventListener('pointerdown', alTocar)
    }
  }, [])

  return <canvas ref={ref} className="kiosco-fondo" aria-hidden="true" />
}
