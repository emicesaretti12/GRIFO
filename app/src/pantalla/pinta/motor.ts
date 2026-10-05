import { css, mezclar, paleta, type Paleta, type RGB } from './color'

// ─────────────────────────────────────────────────────────────────────────────
// El motor de la tirada: la torre, la canilla y el vaso, dibujados en canvas.
//
// ── Lo que muestra es lo que pasa ───────────────────────────────────────────
// El vaso se llena con los mililitros que mide el caudalímetro, no con un
// temporizador. La manija se abre cuando la medición sube y se cierra cuando
// deja de subir. Si se pasa de un vaso, el lleno sale de cuadro y entra otro.
//
//   Es una vista, no una animación: el estado vive en el ESP32 y esto lo
//   dibuja. Si la canilla se traba, la pantalla se traba con ella.
//
// ── Por qué canvas y por qué así ────────────────────────────────────────────
// Un líquido son cientos de cosas moviéndose a la vez (burbujas, espuma,
// salpicaduras). En el DOM cada una sería un nodo con su layout; acá es una
// superficie que se repinta. Todo lo que no se mueve (la torre, el vidrio, la
// bandeja, las texturas) se pinta UNA vez en lienzos aparte y en cada cuadro
// solo se copia. El trabajo por cuadro es lo que de verdad cambia.
//
// ── Unidades ────────────────────────────────────────────────────────────────
// Todo se dibuja en un espacio fijo de 600 × 1000 unidades y se escala al
// tamaño real. El vaso mide 460 unidades de alto: ≈ 15 cm, o sea 1 unidad ≈
// 0,33 mm. Con eso alcanza para que las proporciones sean las de una pinta.
// ─────────────────────────────────────────────────────────────────────────────

export type Modo = 'exhibicion' | 'lista' | 'sirviendo' | 'servida' | 'apagada'

export type Entrada = {
  modo: Modo
  /** Mililitros de la sesión actual (o de la última, en `servida`). */
  ml: number
  /** Mililitros de un vaso: es lo que se dibuja como "lleno". */
  vaso: number
  color: string
  /** Lo que va escrito en la manija. */
  etiqueta: string
  /** Identifica la sesión: cambia de sesión = cambia de vaso. */
  sesion: string | null
}

// ── Geometría (unidades del espacio de la escena) ──────────────────────────
const S_W = 600
const S_H = 1000
const GX = 300                 // centro del vaso = eje del pico
const BOCA_Y = 440
const BASE_Y = 900
const FONDO_Y = 854            // fondo por dentro: la base de una pinta es gruesa
const R_BOCA = 118
const R_BASE = 88
const PARED = 5
const K = 0.11                 // achatamiento de las elipses: cámara apenas arriba de la boca
const LLENO_Y = BOCA_Y + 52    // hasta dónde llega el líquido con el vaso lleno
const PICO_Y = 352
const PIVOTE = { x: 290, y: 232 }
const MOSTRADOR_Y = 930
const BANDEJA = { x0: 150, x1: 450, arriba: 893, frente: 905, abajo: 929 }
const SALIDA = 300             // cuánto se corre un vaso cuando se lo llevan
const BAJADA = 46              // desde qué altura se apoya uno nuevo

const G = 3400                 // gravedad del chorro, a ojo: la real es demasiado rápida para verse
const MANIJA_CERRADA = -6 * Math.PI / 180
const MANIJA_ABIERTA = 30 * Math.PI / 180

const rExt = (y: number) => R_BOCA + (R_BASE - R_BOCA) * (y - BOCA_Y) / (BASE_Y - BOCA_Y)
const rInt = (y: number) => rExt(Math.max(BOCA_Y, y)) - PARED

// ── Volumen → altura ───────────────────────────────────────────────────────
// El vaso es un cono truncado: el mismo volumen ocupa menos altura arriba,
// donde es más ancho. Llenar "por altura" haría que la cerveza parezca
// acelerar al final. Se tabula una vez y se interpola.
const TABLA: number[] = (() => {
  const vol = (h: number) => {
    const r0 = rInt(FONDO_Y), r1 = rInt(FONDO_Y - h)
    return Math.PI * h * (r0 * r0 + r0 * r1 + r1 * r1) / 3
  }
  const hMax = FONDO_Y - LLENO_Y
  const vMax = vol(hMax)
  const t: number[] = []
  for (let i = 0; i <= 256; i++) {
    const objetivo = (i / 256) * vMax
    let lo = 0, hi = hMax
    for (let k = 0; k < 28; k++) {
      const m = (lo + hi) / 2
      if (vol(m) < objetivo) lo = m; else hi = m
    }
    t.push(lo)
  }
  return t
})()

function alturaDe(fraccion: number): number {
  const f = Math.max(0, Math.min(1, fraccion)) * 256
  const i = Math.floor(f)
  if (i >= 256) return TABLA[256]
  return TABLA[i] + (TABLA[i + 1] - TABLA[i]) * (f - i)
}

// ── Utilidades ─────────────────────────────────────────────────────────────
type Lienzo = { c: HTMLCanvasElement; x: CanvasRenderingContext2D; r: Rect }
type Rect = { x0: number; y0: number; x1: number; y1: number }

/** Números pseudoaleatorios con semilla: las texturas salen iguales en cada
 *  carga y no "tiemblan" al redimensionar. */
function azar(semilla: number) {
  let s = semilla >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const acercar = (actual: number, objetivo: number, tau: number, dt: number) =>
  actual + (objetivo - actual) * (1 - Math.exp(-dt / Math.max(1e-4, tau)))

/** Curva fuerte de salida/entrada para desplazamientos en pantalla. */
const suaveInOut = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

// ── Estado de un vaso ──────────────────────────────────────────────────────
type Burbuja = { x: number; y: number; r: number; vy: number; fase: number; arrastre: number }
type Vaso = {
  clave: string
  /** 0..1 de la entrada (se apoya desde arriba) o de la salida (se lo llevan). */
  t: number
  saliendo: boolean
  nivel: number          // 0..1 del volumen de un vaso
  espuma: number         // alto de la espuma, en unidades
  turbio: number         // 0..1: la nube de microburbujas de cuando se sirve
  limpioY: number        // hasta dónde ya decantó, desde abajo
  frio: number           // 0..1: condensación
  burbujas: Burbuja[]
  semilla: number
}

type Gota = { x: number; y: number; vx: number; vy: number; vida: number; r: number }

export class Motor {
  private escena: HTMLCanvasElement
  private fondo: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private cssW = 0
  private cssH = 0
  private dpr = 1
  /** Transformación del espacio de la escena a píxeles CSS. */
  private esc = 1
  private ox = 0
  private oy = 0

  private entrada: Entrada = { modo: 'exhibicion', ml: 0, vaso: 473, color: '#d9a21b', etiqueta: '', sesion: null }
  private pal: Paleta = paleta('#d9a21b')
  private reducido = false

  // Capas pintadas una vez
  private fija: Lienzo | null = null
  private vidrioAtras: Lienzo | null = null
  private vidrioFrente: Lienzo | null = null
  private rocio: Lienzo | null = null
  private manija: Lienzo | null = null
  private texEspuma: Lienzo | null = null
  private texChorro: Lienzo | null = null
  private texNube: Lienzo | null = null
  private burbuja: HTMLCanvasElement | null = null

  // Medición
  private mlPrevio = 0
  private cambioEn = 0
  private caudal = 0          // ml/s estimados
  private fluyendo = false
  private mlVisual = 0
  private mlContador = 0
  private ultimoContado = -1

  // Animación
  private vasos: Vaso[] = []
  private angulo = MANIJA_CERRADA
  private velAngulo = 0
  private chorro: 'no' | 'bajando' | 'si' | 'cortando' = 'no'
  private cabeza = PICO_Y
  private vCabeza = 0
  private cola = PICO_Y
  private vCola = 0
  private gotas: Gota[] = []
  private salpicadura: Gota[] = []
  private goteosPendientes: number[] = []
  private luz = 0.7
  private reloj = 0
  private ultimo = 0
  private raf = 0
  private sitios: number[] = [-0.42, -0.08, 0.31]
  private proxSitio = [0, 0, 0]
  private semillas = 1
  /** Si la tablet no da abasto, se baja la resolución una vez y listo. */
  private calidad: 'alta' | 'baja' = 'alta'
  private lento = 0
  private alias: { de: string | null; a: string } | null = null

  alContar: ((ml: number) => void) | null = null

  constructor(escena: HTMLCanvasElement, fondo: HTMLCanvasElement) {
    this.escena = escena
    this.fondo = fondo
    this.ctx = escena.getContext('2d')!
  }

  // ── API ──────────────────────────────────────────────────────────────────
  medir(cssW: number, cssH: number, reducido: boolean) {
    if (cssW < 10 || cssH < 10) return
    this.reducido = reducido
    this.cssW = cssW
    this.cssH = cssH
    this.dpr = this.calidad === 'baja' ? 1 : Math.min(2, window.devicePixelRatio || 1)

    // Apaisado: la escena a la izquierda. Vertical: arriba. El panel de texto
    // ocupa el resto, con las mismas proporciones en el CSS (54 % en los dos).
    const apaisado = cssW / cssH > 1.05
    const area: Rect = apaisado
      ? { x0: 0, y0: 0, x1: cssW * 0.54, y1: cssH }
      : { x0: 0, y0: 0, x1: cssW, y1: cssH * 0.54 }
    const aw = area.x1 - area.x0, ah = area.y1 - area.y0
    // La manija abierta sobresale por arriba del espacio de la escena: se le
    // deja aire para que la punta nunca toque el borde de la pantalla.
    const aire = 46
    this.esc = Math.min(aw / S_W, ah / (S_H + aire)) * 0.97
    this.ox = area.x0 + (aw - S_W * this.esc) / 2
    this.oy = area.y0 + aire * this.esc + (ah - (S_H + aire) * this.esc) * 0.62

    this.escena.width = Math.round(cssW * this.dpr)
    this.escena.height = Math.round(cssH * this.dpr)
    this.fondo.width = Math.round(cssW * Math.min(this.dpr, 1.5))
    this.fondo.height = Math.round(cssH * Math.min(this.dpr, 1.5))
    this.pintarFondo()
    this.prepararCapas()
  }

  actualizar(e: Entrada) {
    const ahora = performance.now() / 1000
    // El ticket no trae el id de la sesión, trae cuándo se cerró. Sin esto, al
    // terminar de servir el vaso "cambiaría" y saldría de cuadro: es el mismo.
    if (e.modo === 'servida' && (this.entrada.modo === 'sirviendo' || this.entrada.modo === 'lista') && this.entrada.sesion) {
      this.alias = { de: e.sesion, a: this.entrada.sesion }
    }
    if (this.alias && e.modo === 'servida' && e.sesion === this.alias.de) e = { ...e, sesion: this.alias.a }
    const cambioColor = e.color !== this.entrada.color
    const cambioEtiqueta = e.etiqueta !== this.entrada.etiqueta
    const otraSesion = e.sesion !== this.entrada.sesion

    if (otraSesion || e.ml < this.mlPrevio) {
      // Sesión nueva: la medición arranca de cero, no hay caudal que heredar.
      this.mlPrevio = e.ml
      this.mlVisual = e.ml
      this.mlContador = e.ml
      this.caudal = 0
      this.cambioEn = 0
    } else if (e.ml > this.mlPrevio) {
      const dt = this.cambioEn > 0 ? ahora - this.cambioEn : 0
      if (dt > 0.05 && dt < 4) {
        const r = (e.ml - this.mlPrevio) / dt
        this.caudal = this.caudal > 0 ? this.caudal * 0.5 + r * 0.5 : r
      }
      this.mlPrevio = e.ml
      this.cambioEn = ahora
    }
    this.entrada = e
    if (cambioColor) {
      this.pal = paleta(e.color)
      this.prepararManija()
    } else if (cambioEtiqueta) {
      this.prepararManija()
    }
  }

  iniciar() {
    if (this.raf) return
    this.ultimo = performance.now()
    const paso = (t: number) => {
      this.raf = requestAnimationFrame(paso)
      const ms = t - this.ultimo
      const dt = Math.min(0.05, ms / 1000)
      this.ultimo = t
      if (document.hidden) return
      // Una tablet barata puede no llegar a 60 cuadros con pantalla de alta
      // densidad. Si pasa más de 2 s acumulados por debajo de ~38 cuadros, se
      // dibuja a densidad 1: se ve apenas menos nítido y vuelve a ser fluido.
      // Un líquido que avanza a los tirones se ve peor que uno menos nítido.
      if (this.calidad === 'alta' && this.reloj > 3 && ms < 500) {
        this.lento = ms > 26 ? this.lento + ms / 1000 : Math.max(0, this.lento - ms / 2000)
        if (this.lento > 2) {
          this.calidad = 'baja'
          this.medir(this.cssW, this.cssH, this.reducido)
        }
      }
      this.avanzar(dt)
      this.dibujar()
    }
    this.raf = requestAnimationFrame(paso)
  }

  detener() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  /** La tipografía de la manija llega después: se repinta cuando carga. */
  repintarManija() { this.prepararManija() }

  // ── Simulación ─────────────────────────────────────────────────────────────
  private avanzar(dt: number) {
    this.reloj += dt
    const ahora = performance.now() / 1000
    const e = this.entrada
    const vaso = Math.max(50, e.vaso)

    // ¿Está corriendo cerveza? El ESP32 informa como mucho una vez por segundo
    // y la pantalla consulta cada medio: entre dos cambios pueden pasar casi
    // 2 s aunque la canilla siga abierta. Con un umbral más corto el chorro
    // parpadearía. 2,4 s es menos que los 3 s que espera el propio ESP32 para
    // dar la tirada por cortada.
    this.fluyendo = e.modo === 'sirviendo' && this.cambioEn > 0 && ahora - this.cambioEn < 2.4

    // El vaso puede ir un poco adelante de la medición (es solo dibujo); el
    // contador de plata, nunca: muestra lo medido, suavizado.
    const prediccion = this.fluyendo
      ? e.ml + this.caudal * Math.min(1.1, ahora - this.cambioEn)
      : e.ml
    this.mlVisual = Math.max(this.mlVisual, acercar(this.mlVisual, prediccion, 0.22, dt))
    if (!this.fluyendo && this.mlVisual > e.ml + 0.5) this.mlVisual = acercar(this.mlVisual, e.ml, 0.4, dt)
    this.mlContador = Math.min(e.ml, acercar(this.mlContador, e.ml, 0.3, dt))
    const contado = Math.round(this.mlContador)
    if (contado !== this.ultimoContado) {
      this.ultimoContado = contado
      this.alContar?.(contado)
    }

    // ── Qué vaso corresponde mostrar ──────────────────────────────────────
    let clave: string
    let objetivo: number
    if (e.modo === 'exhibicion') {
      clave = 'muestra'; objetivo = 1
    } else if (e.modo === 'apagada') {
      clave = 'vacio'; objetivo = 0
    } else {
      // QUÉ vaso es lo decide lo medido; CUÁNTO se ve lleno, lo dibujado. Si lo
      // decidiera la predicción, un vaso de 473 ml podría "pasarse" a los 458
      // y el cliente vería entrar un vaso nuevo que nunca sirvió.
      const medido = e.modo === 'lista' ? 0 : e.ml
      // Al llegar justo a un vaso entero se queda en el lleno; el nuevo entra
      // recién cuando se pasa.
      const indice = medido > 0 ? Math.ceil(medido / vaso - 1e-6) - 1 : 0
      const visto = Math.min((indice + 1) * vaso, Math.max(indice * vaso, e.modo === 'lista' ? 0 : this.mlVisual))
      clave = `s:${e.sesion ?? '-'}:${indice}`
      objetivo = medido > 0 ? (visto - indice * vaso) / vaso : 0
    }

    let activo = this.vasos.find(v => !v.saliendo)
    // Un vaso vacío no se cambia por otro vacío: se usa el que está. Así, si la
    // pantalla arranca a mitad de una tirada, el vaso de la canilla es el que
    // se llena, en vez de irse y volver uno nuevo.
    if (activo && activo.clave !== clave && activo.nivel < 0.004 && clave !== 'muestra' && activo.clave !== 'muestra') {
      activo.clave = clave
    }
    if (!activo || activo.clave !== clave) {
      if (activo) { activo.saliendo = true; activo.t = 0 }
      const muestra = clave === 'muestra'
      // Un vaso que aparece ya con cerveza (la pantalla se prendió a mitad de
      // una tirada) tiene que tener su espuma y su frío: nunca hay cerveza
      // servida sin corona.
      const inicial = muestra ? 1 : Math.max(0, Math.min(1, objetivo))
      const conAlgo = inicial > 0.02
      activo = {
        clave, nivel: inicial, espuma: muestra ? 50 : conAlgo ? Math.min(54, 5 + alturaDe(inicial) * 0.3) : 0,
        turbio: 0, limpioY: FONDO_Y, frio: conAlgo ? 1 : 0, burbujas: [],
        t: this.vasos.length ? 0 : 1, saliendo: false, semilla: this.semillas++,
      }
      this.vasos.push(activo)
    }

    for (const v of this.vasos) {
      v.t = Math.min(1, v.t + dt / (v.saliendo ? 0.6 : 0.7))
      const esActivo = v === activo
      if (esActivo) {
        // En vivo el nivel ya viene suavizado; fuera de una tirada se acerca solo.
        v.nivel = e.modo === 'sirviendo' ? Math.min(1, objetivo) : acercar(v.nivel, objetivo, 0.6, dt)
      }
      this.avanzarVaso(v, dt, esActivo && this.fluyendo && this.chorro === 'si')
    }
    this.vasos = this.vasos.filter(v => !(v.saliendo && v.t >= 1))

    // ── La manija: un resorte, no una interpolación ───────────────────────
    const meta = this.fluyendo ? MANIJA_ABIERTA : MANIJA_CERRADA
    if (this.reducido) {
      this.angulo = meta
    } else {
      const fuerza = -140 * (this.angulo - meta) - 19 * this.velAngulo
      this.velAngulo += fuerza * dt
      this.angulo += this.velAngulo * dt
    }

    // ── El chorro ─────────────────────────────────────────────────────────
    const impacto = this.impactoY(activo)
    if (this.fluyendo && (this.chorro === 'no' || this.chorro === 'cortando')) {
      this.chorro = 'bajando'
      this.cabeza = PICO_Y; this.vCabeza = 160
      this.cola = PICO_Y; this.vCola = 0
    }
    if (!this.fluyendo && (this.chorro === 'si' || this.chorro === 'bajando')) {
      this.chorro = 'cortando'
      this.vCola = 120
      this.goteosPendientes = [0.35, 0.95, 1.9]
    }
    if (this.chorro === 'bajando') {
      this.vCabeza += G * dt
      this.cabeza += this.vCabeza * dt
      if (this.cabeza >= impacto) { this.cabeza = impacto; this.chorro = 'si' }
    } else if (this.chorro === 'si') {
      this.cabeza = impacto
    } else if (this.chorro === 'cortando') {
      this.cabeza = Math.max(this.cabeza, impacto)
      this.vCola += G * dt
      this.cola += this.vCola * dt
      if (this.cola >= this.cabeza) { this.chorro = 'no'; this.cola = PICO_Y }
    }

    // Goteo de la canilla después de cerrar: tres gotas y basta.
    if (this.goteosPendientes.length) {
      this.goteosPendientes = this.goteosPendientes.map(t => t - dt)
      while (this.goteosPendientes.length && this.goteosPendientes[0] <= 0) {
        this.goteosPendientes.shift()
        this.gotas.push({ x: GX, y: PICO_Y + 2, vx: 0, vy: 30, vida: 2, r: 3.2 })
      }
    }
    for (const g of this.gotas) {
      g.vy += G * 0.6 * dt
      g.y += g.vy * dt
      g.vida -= dt
    }
    this.gotas = this.gotas.filter(g => g.vida > 0 && g.y < impacto)

    // Salpicaduras donde el chorro pega
    if (this.chorro === 'si' && !this.reducido) {
      const n = Math.random() < dt * 36 ? 1 : 0
      for (let i = 0; i < n; i++) {
        this.salpicadura.push({
          x: GX + (Math.random() - 0.5) * 10, y: impacto - 2,
          vx: (Math.random() - 0.5) * 170, vy: -110 - Math.random() * 190,
          vida: 0.35 + Math.random() * 0.25, r: 0.8 + Math.random() * 1.6,
        })
      }
    }
    for (const g of this.salpicadura) {
      g.vy += 1700 * dt
      g.x += g.vx * dt
      g.y += g.vy * dt
      g.vida -= dt
    }
    this.salpicadura = this.salpicadura.filter(g => g.vida > 0)

    // La luz sobre la canilla sube cuando es el turno de alguien.
    const metaLuz = e.modo === 'lista' || e.modo === 'sirviendo' ? 1 : e.modo === 'apagada' ? 0.25 : 0.7
    this.luz = acercar(this.luz, metaLuz, 0.5, dt)
  }

  private avanzarVaso(v: Vaso, dt: number, recibe: boolean) {
    const altoLiq = alturaDe(v.nivel)
    const sup = FONDO_Y - altoLiq

    // Espuma: crece rápido mientras recibe chorro y se asienta despacio.
    const metaEspuma = v.nivel < 0.004 ? 0 : Math.min(54, 5 + altoLiq * 0.36)
    if (recibe) v.espuma = acercar(v.espuma, metaEspuma, 0.45, dt)
    else {
      // Se asienta despacio, pero una cerveza servida nunca se queda pelada.
      const meta = Math.max(metaEspuma * 0.55, Math.min(v.espuma, metaEspuma * 0.82))
      v.espuma = acercar(v.espuma, meta, v.espuma < meta ? 1.2 : 14, dt)
    }
    if (v.nivel < 0.004) v.espuma = acercar(v.espuma, 0, 0.3, dt)

    // La nube de microburbujas: aparece con el chorro y decanta de abajo hacia
    // arriba cuando se corta. Es lo primero que delata a una cerveza dibujada:
    // la de verdad nunca está quieta y transparente mientras se sirve.
    if (recibe) {
      v.turbio = acercar(v.turbio, 1, 0.35, dt)
      v.limpioY = FONDO_Y
    } else if (v.turbio > 0.001) {
      v.limpioY -= ((FONDO_Y - sup) / 2.6 + 8) * dt
      if (v.limpioY <= sup) v.turbio = acercar(v.turbio, 0, 0.5, dt)
    }

    if (v.nivel > 0.02) v.frio = Math.min(1, v.frio + dt / 7)

    // ── Burbujas ──────────────────────────────────────────────────────────
    if (altoLiq > 6) {
      const rnd = Math.random
      const mult = this.reducido ? 0.4 : 1
      // Sitios de nucleación: hilos finos que salen siempre del mismo punto del
      // fondo. Es el detalle que hace que el ojo crea que es gas de verdad.
      for (let i = 0; i < this.sitios.length; i++) {
        this.proxSitio[i] -= dt
        if (this.proxSitio[i] <= 0) {
          this.proxSitio[i] = (0.07 + rnd() * 0.06) / mult
          v.burbujas.push({ x: this.sitios[i] + (rnd() - 0.5) * 0.02, y: FONDO_Y - 3, r: 0.7 + rnd() * 0.5, vy: 0, fase: rnd() * 6, arrastre: 0 })
        }
      }
      // Sueltas, por todo el volumen
      const sueltas = (14 + altoLiq * 0.09) * mult * dt
      for (let k = 0; k < Math.floor(sueltas) + (rnd() < sueltas % 1 ? 1 : 0); k++) {
        v.burbujas.push({ x: (rnd() * 2 - 1) * 0.86, y: FONDO_Y - rnd() * altoLiq * 0.9, r: 0.6 + rnd() * 1.5, vy: 0, fase: rnd() * 6, arrastre: 0 })
      }
      // Arrastradas por el chorro: bajan primero y después suben.
      if (recibe) {
        const n = 240 * mult * dt
        for (let k = 0; k < Math.floor(n) + (rnd() < n % 1 ? 1 : 0); k++) {
          v.burbujas.push({ x: (rnd() - 0.5) * 0.5, y: sup + 4 + rnd() * 18, r: 0.5 + rnd() * 1.4, vy: 0, fase: rnd() * 6, arrastre: 70 + rnd() * 160 })
        }
      }
    }
    const tope = this.reducido || this.calidad === 'baja' ? 240 : 520
    if (v.burbujas.length > tope) v.burbujas.splice(0, v.burbujas.length - tope)
    for (const b of v.burbujas) {
      // Suben más rápido a medida que suben: crecen al bajar la presión.
      b.r += dt * 0.12
      const sube = 38 + b.r * 34
      b.arrastre = Math.max(0, b.arrastre - dt * 420)
      b.vy = -sube + b.arrastre
      b.y += b.vy * dt
      b.fase += dt * 3
      b.x += Math.sin(b.fase) * 0.0016
    }
    v.burbujas = v.burbujas.filter(b => b.y > sup + 1 && b.y <= FONDO_Y)
  }

  private impactoY(v: Vaso | undefined): number {
    if (!v || v.t < 0.8) return BANDEJA.arriba
    const sup = FONDO_Y - alturaDe(v.nivel)
    const arriba = sup - v.espuma
    return v.nivel < 0.004 ? FONDO_Y - 2 : arriba
  }

  // ── Dibujo por cuadro ──────────────────────────────────────────────────────
  private dibujar() {
    const c = this.ctx
    const d = this.dpr
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, this.escena.width, this.escena.height)
    c.setTransform(this.esc * d, 0, 0, this.esc * d, this.ox * d, this.oy * d)

    // Luz de escenario: sube cuando es tu turno. Es la única "señal" que no es
    // un objeto de la barra, y aun así es una luz, no un cartel.
    const lg = c.createRadialGradient(GX, 520, 40, GX, 520, 520)
    lg.addColorStop(0, `rgba(255,214,160,${0.12 * this.luz})`)
    lg.addColorStop(1, 'rgba(255,214,160,0)')
    c.fillStyle = lg
    c.fillRect(-200, 0, S_W + 400, S_H)

    if (this.fija) this.copiar(this.fija)
    this.dibujarManija()

    const activo = this.vasos.find(v => !v.saliendo)
    // Cada vaso se dibuja en dos pasadas (lo de adentro y el vidrio de
    // adelante) para que el chorro, que no se mueve con el vaso, quede entre
    // las dos: adelante de la cerveza y detrás del vidrio.
    for (const v of this.vasos) { this.conVaso(v, () => this.dibujarVasoAdentro(v, v === activo)) }
    if (this.chorro !== 'no') this.dibujarChorro()
    for (const v of this.vasos) { this.conVaso(v, () => this.dibujarVasoAfuera(v)) }

    // Gotas del pico y salpicaduras, por encima de todo
    for (const g of this.gotas) this.gotaDe(g.x, g.y, g.r)
    for (const g of this.salpicadura) {
      c.globalAlpha = Math.min(1, g.vida * 3)
      c.fillStyle = css(this.pal.brillo, 0.85)
      c.beginPath(); c.arc(g.x, g.y, g.r, 0, Math.PI * 2); c.fill()
    }
    c.globalAlpha = 1
  }

  private copiar(l: Lienzo) {
    this.ctx.drawImage(l.c, l.r.x0, l.r.y0, l.r.x1 - l.r.x0, l.r.y1 - l.r.y0)
  }

  private dibujarManija() {
    if (!this.manija) return
    const c = this.ctx
    const r = this.manija.r
    c.save()
    c.translate(PIVOTE.x, PIVOTE.y)
    c.rotate(this.angulo)
    c.drawImage(this.manija.c, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0)
    c.restore()
  }

  /** Ubica un vaso que entra (se apoya desde arriba) o sale (se lo llevan
   *  hacia el cliente). Sale hacia adelante y no hacia la torre: un vaso que
   *  atraviesa la torre es lo primero que rompe la ilusión. */
  private conVaso(v: Vaso, pintar: () => void) {
    const c = this.ctx
    c.save()
    if (v.saliendo) {
      const k = suaveInOut(v.t)
      if (!this.reducido) c.translate(SALIDA * k, -10 * Math.sin(Math.PI * k))
      c.globalAlpha = 1 - k
    } else if (v.t < 1) {
      const k = 1 - Math.pow(1 - v.t, 3)
      if (!this.reducido) c.translate(0, -BAJADA * (1 - k))
      c.globalAlpha = Math.min(1, v.t * 1.6)
    }
    pintar()
    c.restore()
  }

  private dibujarVasoAdentro(v: Vaso, activo: boolean) {
    const c = this.ctx
    const p = this.pal
    const altoLiq = alturaDe(v.nivel)
    const sup = FONDO_Y - altoLiq
    const hayLiquido = v.nivel > 0.004

    // Reflejo ámbar en la bandeja: la luz que atraviesa la cerveza.
    if (hayLiquido) {
      const a = Math.min(1, v.nivel * 3)
      const g = c.createRadialGradient(GX, BANDEJA.arriba + 6, 10, GX, BANDEJA.arriba + 6, 150)
      g.addColorStop(0, css(p.luz, 0.34 * a))
      g.addColorStop(1, css(p.luz, 0))
      c.fillStyle = g
      c.beginPath(); c.ellipse(GX, BANDEJA.arriba + 6, 150, 16, 0, 0, Math.PI * 2); c.fill()
    }

    if (this.vidrioAtras) this.copiar(this.vidrioAtras)

    c.save()
    this.caminoInterior(c)
    c.clip()

    if (hayLiquido) {
      this.dibujarLiquido(sup, v)
      this.dibujarBurbujas(v, sup)
    }
    if (v.espuma > 0.6 && hayLiquido) this.dibujarEspuma(v, sup, activo)
    c.restore()
  }

  private dibujarVasoAfuera(v: Vaso) {
    const c = this.ctx
    const p = this.pal
    const sup = FONDO_Y - alturaDe(v.nivel)
    const hayLiquido = v.nivel > 0.004

    // Rocío: solo donde hay cerveza fría del otro lado del vidrio.
    if (this.rocio && v.frio > 0.01 && hayLiquido) {
      c.save()
      c.beginPath()
      c.rect(GX - 140, sup - v.espuma * 0.6, 280, BASE_Y - sup + 30)
      c.clip()
      c.globalAlpha *= v.frio
      this.copiar(this.rocio)
      c.restore()
    }

    // La base gruesa refracta el color de lo que tiene arriba.
    if (hayLiquido) {
      c.save()
      c.beginPath()
      c.ellipse(GX, FONDO_Y, rInt(FONDO_Y), rInt(FONDO_Y) * K, 0, 0, Math.PI)
      c.lineTo(GX - R_BASE, BASE_Y)
      c.ellipse(GX, BASE_Y, R_BASE, R_BASE * K, 0, Math.PI, 0, true)
      c.closePath()
      c.fillStyle = css(p.luz, 0.28 * Math.min(1, v.nivel * 4))
      c.fill()
      c.restore()
    }

    if (this.vidrioFrente) this.copiar(this.vidrioFrente)
  }

  private dibujarLiquido(sup: number, v: Vaso) {
    const c = this.ctx
    const p = this.pal
    const r = rInt(sup)
    const rFondo = rInt(FONDO_Y)

    // Cuerpo: más oscuro en los bordes, más claro en el centro. Es una lente:
    // un cilindro de líquido concentra la luz en el medio.
    const h = c.createLinearGradient(GX - r, 0, GX + r, 0)
    h.addColorStop(0, css(p.hondo))
    h.addColorStop(0.09, css(mezclar(p.hondo, p.base, 0.55)))
    h.addColorStop(0.26, css(p.base))
    h.addColorStop(0.44, css(p.luz))
    h.addColorStop(0.6, css(mezclar(p.luz, p.base, 0.5)))
    h.addColorStop(0.8, css(p.base))
    h.addColorStop(0.93, css(mezclar(p.base, p.hondo, 0.6)))
    h.addColorStop(1, css(p.hondo))
    c.fillStyle = h
    c.beginPath()
    c.ellipse(GX, sup, r, r * K, 0, Math.PI, 0)
    c.lineTo(GX + rFondo + 2, FONDO_Y)
    c.ellipse(GX, FONDO_Y, rFondo, rFondo * K, 0, 0, Math.PI)
    c.closePath()
    c.fill()

    // Contraluz: un halo cálido en la mitad baja, donde la luz rebota en la base.
    const halo = c.createRadialGradient(GX - r * 0.15, FONDO_Y - (FONDO_Y - sup) * 0.35, 4, GX, FONDO_Y - (FONDO_Y - sup) * 0.35, Math.max(60, (FONDO_Y - sup) * 0.8))
    halo.addColorStop(0, css(p.brillo, 0.26))
    halo.addColorStop(1, css(p.brillo, 0))
    c.fillStyle = halo
    c.fillRect(GX - r - 4, sup - 10, r * 2 + 8, FONDO_Y - sup + 20)

    // Hacia arriba, bajo la espuma, la cerveza se oscurece apenas.
    const sombra = c.createLinearGradient(0, sup, 0, sup + 70)
    sombra.addColorStop(0, css(p.hondo, 0.28))
    sombra.addColorStop(1, css(p.hondo, 0))
    c.fillStyle = sombra
    c.fillRect(GX - r - 4, sup, r * 2 + 8, 70)

    // Superficie (si no la tapa la espuma): una elipse que refleja.
    if (v.espuma < 3) {
      c.fillStyle = css(mezclar(p.luz, [255, 255, 255], 0.25), 0.9)
      c.beginPath(); c.ellipse(GX, sup, r, r * K, 0, 0, Math.PI * 2); c.fill()
    }

    // La nube de cuando se sirve, con el frente de decantación subiendo.
    if (v.turbio > 0.01) {
      const desde = Math.max(sup, v.limpioY)
      if (desde > sup + 1) {
        const n = c.createLinearGradient(0, desde, 0, sup)
        n.addColorStop(0, css(p.brillo, 0))
        n.addColorStop(0.18, css(mezclar(p.brillo, [255, 250, 238], 0.35), 0.13 * v.turbio))
        n.addColorStop(1, css(mezclar(p.brillo, [255, 250, 238], 0.5), 0.26 * v.turbio))
        c.fillStyle = n
        c.fillRect(GX - r - 4, sup - 8, r * 2 + 8, desde - sup + 8)
        if (this.texNube && !this.reducido) {
          c.save()
          c.globalAlpha *= 0.42 * v.turbio
          const desliz = (this.reloj * 46) % 100
          this.tejer(this.texNube, GX - r, sup - 8, r * 2, desde - sup + 8, 0, desliz)
          c.restore()
        }
      }
    }

    // Borde interno del vidrio sobre la cerveza: una línea oscura y otra clara.
    c.strokeStyle = 'rgba(0,0,0,0.28)'
    c.lineWidth = 2.2
    c.beginPath()
    c.moveTo(GX - r + 1, sup); c.lineTo(GX - rFondo + 1, FONDO_Y)
    c.moveTo(GX + r - 1, sup); c.lineTo(GX + rFondo - 1, FONDO_Y)
    c.stroke()
  }

  private dibujarBurbujas(v: Vaso, sup: number) {
    if (!this.burbuja) return
    const c = this.ctx
    for (const b of v.burbujas) {
      if (b.y < sup + 1) continue
      const x = GX + b.x * rInt(b.y)
      const s = b.r * 2.1
      c.globalAlpha = Math.min(1, (b.y - sup) / 16) * (0.3 + this.pal.luminosidad * 0.7)
      c.drawImage(this.burbuja, x - s / 2, b.y - s / 2, s, s)
    }
    c.globalAlpha = 1
  }

  private dibujarEspuma(v: Vaso, sup: number, activo: boolean) {
    const c = this.ctx
    const p = this.pal
    const arriba = sup - v.espuma
    const rArriba = rInt(arriba)
    const rSup = rInt(sup)
    // Arriba de la boca la espuma forma una corona: un poco más angosta que la
    // boca, sostenida por la tensión superficial.
    const corona = Math.max(0, BOCA_Y - arriba)
    const rTope = corona > 0 ? rInt(BOCA_Y) - corona * 0.35 : rArriba

    // El recorte que viene de afuera sigue la pared y se estira 80 unidades
    // por encima de la boca: la corona entra en eso.
    c.save()
    const cuerpo = c.createLinearGradient(0, arriba, 0, sup + 6)
    cuerpo.addColorStop(0, css(p.espuma))
    cuerpo.addColorStop(0.62, css(mezclar(p.espuma, p.espumaBaja, 0.45)))
    cuerpo.addColorStop(1, css(p.espumaBaja))
    c.fillStyle = cuerpo
    c.beginPath()
    c.ellipse(GX, arriba, rTope, rTope * K, 0, Math.PI, 0)
    if (corona > 0) {
      c.lineTo(GX + rInt(BOCA_Y), BOCA_Y)
    }
    c.lineTo(GX + rSup, sup)
    c.ellipse(GX, sup, rSup, rSup * K, 0, 0, Math.PI)
    if (corona > 0) c.lineTo(GX - rInt(BOCA_Y), BOCA_Y)
    c.closePath()
    c.fill()

    // Sombra de cilindro sobre la espuma: más oscura en los costados.
    const lado = c.createLinearGradient(GX - rSup, 0, GX + rSup, 0)
    lado.addColorStop(0, 'rgba(70,52,30,0.30)')
    lado.addColorStop(0.3, 'rgba(70,52,30,0)')
    lado.addColorStop(0.75, 'rgba(70,52,30,0)')
    lado.addColorStop(1, 'rgba(70,52,30,0.36)')
    c.fillStyle = lado
    c.fill()

    // Textura de burbujitas
    if (this.texEspuma) {
      c.save()
      c.clip()
      c.globalAlpha *= 0.95
      const deriva = this.reducido ? 0 : (this.reloj * (v.turbio > 0.5 ? 9 : 1.2)) % 120
      this.tejer(this.texEspuma, GX - rSup - 6, arriba - rTope * K - 4, rSup * 2 + 12, sup - arriba + rTope * K + 14, 0, -deriva)
      c.restore()
    }

    // Donde la espuma se apoya en la cerveza: una franja de burbujas grandes.
    const borde = c.createLinearGradient(0, sup - 16, 0, sup + rSup * K)
    borde.addColorStop(0, css(p.espumaBaja, 0))
    borde.addColorStop(0.55, css(mezclar(p.espumaBaja, p.base, 0.4), 0.6))
    borde.addColorStop(1, css(mezclar(p.espumaBaja, p.base, 0.7), 0.25))
    c.fillStyle = borde
    c.beginPath()
    c.rect(GX - rSup - 4, sup - 16, rSup * 2 + 8, 16)
    c.ellipse(GX, sup, rSup, rSup * K, 0, Math.PI, 0, true)
    c.fill()

    // La cara de arriba, iluminada desde arriba: lo más claro de toda la escena.
    const tapa = c.createRadialGradient(GX - rTope * 0.25, arriba - rTope * K * 0.4, 4, GX, arriba, rTope * 1.05)
    tapa.addColorStop(0, 'rgba(255,255,253,1)')
    tapa.addColorStop(0.7, css(p.espuma))
    tapa.addColorStop(1, css(mezclar(p.espuma, p.espumaBaja, 0.5)))
    c.fillStyle = tapa
    c.beginPath()
    c.ellipse(GX, arriba, rTope, rTope * K, 0, 0, Math.PI * 2)
    c.fill()
    // Bordes irregulares: la espuma no termina en una elipse perfecta. Pocos
    // bultos, grandes y del mismo tono: muchos chiquitos se leen como perlas.
    const rnd = azar(v.semilla * 977)
    c.fillStyle = css(mezclar(p.espuma, [255, 255, 255], 0.5), 0.9)
    for (let i = 0; i < 13; i++) {
      const a = Math.PI + ((i + 0.5 + (rnd() - 0.5) * 0.6) / 13) * Math.PI
      const bx = GX + Math.cos(a) * rTope * 0.93
      const by = arriba + Math.sin(a) * rTope * K * 0.9
      c.beginPath(); c.ellipse(bx, by, 4 + rnd() * 5, 2.4 + rnd() * 2.4, 0, 0, Math.PI * 2); c.fill()
    }
    if (this.texEspuma) {
      c.save()
      c.beginPath(); c.ellipse(GX, arriba, rTope, rTope * K, 0, 0, Math.PI * 2); c.clip()
      c.globalAlpha *= 0.35
      this.tejer(this.texEspuma, GX - rTope, arriba - rTope * K, rTope * 2, rTope * K * 2, 0, 0)
      c.restore()
    }

    // Donde pega el chorro, la espuma se revuelve.
    if (this.chorro === 'si' && activo) {
      const titila = 0.75 + Math.sin(this.reloj * 31) * 0.12 + Math.sin(this.reloj * 13) * 0.1
      const rev = c.createRadialGradient(GX, arriba, 2, GX, arriba, 30)
      rev.addColorStop(0, `rgba(255,255,255,${0.95 * titila})`)
      rev.addColorStop(0.5, css(p.espuma, 0.6 * titila))
      rev.addColorStop(1, css(p.espuma, 0))
      c.fillStyle = rev
      c.beginPath(); c.ellipse(GX, arriba, 30, 30 * K * 2.2, 0, 0, Math.PI * 2); c.fill()
    }
    c.restore()
  }

  private dibujarChorro() {
    const c = this.ctx
    const p = this.pal
    const y0 = this.chorro === 'cortando' ? this.cola : PICO_Y - 1
    const y1 = this.cabeza
    if (y1 - y0 < 1) return

    // Se angosta al caer: el mismo caudal acelera y pasa por menos sección.
    // v(y) = √(v0² + 2·g·Δy); ancho ∝ 1/√v.
    const v0 = 120
    const ancho = (y: number) => {
      const v = Math.sqrt(v0 * v0 + 2 * G * Math.max(0, y - PICO_Y))
      return 21 * Math.sqrt(v0 / v) + 4.5
    }
    const ondula = (y: number) => this.reducido ? 0 :
      Math.sin(this.reloj * 11 + y * 0.07) * 0.9 * Math.min(1, (y - PICO_Y) / 60)

    const pasos = 18
    const izq: [number, number][] = []
    const der: [number, number][] = []
    for (let i = 0; i <= pasos; i++) {
      const y = y0 + (y1 - y0) * (i / pasos)
      const w = ancho(y) / 2
      const x = GX + ondula(y)
      izq.push([x - w, y]); der.push([x + w, y])
    }
    c.save()
    c.beginPath()
    c.moveTo(izq[0][0], izq[0][1])
    for (const [x, y] of izq) c.lineTo(x, y)
    for (let i = der.length - 1; i >= 0; i--) c.lineTo(der[i][0], der[i][1])
    c.closePath()

    const wTop = ancho(y0) / 2
    const g = c.createLinearGradient(GX - wTop, 0, GX + wTop, 0)
    g.addColorStop(0, css(p.hondo, 0.85))
    g.addColorStop(0.28, css(p.luz, 0.92))
    g.addColorStop(0.36, css(mezclar(p.brillo, [255, 255, 255], 0.55), 0.95))
    g.addColorStop(0.5, css(p.luz, 0.9))
    g.addColorStop(0.82, css(p.base, 0.88))
    g.addColorStop(1, css(p.hondo, 0.8))
    c.fillStyle = g
    c.fill()

    // Las vetas que corren hacia abajo: es lo que hace que se lea como
    // líquido en movimiento y no como una barra de color.
    if (this.texChorro && !this.reducido) {
      c.clip()
      c.globalAlpha = 0.5
      c.globalCompositeOperation = 'lighter'
      const corre = (this.reloj * 900) % 200
      this.tejer(this.texChorro, GX - 12, y0, 24, y1 - y0, 0, corre)
      c.globalCompositeOperation = 'source-over'
      c.globalAlpha = 1
    }
    c.restore()
  }

  private gotaDe(x: number, y: number, r: number) {
    const c = this.ctx
    const p = this.pal
    const g = c.createRadialGradient(x - r * 0.3, y - r * 0.4, 0.2, x, y, r * 1.3)
    g.addColorStop(0, css(mezclar(p.brillo, [255, 255, 255], 0.6)))
    g.addColorStop(0.5, css(p.luz, 0.95))
    g.addColorStop(1, css(p.hondo, 0.9))
    c.fillStyle = g
    c.beginPath()
    c.moveTo(x, y - r * 2)
    c.quadraticCurveTo(x + r, y - r * 0.4, x + r, y)
    c.arc(x, y, r, 0, Math.PI)
    c.quadraticCurveTo(x - r, y - r * 0.4, x, y - r * 2)
    c.fill()
  }

  /** Repite una textura en un rectángulo, con desplazamiento. */
  private tejer(t: Lienzo, x: number, y: number, w: number, h: number, dx: number, dy: number) {
    const c = this.ctx
    const tw = t.r.x1 - t.r.x0, th = t.r.y1 - t.r.y0
    const sx = ((dx % tw) + tw) % tw, sy = ((dy % th) + th) % th
    for (let yy = y - th + sy; yy < y + h; yy += th) {
      for (let xx = x - tw + sx; xx < x + w; xx += tw) {
        c.drawImage(t.c, xx, yy, tw, th)
      }
    }
  }

  private caminoInterior(c: CanvasRenderingContext2D) {
    const rb = rInt(FONDO_Y), rt = rInt(BOCA_Y)
    c.beginPath()
    c.moveTo(GX - rt, BOCA_Y - 80)
    c.lineTo(GX - rt, BOCA_Y)
    c.lineTo(GX - rb, FONDO_Y)
    c.ellipse(GX, FONDO_Y, rb, rb * K, 0, Math.PI, 0, true)
    c.lineTo(GX + rt, BOCA_Y)
    c.lineTo(GX + rt, BOCA_Y - 80)
    c.closePath()
  }

  private caminoExterior(c: CanvasRenderingContext2D) {
    c.beginPath()
    c.moveTo(GX - R_BOCA, BOCA_Y)
    c.lineTo(GX - R_BASE, BASE_Y)
    c.ellipse(GX, BASE_Y, R_BASE, R_BASE * K, 0, Math.PI, 0, true)
    c.lineTo(GX + R_BOCA, BOCA_Y)
    c.ellipse(GX, BOCA_Y, R_BOCA, R_BOCA * K, 0, 0, Math.PI, true)
    c.closePath()
  }

  // ── Capas que se pintan una sola vez ───────────────────────────────────────
  private lienzo(r: Rect): Lienzo {
    const c = document.createElement('canvas')
    const s = this.esc * this.dpr
    c.width = Math.max(1, Math.ceil((r.x1 - r.x0) * s))
    c.height = Math.max(1, Math.ceil((r.y1 - r.y0) * s))
    const x = c.getContext('2d')!
    x.setTransform(c.width / (r.x1 - r.x0), 0, 0, c.height / (r.y1 - r.y0), -r.x0 * c.width / (r.x1 - r.x0), -r.y0 * c.height / (r.y1 - r.y0))
    return { c, x, r }
  }

  private prepararCapas() {
    this.prepararFija()
    this.prepararVidrio()
    this.prepararManija()
    this.prepararTexturas()
  }

  private cromo(c: CanvasRenderingContext2D, a: number, b: number, vertical: boolean, oscuro = 0) {
    // Un cromo es un espejo: lo que se ve son bandas del entorno, no un
    // degradado suave. Luz principal arriba a la izquierda, un rebote cálido de
    // las luces de la barra y bordes que caen a negro.
    const g = vertical ? c.createLinearGradient(0, a, 0, b) : c.createLinearGradient(a, 0, b, 0)
    const k = (v: number) => Math.round(v * (1 - oscuro))
    const st: [number, string][] = [
      [0, `rgb(${k(28)},${k(33)},${k(38)})`],
      [0.07, `rgb(${k(96)},${k(104)},${k(111)})`],
      [0.17, `rgb(${k(236)},${k(240)},${k(243)})`],
      [0.24, `rgb(${k(250)},${k(251)},${k(252)})`],
      [0.31, `rgb(${k(170)},${k(178)},${k(184)})`],
      [0.46, `rgb(${k(62)},${k(69)},${k(75)})`],
      [0.58, `rgb(${k(30)},${k(34)},${k(38)})`],
      [0.7, `rgb(${k(92)},${k(84)},${k(76)})`],
      [0.8, `rgb(${k(214)},${k(190)},${k(156)})`],
      [0.87, `rgb(${k(150)},${k(150)},${k(150)})`],
      [1, `rgb(${k(24)},${k(28)},${k(32)})`],
    ]
    for (const [o, col] of st) g.addColorStop(o, col)
    return g
  }

  private prepararFija() {
    const L = this.lienzo({ x0: -40, y0: 0, x1: S_W + 40, y1: S_H })
    const c = L.x

    // Sombra de la torre y la bandeja sobre el mostrador
    const sombra = (x: number, w: number) => {
      const g = c.createRadialGradient(x, MOSTRADOR_Y + 2, 4, x, MOSTRADOR_Y + 2, w)
      g.addColorStop(0, 'rgba(0,0,0,0.55)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      c.fillStyle = g
      c.beginPath(); c.ellipse(x, MOSTRADOR_Y + 2, w, w * 0.12, 0, 0, Math.PI * 2); c.fill()
    }
    sombra(75, 110)
    sombra(GX, 200)

    // ── Torre ──────────────────────────────────────────────────────────────
    const tx0 = 34, tx1 = 116
    c.fillStyle = this.cromo(c, tx0, tx1, false)
    c.fillRect(tx0, 176, tx1 - tx0, MOSTRADOR_Y - 16 - 176)
    // Más abajo llega menos luz
    const baja = c.createLinearGradient(0, 300, 0, MOSTRADOR_Y)
    baja.addColorStop(0, 'rgba(0,0,0,0)')
    baja.addColorStop(1, 'rgba(0,0,0,0.5)')
    c.fillStyle = baja
    c.fillRect(tx0, 300, tx1 - tx0, MOSTRADOR_Y - 300)
    // Capuchón
    c.fillStyle = this.cromo(c, tx0 - 4, tx1 + 4, false)
    c.beginPath()
    c.moveTo(tx0 - 4, 182)
    c.lineTo(tx0 - 4, 168)
    c.quadraticCurveTo(tx0 - 4, 132, (tx0 + tx1) / 2, 128)
    c.quadraticCurveTo(tx1 + 4, 132, tx1 + 4, 168)
    c.lineTo(tx1 + 4, 182)
    c.closePath()
    c.fill()
    c.fillStyle = 'rgba(0,0,0,0.35)'
    c.fillRect(tx0 - 4, 182, tx1 - tx0 + 8, 3)
    // Base
    c.fillStyle = this.cromo(c, tx0 - 22, tx1 + 22, false)
    c.beginPath()
    c.moveTo(tx0 - 6, MOSTRADOR_Y - 20)
    c.lineTo(tx1 + 6, MOSTRADOR_Y - 20)
    c.lineTo(tx1 + 22, MOSTRADOR_Y - 4)
    c.lineTo(tx0 - 22, MOSTRADOR_Y - 4)
    c.closePath()
    c.fill()
    c.fillStyle = this.cromo(c, tx0 - 24, tx1 + 24, false, 0.25)
    c.beginPath(); c.ellipse(75, MOSTRADOR_Y - 4, 65, 7, 0, 0, Math.PI * 2); c.fill()

    // ── Cuerpo de la canilla, de perfil ────────────────────────────────────
    const cy = 270
    // Acople a la torre
    c.fillStyle = this.cromo(c, cy - 18, cy + 18, true)
    c.fillRect(tx1 - 2, cy - 18, 40, 36)
    // Tuerca: caras planas, bandas más duras
    c.fillStyle = this.cromo(c, cy - 25, cy + 25, true, 0.08)
    c.beginPath()
    c.moveTo(132, cy - 25); c.lineTo(160, cy - 25); c.lineTo(164, cy - 21)
    c.lineTo(164, cy + 21); c.lineTo(160, cy + 25); c.lineTo(132, cy + 25)
    c.lineTo(128, cy + 21); c.lineTo(128, cy - 21)
    c.closePath(); c.fill()
    c.fillStyle = 'rgba(0,0,0,0.25)'
    c.fillRect(145, cy - 25, 1.4, 50)
    // Cuerpo
    c.fillStyle = this.cromo(c, cy - 22, cy + 22, true)
    c.beginPath()
    c.moveTo(164, cy - 21)
    c.lineTo(310, cy - 22)
    c.arc(310, cy, 22, -Math.PI / 2, Math.PI / 2)
    c.lineTo(164, cy + 21)
    c.closePath(); c.fill()
    // Pico
    c.fillStyle = this.cromo(c, GX - 13, GX + 13, false)
    c.beginPath()
    c.moveTo(GX - 13, cy + 12)
    c.lineTo(GX + 13, cy + 12)
    c.lineTo(GX + 10.5, PICO_Y - 6)
    c.lineTo(GX - 10.5, PICO_Y - 6)
    c.closePath(); c.fill()
    // Labio del pico
    c.fillStyle = this.cromo(c, GX - 12, GX + 12, false, 0.1)
    c.fillRect(GX - 12, PICO_Y - 7, 24, 7)
    c.fillStyle = 'rgba(0,0,0,0.6)'
    c.beginPath(); c.ellipse(GX, PICO_Y, 9, 1.6, 0, 0, Math.PI * 2); c.fill()
    // Bonete donde pivota la manija
    c.fillStyle = this.cromo(c, PIVOTE.x - 12, PIVOTE.x + 12, false)
    c.fillRect(PIVOTE.x - 12, PIVOTE.y - 2, 24, cy - 20 - PIVOTE.y + 2)
    c.fillStyle = this.cromo(c, PIVOTE.x - 15, PIVOTE.x + 15, false, 0.15)
    c.fillRect(PIVOTE.x - 15, cy - 26, 30, 6)

    // ── Bandeja de goteo ───────────────────────────────────────────────────
    const B = BANDEJA
    // Cara de arriba: la rejilla
    c.fillStyle = '#15191c'
    c.beginPath()
    c.moveTo(B.x0 + 10, B.arriba); c.lineTo(B.x1 - 10, B.arriba)
    c.lineTo(B.x1, B.frente); c.lineTo(B.x0, B.frente)
    c.closePath(); c.fill()
    for (let i = 0; i < 4; i++) {
      const y = B.arriba + 2 + i * 2.6
      const t = i / 4
      c.fillStyle = 'rgba(190,198,204,0.55)'
      c.fillRect(B.x0 + 10 - t * 10, y, B.x1 - B.x0 - 20 + t * 20, 1.1)
    }
    // Frente: acero cepillado
    const fr = c.createLinearGradient(0, B.frente, 0, B.abajo)
    fr.addColorStop(0, '#c9d0d4')
    fr.addColorStop(0.18, '#8e979d')
    fr.addColorStop(0.6, '#4a5257')
    fr.addColorStop(1, '#22282c')
    c.fillStyle = fr
    c.fillRect(B.x0, B.frente, B.x1 - B.x0, B.abajo - B.frente)
    const rnd = azar(77)
    for (let i = 0; i < 70; i++) {
      c.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.05})`
      c.fillRect(B.x0, B.frente + rnd() * (B.abajo - B.frente), B.x1 - B.x0, 0.4)
    }
    c.fillStyle = 'rgba(255,255,255,0.6)'
    c.fillRect(B.x0, B.frente, B.x1 - B.x0, 0.8)

    this.fija = L
  }

  private prepararVidrio() {
    const r: Rect = { x0: GX - 132, y0: BOCA_Y - 26, x1: GX + 132, y1: BASE_Y + 22 }

    // ── Atrás: lo que se ve a través del vaso ──────────────────────────────
    const A = this.lienzo(r)
    let c = A.x
    this.caminoExterior(c)
    c.fillStyle = 'rgba(190,215,225,0.035)'
    c.fill()
    // Borde de atrás de la boca
    c.strokeStyle = 'rgba(255,255,255,0.28)'
    c.lineWidth = 1.6
    c.beginPath(); c.ellipse(GX, BOCA_Y, R_BOCA, R_BOCA * K, 0, Math.PI, 0); c.stroke()
    c.strokeStyle = 'rgba(255,255,255,0.12)'
    c.beginPath(); c.ellipse(GX, BOCA_Y, R_BOCA - PARED, (R_BOCA - PARED) * K, 0, Math.PI, 0); c.stroke()
    // Reflejos de la pared de atrás
    const fa = c.createLinearGradient(GX + 40, 0, GX + 80, 0)
    fa.addColorStop(0, 'rgba(255,255,255,0)')
    fa.addColorStop(0.5, 'rgba(255,255,255,0.05)')
    fa.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = fa
    c.fillRect(GX + 40, BOCA_Y + 20, 40, FONDO_Y - BOCA_Y - 40)
    this.vidrioAtras = A

    // ── Adelante: brillos, espesor y base ──────────────────────────────────
    const F = this.lienzo(r)
    c = F.x
    // Espesor de las paredes: una franja clara con el borde interno oscuro.
    const pared = (lado: -1 | 1) => {
      c.beginPath()
      c.moveTo(GX + lado * R_BOCA, BOCA_Y)
      c.lineTo(GX + lado * R_BASE, FONDO_Y)
      c.lineTo(GX + lado * rInt(FONDO_Y), FONDO_Y)
      c.lineTo(GX + lado * rInt(BOCA_Y), BOCA_Y)
      c.closePath()
      c.fillStyle = 'rgba(225,240,245,0.14)'
      c.fill()
      c.strokeStyle = 'rgba(255,255,255,0.42)'
      c.lineWidth = 1.4
      c.beginPath(); c.moveTo(GX + lado * R_BOCA, BOCA_Y); c.lineTo(GX + lado * R_BASE, BASE_Y - 4); c.stroke()
    }
    pared(-1); pared(1)

    // El brillo principal: una franja ancha y suave y, pegada, una fina y dura.
    const franja = (xa: number, xb: number, w: number, a: number) => {
      const g = c.createLinearGradient(GX + xa - w, 0, GX + xa + w, 0)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.5, `rgba(255,255,255,${a})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      c.fillStyle = g
      c.beginPath()
      c.moveTo(GX + xa - w, BOCA_Y + 26)
      c.lineTo(GX + xa + w, BOCA_Y + 26)
      c.lineTo(GX + xb + w * 0.8, FONDO_Y - 30)
      c.lineTo(GX + xb - w * 0.8, FONDO_Y - 30)
      c.closePath(); c.fill()
    }
    franja(-R_BOCA * 0.66, -R_BASE * 0.66, 15, 0.2)
    franja(R_BOCA * 0.8, R_BASE * 0.8, 5, 0.16)
    // La línea dura, con fundido en las puntas
    const dura = c.createLinearGradient(0, BOCA_Y + 30, 0, FONDO_Y - 40)
    dura.addColorStop(0, 'rgba(255,255,255,0)')
    dura.addColorStop(0.12, 'rgba(255,255,255,0.78)')
    dura.addColorStop(0.75, 'rgba(255,255,255,0.55)')
    dura.addColorStop(1, 'rgba(255,255,255,0)')
    c.strokeStyle = dura
    c.lineWidth = 2.6
    c.lineCap = 'round'
    c.beginPath()
    c.moveTo(GX - R_BOCA * 0.66 - 9, BOCA_Y + 32)
    c.lineTo(GX - R_BASE * 0.66 - 7, FONDO_Y - 40)
    c.stroke()

    // Boca: el borde de adelante, con espesor
    c.lineCap = 'butt'
    c.fillStyle = 'rgba(235,245,248,0.22)'
    c.beginPath()
    c.ellipse(GX, BOCA_Y, R_BOCA, R_BOCA * K, 0, 0, Math.PI)
    c.ellipse(GX, BOCA_Y, R_BOCA - PARED, (R_BOCA - PARED) * K, 0, Math.PI, 0, true)
    c.closePath(); c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.7)'
    c.lineWidth = 1.8
    c.beginPath(); c.ellipse(GX, BOCA_Y, R_BOCA, R_BOCA * K, 0, 0, Math.PI); c.stroke()
    // Destello en la boca
    // Un destello que sigue la curva del borde, no un punto
    c.save()
    c.translate(GX - R_BOCA * 0.6, BOCA_Y + R_BOCA * K * 0.8)
    c.scale(1, 0.22)
    const dest = c.createRadialGradient(0, 0, 0, 0, 0, 22)
    dest.addColorStop(0, 'rgba(255,255,255,0.8)')
    dest.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = dest
    c.fillRect(-22, -22, 44, 44)
    c.restore()

    // Base maciza
    c.beginPath()
    c.ellipse(GX, FONDO_Y, rInt(FONDO_Y), rInt(FONDO_Y) * K, 0, 0, Math.PI)
    c.lineTo(GX - R_BASE, BASE_Y)
    c.ellipse(GX, BASE_Y, R_BASE, R_BASE * K, 0, Math.PI, 0, true)
    c.closePath()
    const base = c.createLinearGradient(GX - R_BASE, 0, GX + R_BASE, 0)
    base.addColorStop(0, 'rgba(200,225,230,0.30)')
    base.addColorStop(0.25, 'rgba(200,225,230,0.08)')
    base.addColorStop(0.7, 'rgba(200,225,230,0.05)')
    base.addColorStop(1, 'rgba(200,225,230,0.26)')
    c.fillStyle = base
    c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.22)'
    c.lineWidth = 1.2
    c.beginPath(); c.ellipse(GX, FONDO_Y, rInt(FONDO_Y), rInt(FONDO_Y) * K, 0, 0, Math.PI); c.stroke()
    c.strokeStyle = 'rgba(255,255,255,0.55)'
    c.lineWidth = 1.8
    c.beginPath(); c.ellipse(GX, BASE_Y, R_BASE, R_BASE * K, 0, 0.12, Math.PI - 0.12); c.stroke()
    // Refracción dentro de la base: dos arcos claros cortos
    c.strokeStyle = 'rgba(255,255,255,0.35)'
    c.lineWidth = 1.4
    c.beginPath(); c.ellipse(GX - 20, FONDO_Y + 24, 46, 6, 0, 0.3, 1.4); c.stroke()
    c.beginPath(); c.ellipse(GX + 30, FONDO_Y + 30, 36, 5, 0, 1.9, 2.8); c.stroke()
    this.vidrioFrente = F

    // ── Rocío: gotitas sobre el vidrio frío ────────────────────────────────
    const R = this.lienzo(r)
    c = R.x
    this.caminoExterior(c)
    c.save()
    c.clip()
    c.fillStyle = 'rgba(230,240,245,0.05)'
    c.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0)
    const rnd = azar(4242)
    for (let i = 0; i < 520; i++) {
      const y = BOCA_Y + 14 + rnd() * (FONDO_Y - BOCA_Y - 10)
      const lim = rExt(y) - 3
      const x = GX + (rnd() * 2 - 1) * lim
      // Cerca de los bordes se ven de canto: más finas.
      const canto = Math.abs(x - GX) / lim
      const grande = rnd() < 0.05
      const rr = (grande ? 2.6 + rnd() * 2 : 0.5 + rnd() * rnd() * 1.6) * (1 - canto * 0.5)
      c.fillStyle = 'rgba(255,255,255,0.10)'
      c.beginPath(); c.ellipse(x, y, rr * (1 - canto * 0.4), rr, 0, 0, Math.PI * 2); c.fill()
      c.fillStyle = 'rgba(0,0,0,0.22)'
      c.beginPath(); c.ellipse(x + rr * 0.15, y + rr * 0.35, rr * 0.8 * (1 - canto * 0.4), rr * 0.55, 0, 0, Math.PI); c.fill()
      c.fillStyle = 'rgba(255,255,255,0.85)'
      c.beginPath(); c.arc(x - rr * 0.3, y - rr * 0.35, Math.max(0.35, rr * 0.3), 0, Math.PI * 2); c.fill()
    }
    c.restore()
    this.rocio = R
  }

  private prepararManija() {
    if (!this.esc) return
    // Coordenadas locales: el pivote en (0,0) y la manija hacia arriba.
    const L = this.lienzo({ x0: -26, y0: -250, x1: 26, y1: 4 })
    const c = L.x
    const p = this.pal
    // Virola de cromo
    c.fillStyle = this.cromo(c, -11, 11, false)
    c.fillRect(-11, -28, 22, 30)
    c.fillStyle = 'rgba(0,0,0,0.35)'
    c.fillRect(-11, -14, 22, 1.2)
    c.fillRect(-11, -24, 22, 1.2)

    // Cuerpo: laca negra, más ancho arriba
    const cuerpo = () => {
      c.beginPath()
      c.moveTo(-12, -28)
      c.lineTo(-19, -222)
      c.quadraticCurveTo(-19, -242, 0, -243)
      c.quadraticCurveTo(19, -242, 19, -222)
      c.lineTo(12, -28)
      c.closePath()
    }
    cuerpo()
    const laca = c.createLinearGradient(-19, 0, 19, 0)
    laca.addColorStop(0, '#08090a')
    laca.addColorStop(0.22, '#2e3033')
    laca.addColorStop(0.32, '#55585c')
    laca.addColorStop(0.42, '#1d1f21')
    laca.addColorStop(0.8, '#141516')
    laca.addColorStop(0.92, '#3a3c3f')
    laca.addColorStop(1, '#070808')
    c.fillStyle = laca
    c.fill()

    // Placa con el color y el nombre de la cerveza, como en una barra de verdad
    c.save()
    c.beginPath()
    c.moveTo(-10, -52); c.lineTo(-15.5, -206)
    c.quadraticCurveTo(-15.5, -214, -8, -214)
    c.lineTo(8, -214)
    c.quadraticCurveTo(15.5, -214, 15.5, -206)
    c.lineTo(10, -52)
    c.closePath()
    const placa = c.createLinearGradient(-16, 0, 16, 0)
    placa.addColorStop(0, css(p.hondo))
    placa.addColorStop(0.3, css(p.luz))
    placa.addColorStop(0.42, css(mezclar(p.brillo, [255, 255, 255], 0.3)))
    placa.addColorStop(0.55, css(p.base))
    placa.addColorStop(1, css(p.hondo))
    c.fillStyle = placa
    c.fill()
    c.clip()
    const texto = (this.entrada.etiqueta || '').toUpperCase().slice(0, 18)
    if (texto) {
      c.translate(0, -133)
      c.rotate(-Math.PI / 2)
      let tam = 17
      c.font = `800 ${tam}px "Big Shoulders Display Variable", "Archivo Variable", sans-serif`
      const w = c.measureText(texto).width
      if (w > 140) { tam = tam * 140 / w; c.font = `800 ${tam}px "Big Shoulders Display Variable", "Archivo Variable", sans-serif` }
      const [r, g, b] = p.base
      const claro = (r * 0.299 + g * 0.587 + b * 0.114) > 140
      c.fillStyle = claro ? 'rgba(20,14,8,0.88)' : 'rgba(255,248,236,0.92)'
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(texto, 0, 1)
    }
    c.restore()
    // Brillo de la laca encima de la placa
    cuerpo()
    const brillo = c.createLinearGradient(-19, 0, 19, 0)
    brillo.addColorStop(0.24, 'rgba(255,255,255,0)')
    brillo.addColorStop(0.31, 'rgba(255,255,255,0.22)')
    brillo.addColorStop(0.38, 'rgba(255,255,255,0)')
    c.fillStyle = brillo
    c.fill()
    // Tapa de cromo arriba
    c.fillStyle = this.cromo(c, -14, 14, false)
    c.beginPath(); c.ellipse(0, -240, 13, 4.5, 0, Math.PI, 0); c.fill()

    this.manija = L
  }

  private prepararTexturas() {
    const rnd = azar(9001)

    // Espuma: burbujitas apretadas, con el borde claro y el fondo tibio.
    const E = this.lienzo({ x0: 0, y0: 0, x1: 120, y1: 120 })
    let c = E.x
    for (let i = 0; i < 520; i++) {
      const r = 0.7 + Math.pow(rnd(), 2.4) * 4.2
      const x = rnd() * 120, y = rnd() * 120
      for (const ox of [-120, 0, 120]) for (const oy of [-120, 0, 120]) {
        const cx = x + ox, cy = y + oy
        if (cx < -6 || cx > 126 || cy < -6 || cy > 126) continue
        c.strokeStyle = 'rgba(140,108,68,0.42)'
        c.lineWidth = 0.55
        c.beginPath(); c.arc(cx, cy + 0.3, r, 0, Math.PI * 2); c.stroke()
        c.strokeStyle = 'rgba(255,255,255,0.7)'
        c.beginPath(); c.arc(cx, cy, r, Math.PI * 1.05, Math.PI * 1.75); c.stroke()
      }
    }
    this.texEspuma = E

    // Chorro: vetas verticales que se repiten sin costura
    const Ch = this.lienzo({ x0: 0, y0: 0, x1: 24, y1: 200 })
    c = Ch.x
    for (let i = 0; i < 46; i++) {
      const x = 2 + rnd() * 20, y = rnd() * 200, l = 16 + rnd() * 90, w = 0.4 + rnd() * 1.6
      const a = 0.06 + rnd() * 0.32
      for (const oy of [-200, 0, 200]) {
        const g = c.createLinearGradient(0, y + oy, 0, y + oy + l)
        g.addColorStop(0, 'rgba(255,255,255,0)')
        g.addColorStop(0.5, `rgba(255,252,240,${a})`)
        g.addColorStop(1, 'rgba(255,255,255,0)')
        c.fillStyle = g
        c.fillRect(x, y + oy, w, l)
      }
    }
    this.texChorro = Ch

    // La nube de microburbujas
    const N = this.lienzo({ x0: 0, y0: 0, x1: 100, y1: 100 })
    c = N.x
    for (let i = 0; i < 700; i++) {
      const x = rnd() * 100, y = rnd() * 100, r = 0.3 + rnd() * 0.7
      c.fillStyle = `rgba(255,252,242,${0.2 + rnd() * 0.5})`
      for (const ox of [-100, 0, 100]) for (const oy of [-100, 0, 100]) {
        c.beginPath(); c.arc(x + ox, y + oy, r, 0, Math.PI * 2); c.fill()
      }
    }
    this.texNube = N

    // Una burbuja: aro claro, centro casi transparente y un punto de luz.
    const b = document.createElement('canvas')
    b.width = b.height = 24
    c = b.getContext('2d')!
    const g = c.createRadialGradient(12, 12, 0, 12, 12, 12)
    g.addColorStop(0, 'rgba(255,255,250,0.12)')
    g.addColorStop(0.62, 'rgba(255,255,250,0.22)')
    g.addColorStop(0.84, 'rgba(255,255,250,0.8)')
    g.addColorStop(1, 'rgba(255,255,250,0)')
    c.fillStyle = g
    c.fillRect(0, 0, 24, 24)
    c.fillStyle = 'rgba(255,255,255,0.95)'
    c.beginPath(); c.arc(8.5, 8.5, 2.2, 0, Math.PI * 2); c.fill()
    this.burbuja = b
  }

  // ── Fondo: la barra de noche ───────────────────────────────────────────────
  private pintarFondo() {
    const f = this.fondo
    const c = f.getContext('2d')!
    const s = f.width / this.cssW
    const W = this.cssW, H = this.cssH
    c.setTransform(s, 0, 0, s, 0, 0)

    const mY = (y: number) => this.oy + y * this.esc          // escena → pantalla
    const mX = (x: number) => this.ox + x * this.esc
    const atras = mY(870)
    const frente = mY(990)

    // Pared del fondo: azul pizarra, más clara en el medio donde hay luz.
    const pared = c.createLinearGradient(0, 0, 0, atras)
    pared.addColorStop(0, '#0a0f12')
    pared.addColorStop(0.55, '#121b20')
    pared.addColorStop(1, '#0f171b')
    c.fillStyle = pared
    c.fillRect(0, 0, W, atras + 1)

    // Bokeh: las luces de la barra, desenfocadas. Con borde apenas más
    // brillante, como las de un lente de verdad.
    const rnd = azar(31337)
    const m = Math.min(W, H)
    c.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 38; i++) {
      const x = rnd() * W
      const y = m * 0.04 + rnd() * Math.max(10, atras - m * 0.12)
      const r = m * (0.018 + rnd() * rnd() * 0.06)
      const t = rnd()
      const col: RGB = t < 0.62 ? [255, 168, 82] : t < 0.88 ? [255, 214, 152] : [118, 168, 196]
      const a = 0.05 + rnd() * 0.14
      const g = c.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, css(col, a * 0.55))
      g.addColorStop(0.8, css(col, a * 0.75))
      g.addColorStop(0.94, css(col, a * 0.32))
      g.addColorStop(1, css(col, 0))
      c.fillStyle = g
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill()
    }
    // Una tira de luz bajo un estante, muy suave
    const tira = c.createLinearGradient(0, atras * 0.36, 0, atras * 0.5)
    tira.addColorStop(0, 'rgba(255,190,120,0)')
    tira.addColorStop(0.5, 'rgba(255,190,120,0.07)')
    tira.addColorStop(1, 'rgba(255,190,120,0)')
    c.fillStyle = tira
    c.fillRect(0, atras * 0.36, W, atras * 0.14)
    // Luz cálida detrás del vaso: lo despega del fondo
    const gx = mX(GX), gy = mY(650)
    const halo = c.createRadialGradient(gx, gy, 0, gx, gy, this.esc * 520)
    halo.addColorStop(0, 'rgba(255,176,96,0.13)')
    halo.addColorStop(1, 'rgba(255,176,96,0)')
    c.fillStyle = halo
    c.fillRect(0, 0, W, H)
    c.globalCompositeOperation = 'source-over'

    // Mostrador: madera oscura, lustrada
    const tapa = c.createLinearGradient(0, atras, 0, frente)
    tapa.addColorStop(0, '#1a120c')
    tapa.addColorStop(0.35, '#2b1d13')
    tapa.addColorStop(1, '#3a2717')
    c.fillStyle = tapa
    c.fillRect(0, atras, W, frente - atras)
    // Reflejos de las luces en la madera lustrada
    c.globalCompositeOperation = 'lighter'
    const r2 = azar(5150)
    for (let i = 0; i < 9; i++) {
      const x = r2() * W, w = m * (0.025 + r2() * 0.04)
      const y = atras + (frente - atras) * (0.15 + r2() * 0.3)
      c.save()
      c.translate(x, y)
      c.scale(1, 2.6)
      const g = c.createRadialGradient(0, 0, 0, 0, 0, w)
      g.addColorStop(0, 'rgba(255,170,90,0.07)')
      g.addColorStop(1, 'rgba(255,170,90,0)')
      c.fillStyle = g
      c.fillRect(-w, -w, w * 2, w * 2)
      c.restore()
    }
    c.globalCompositeOperation = 'source-over'
    const veta = azar(808)
    for (let i = 0; i < 60; i++) {
      c.fillStyle = `rgba(0,0,0,${0.05 + veta() * 0.08})`
      c.fillRect(0, atras + veta() * (frente - atras), W, 0.6 + veta())
    }
    c.fillStyle = 'rgba(255,205,150,0.12)'
    c.fillRect(0, atras, W, 1)
    // Canto del mostrador
    c.fillStyle = 'rgba(255,214,160,0.38)'
    c.fillRect(0, frente, W, 1.5)
    const cara = c.createLinearGradient(0, frente, 0, H)
    cara.addColorStop(0, '#140d08')
    cara.addColorStop(1, '#050403')
    c.fillStyle = cara
    c.fillRect(0, frente + 1.5, W, Math.max(0, H - frente))

    // Viñeta
    const v = c.createRadialGradient(W * 0.4, H * 0.45, m * 0.3, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.62)
    v.addColorStop(0, 'rgba(0,0,0,0)')
    v.addColorStop(1, 'rgba(0,0,0,0.6)')
    c.fillStyle = v
    c.fillRect(0, 0, W, H)

    // Grano: rompe lo digital de los degradados. Quieto: está en el fondo.
    const grano = document.createElement('canvas')
    grano.width = grano.height = 128
    const gc = grano.getContext('2d')!
    const img = gc.createImageData(128, 128)
    const rg = azar(2024)
    for (let i = 0; i < img.data.length; i += 4) {
      const n = rg() * 255
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n
      img.data[i + 3] = 14
    }
    gc.putImageData(img, 0, 0)
    const pat = c.createPattern(grano, 'repeat')
    if (pat) {
      c.setTransform(1, 0, 0, 1, 0, 0)
      c.fillStyle = pat
      c.fillRect(0, 0, f.width, f.height)
    }
  }
}
