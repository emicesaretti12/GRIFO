// Colores de una cerveza a partir del color que se carga en el panel.
//
// El panel guarda UN color por canilla. Una cerveza de verdad no es de un color:
// es más oscura en los bordes del vaso (atraviesa más líquido), más clara en el
// centro (la luz pasa derecho) y casi blanca en la espuma. Todo eso sale de acá,
// derivado del mismo tono, para que una Stout y una Golden se vean cada una
// como lo que son sin cargar cinco colores por canilla.

export type RGB = [number, number, number]

export function hexARgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [217, 162, 27]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function css([r, g, b]: RGB, a = 1): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`
}

export function mezclar(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function aHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h /= 6
  return [h, s, l]
}

function deHsl(h: number, s: number, l: number): RGB {
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))
  }
  return [f(0), f(8), f(4)]
}

export type Paleta = {
  base: RGB
  /** Los bordes del vaso: donde la luz atraviesa más cerveza. */
  hondo: RGB
  /** El centro, donde la luz pasa derecho. */
  luz: RGB
  /** El reflejo más fuerte dentro del líquido y en el chorro. */
  brillo: RGB
  espuma: RGB
  /** La espuma donde se apoya sobre la cerveza: tiene color. */
  espumaBaja: RGB
  /** 0..1: qué tan clara es la cerveza. Las burbujas se ven menos en una negra. */
  luminosidad: number
}

export function paleta(hex: string): Paleta {
  const base = hexARgb(hex)
  const [h, s, l] = aHsl(base)
  // La luz se corre apenas hacia el amarillo: es lo que hace una cerveza a
  // contraluz. El hondo, hacia el rojo.
  const luz = deHsl(h + 0.006, Math.min(1, s * 1.08), Math.min(0.7, l + (1 - l) * 0.15))
  return {
    base,
    hondo: deHsl(h - 0.01, Math.min(1, s * 1.08), l * 0.4),
    luz,
    brillo: deHsl(h + 0.02, Math.min(1, s * 1.05), Math.min(0.88, l + (1 - l) * 0.55)),
    // Cuanto más oscura la cerveza, más tostada la espuma: la de una Stout es
    // color crema, no blanca.
    espuma: mezclar([255, 251, 242], [214, 178, 128], Math.max(0, 0.36 - l) * 1.1),
    espumaBaja: mezclar([240, 228, 206], base, 0.3 + Math.max(0, 0.36 - l) * 0.6),
    luminosidad: l,
  }
}
