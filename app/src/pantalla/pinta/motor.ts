import { css, mezclar, paleta, type Paleta, type RGB } from './color'

// ─────────────────────────────────────────────────────────────────────────────
// El motor de la tirada, en estilo anime: el vaso es un personaje.
//
// ── Lo que muestra es lo que pasa ───────────────────────────────────────────
// El vaso se llena con los mililitros que mide el caudalímetro, no con un
// temporizador. La manija se abre cuando la medición sube y se cierra cuando
// deja de subir. Si se pasa de un vaso, el lleno se va saltando y entra otro.
// Lo que cambia con el estilo es la actuación, no los datos: la cara del vaso
// cuenta en qué está la tirada.
//
//   Libre       canta, guiña, salta, mira para los costados (es la vidriera)
//   Tu turno    ojos de estrella, salta de las ganas, mira la canilla
//   Sirviendo   ojos felices y boca abierta; cerca del límite, transpira
//   En pausa    espera mirando la canilla, parpadea
//   Ticket      pinta perfecta: festejo con papelitos; si no, sonrisa y guiño
//   Apagada     duerme
//
// ── Cómo está hecho ─────────────────────────────────────────────────────────
// Canvas 2D, todo dibujado con trazos (nada de imágenes): contorno grueso de
// tinta, colores planos y una sombra dura, como un dibujo animado. Los cuerpos
// tienen física simple de dibujo animado: resortes para estirar y aplastar
// (squash & stretch), gravedad para los saltos y un oleaje en la cerveza que
// responde a los saltos. El fondo (la contrabarra) se pinta una sola vez.
//
// ── Unidades ────────────────────────────────────────────────────────────────
// Todo se dibuja en un espacio fijo de 600 × 1000 unidades y se escala al
// tamaño real de la pantalla.
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

// ── Geometría (unidades de la escena) ──────────────────────────────────────
const GX = 300                 // centro del vaso = eje del pico
const BOCA_Y = 470
const BASE_Y = 900
const FONDO_Y = 874            // fondo por dentro: la base es gruesa
const R_BOCA = 124
const R_BASE = 96
const PARED = 7
const LLENO_Y = BOCA_Y + 46
const CARA_Y = 690
const PICO_Y = 376
const PIVOTE = { x: 300, y: 302 }
const TORRE = { x0: 424, x1: 482, y0: 300, y1: 902 }
const BRAZO = { y0: 304, y1: 336 }
const MOSTRADOR_Y = 902
const BANDEJA = { x0: 158, x1: 442, y0: 884, y1: 904 }
const SALIDA = 720
const CAJA = { x0: 20, x1: 580, y0: 92, y1: 952 }  // lo que tiene que entrar siempre

const G = 3400                 // gravedad del chorro
const SALTO_G = 2600           // gravedad de los saltos: más blanda, de dibujo animado
const MANIJA_CERRADA = 5 * Math.PI / 180
const MANIJA_ABIERTA = -32 * Math.PI / 180

const TINTA = '#1c1226'
const TINTA_RGB: RGB = [28, 18, 38]

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
type Rect = { x0: number; y0: number; x1: number; y1: number }

/** Números pseudoaleatorios con semilla: el fondo sale igual en cada carga. */
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
const salida = (t: number) => 1 - Math.pow(1 - t, 3)
const entrada = (t: number) => t * t * t
const rnd = Math.random
const entre = (a: number, b: number) => a + rnd() * (b - a)

// ── Estado ─────────────────────────────────────────────────────────────────
type Cara = 'dormida' | 'feliz' | 'canta' | 'guino' | 'emocionada' | 'recibiendo'
  | 'nerviosa' | 'esperando' | 'orgullosa' | 'contenta' | 'chau'

type Burbuja = { x: number; y: number; r: number; v: number; fase: number }
type Vaso = {
  clave: string
  /** 0..1 de la entrada (llega saltando) o de la salida (se va saltando). */
  t: number
  saliendo: boolean
  nivel: number          // 0..1 del volumen de un vaso
  espuma: number         // alto de la espuma, en unidades
  remolino: number       // 0..1: la cerveza revuelta por el chorro
  frio: number           // 0..1: gotitas de condensación
  burbujas: Burbuja[]
  semilla: number
  // El cuerpo
  sq: number; vsq: number      // aplastado (+) o estirado (−)
  alto: number; valto: number  // salto: negativo es arriba
  rot: number
  ola: number; vola: number    // inclinación de la superficie de la cerveza
  // La cara
  cara: Cara
  mirada: { x: number; y: number }
  mirar: { x: number; y: number }
  parpadeo: number             // segundos hasta el próximo
  cerrando: number             // 0..1 de un parpadeo en curso
  sudor: number
}

type Particula = {
  tipo: 'nota' | 'z' | 'corazon' | 'chispa' | 'excl' | 'confeti' | 'gota' | 'puf'
  x: number; y: number; vx: number; vy: number
  vida: number; max: number
  rot: number; vr: number; tam: number
  color: string
  g: number
}
type Flotante = { x: number; y: number; r: number; v: number; fase: number; estrella: boolean }
type Gota = { x: number; y: number; vy: number }

const CONFETI = ['#ff5d8f', '#ffd23f', '#3ec6ff', '#7dff9b', '#b388ff', '#ff9f43']

export class Motor {
  readonly tipo = 'animado'
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
  private area: Rect = { x0: 0, y0: 0, x1: 1, y1: 1 }

  private entrada: Entrada = { modo: 'exhibicion', ml: 0, vaso: 473, color: '#d9a21b', etiqueta: '', sesion: null }
  private pal: Paleta = paleta('#d9a21b')
  private reducido = false
  private placa: HTMLCanvasElement | null = null

  // Medición
  private mlPrevio = 0
  private cambioEn = 0
  private caudal = 0          // ml/s estimados
  private fluyendo = false
  private mlVisual = 0
  private mlContador = 0
  private ultimoContado = -1
  private alias: { de: string | null; a: string } | null = null

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
  private goteos: number[] = []
  private parts: Particula[] = []
  private flotan: Flotante[] = []
  private reloj = 0
  private ultimo = 0
  private raf = 0
  private semillas = 1
  private calidad: 'alta' | 'baja' = 'alta'
  private lento = 0

  // Dirección de escena
  private modoPrevio: Modo | null = null
  private rayosAng = 0
  private rayosVel = 0.08
  private zoom = 1
  private vZoom = 0
  private temblor = 0
  private lineas = 0
  private lineasSemilla = 1
  private apagado = 0
  private fiesta = 0
  private perfecta = false
  private accion: { tipo: 'salto' | 'guino' | 'mira' | 'canta'; t: number; dur: number } | null = null
  private proxAccion = 2.5
  private proxSalto = 0
  private proxEfecto = 0
  private proxNota = 0
  private ultimoLleno = 0

  alContar: ((ml: number) => void) | null = null

  constructor(escena: HTMLCanvasElement, fondo: HTMLCanvasElement) {
    this.escena = escena
    this.fondo = fondo
    this.ctx = escena.getContext('2d')!
    const r = azar(7)
    for (let i = 0; i < 26; i++) {
      this.flotan.push({ x: r() * 1200 - 300, y: r() * 1100, r: 6 + r() * 22, v: 8 + r() * 22, fase: r() * 6, estrella: i % 3 === 0 })
    }
  }

  // ── API ──────────────────────────────────────────────────────────────────
  medir(cssW: number, cssH: number, reducido: boolean) {
    if (cssW < 10 || cssH < 10) return
    this.reducido = reducido
    this.cssW = cssW
    this.cssH = cssH
    this.dpr = this.calidad === 'baja' ? 1 : Math.min(2, window.devicePixelRatio || 1)

    // Apaisado: la escena a la izquierda (54 %). Vertical: arriba (60 %). Son
    // las mismas proporciones del CSS del panel de texto.
    const apaisado = cssW / cssH > 1.05
    this.area = apaisado
      ? { x0: 0, y0: 0, x1: cssW * 0.54, y1: cssH }
      : { x0: 0, y0: 0, x1: cssW, y1: cssH * 0.6 }
    const aw = this.area.x1 - this.area.x0, ah = this.area.y1 - this.area.y0
    const cw = CAJA.x1 - CAJA.x0, ch = CAJA.y1 - CAJA.y0
    this.esc = Math.min(aw / cw, ah / ch) * 0.98
    this.ox = this.area.x0 + aw / 2 - ((CAJA.x0 + CAJA.x1) / 2) * this.esc
    this.oy = this.area.y0 + ah / 2 - ((CAJA.y0 + CAJA.y1) / 2) * this.esc

    this.escena.width = Math.round(cssW * this.dpr)
    this.escena.height = Math.round(cssH * this.dpr)
    this.fondo.width = Math.round(cssW * Math.min(this.dpr, 1.5))
    this.fondo.height = Math.round(cssH * Math.min(this.dpr, 1.5))
    this.pintarFondo()
  }

  actualizar(e: Entrada) {
    const ahora = performance.now() / 1000
    // El ticket no trae el id de la sesión, trae cuándo se cerró. Sin esto, al
    // terminar de servir el vaso "cambiaría" y se iría: es el mismo.
    if (e.modo === 'servida' && (this.entrada.modo === 'sirviendo' || this.entrada.modo === 'lista') && this.entrada.sesion) {
      this.alias = { de: e.sesion, a: this.entrada.sesion }
    }
    if (this.alias && e.modo === 'servida' && e.sesion === this.alias.de) e = { ...e, sesion: this.alias.a }
    const cambioColor = e.color !== this.entrada.color
    const cambioEtiqueta = e.etiqueta !== this.entrada.etiqueta

    if (e.sesion !== this.entrada.sesion || e.ml < this.mlPrevio) {
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
      this.pintarFondo()
    }
    if (cambioColor || cambioEtiqueta) this.placa = null
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
      // Si la tablet no llega a ~38 cuadros por más de 2 s, se dibuja a
      // densidad 1: un dibujo animado a los tirones se ve peor que uno menos
      // nítido.
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
  repintarManija() { this.placa = null }

  // ── Simulación ─────────────────────────────────────────────────────────────
  private avanzar(dt: number) {
    this.reloj += dt
    const ahora = performance.now() / 1000
    const e = this.entrada
    const vaso = Math.max(50, e.vaso)

    // ¿Está corriendo cerveza? El ESP32 informa como mucho una vez por segundo
    // y la pantalla consulta cada medio: entre dos cambios pueden pasar casi
    // 2 s aunque la canilla siga abierta. 2,4 s es menos que los 3 s que
    // espera el propio ESP32 para dar la tirada por cortada.
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
      const indice = medido > 0 ? Math.ceil(medido / vaso - 1e-6) - 1 : 0
      const visto = Math.min((indice + 1) * vaso, Math.max(indice * vaso, e.modo === 'lista' ? 0 : this.mlVisual))
      clave = `s:${e.sesion ?? '-'}:${indice}`
      objetivo = medido > 0 ? (visto - indice * vaso) / vaso : 0
    }

    let activo = this.vasos.find(v => !v.saliendo)
    // Un vaso vacío no se cambia por otro vacío: se usa el que está.
    if (activo && activo.clave !== clave && activo.nivel < 0.004 && clave !== 'muestra' && activo.clave !== 'muestra') {
      activo.clave = clave
    }
    if (!activo || activo.clave !== clave) {
      if (activo) { activo.saliendo = true; activo.t = 0 }
      const muestra = clave === 'muestra'
      const inicial = muestra ? 1 : Math.max(0, Math.min(1, objetivo))
      const conAlgo = inicial > 0.02
      activo = {
        clave, nivel: inicial, espuma: muestra ? 46 : conAlgo ? Math.min(46, 6 + alturaDe(inicial) * 0.3) : 0,
        remolino: 0, frio: conAlgo ? 1 : 0, burbujas: [],
        t: this.vasos.length ? 0 : 1, saliendo: false, semilla: this.semillas++,
        sq: 0, vsq: 0, alto: 0, valto: 0, rot: 0, ola: 0, vola: 0,
        cara: 'feliz', mirada: { x: 0, y: 0 }, mirar: { x: 0, y: 0 }, parpadeo: 1 + rnd() * 2, cerrando: 0, sudor: 0,
      }
      this.vasos.push(activo)
    }

    this.dirigir(dt, activo, vaso)

    for (const v of this.vasos) {
      v.t = Math.min(1, v.t + dt / (v.saliendo ? 0.75 : 0.9))
      const esActivo = v === activo
      if (esActivo) {
        v.nivel = e.modo === 'sirviendo' ? Math.min(1, objetivo) : acercar(v.nivel, objetivo, 0.6, dt)
      } else v.cara = 'chau'
      this.avanzarVaso(v, dt, esActivo && this.fluyendo && this.chorro === 'si')
    }
    this.vasos = this.vasos.filter(v => !(v.saliendo && v.t >= 1))

    // ── La manija: un resorte, con rebote de dibujo animado ───────────────
    const meta = this.fluyendo ? MANIJA_ABIERTA : MANIJA_CERRADA
    if (this.reducido) {
      this.angulo = meta
    } else {
      const fuerza = -170 * (this.angulo - meta) - 11 * this.velAngulo
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
      this.goteos = [0.35, 0.95, 1.9]
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
    if (this.goteos.length) {
      this.goteos = this.goteos.map(t => t - dt)
      while (this.goteos.length && this.goteos[0] <= 0) {
        this.goteos.shift()
        this.gotas.push({ x: GX, y: PICO_Y + 4, vy: 30 })
      }
    }
    for (const g of this.gotas) { g.vy += G * 0.6 * dt; g.y += g.vy * dt }
    this.gotas = this.gotas.filter(g => g.y < impacto)

    // Donde pega el chorro: espuma que salta y gotitas.
    if (this.chorro === 'si' && !this.reducido) {
      if (rnd() < dt * 22) this.sumar({ tipo: 'puf', x: GX + entre(-14, 14), y: impacto - 4, vx: entre(-40, 40), vy: entre(-90, -30), vida: 0.5, max: 0.5, rot: 0, vr: 0, tam: entre(7, 13), color: css(this.pal.espuma), g: 200 })
      if (rnd() < dt * 14) this.sumar({ tipo: 'gota', x: GX, y: impacto - 4, vx: entre(-180, 180), vy: entre(-320, -180), vida: 0.6, max: 0.6, rot: 0, vr: 0, tam: entre(4, 7), color: css(this.pal.luz), g: 1500 })
    }

    // ── Partículas ────────────────────────────────────────────────────────
    for (const p of this.parts) {
      p.vy += p.g * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vr * dt
      p.vida -= dt
      if (p.tipo === 'confeti') { p.vx *= Math.exp(-dt * 1.2); p.x += Math.sin(this.reloj * 6 + p.tam) * 30 * dt }
      if (p.tipo === 'nota' || p.tipo === 'z') p.x += Math.sin(this.reloj * 3 + p.rot) * 24 * dt
    }
    this.parts = this.parts.filter(p => p.vida > 0)
    for (const f of this.flotan) {
      f.y -= f.v * dt * (this.entrada.modo === 'apagada' ? 0.3 : 1)
      if (f.y < -120) { f.y = 1150; f.x = rnd() * 1200 - 300 }
    }

    // ── Cámara y fondo ────────────────────────────────────────────────────
    const velRayos = this.reducido ? 0
      : e.modo === 'apagada' ? 0
      : this.fiesta > 0 ? 1.1
      : e.modo === 'sirviendo' ? (this.fluyendo ? 0.45 : 0.15)
      : e.modo === 'lista' ? 0.3 : 0.1
    this.rayosVel = acercar(this.rayosVel, velRayos, 0.6, dt)
    this.rayosAng += this.rayosVel * dt
    const fz = -220 * (this.zoom - 1) - 13 * this.vZoom
    this.vZoom += fz * dt
    this.zoom += this.vZoom * dt
    this.temblor = Math.max(0, this.temblor - dt * 2.2)
    this.lineas = Math.max(0, this.lineas - dt * 1.1)
    if (rnd() < dt * 18) this.lineasSemilla++
    this.apagado = acercar(this.apagado, e.modo === 'apagada' ? 1 : 0, 0.6, dt)
    this.fiesta = Math.max(0, this.fiesta - dt)
  }

  /** La dirección de escena: qué cara pone el vaso y qué pasa alrededor. */
  private dirigir(dt: number, v: Vaso, vaso: number) {
    const e = this.entrada
    const quieto = this.reducido
    const cambio = e.modo !== this.modoPrevio
    const previo = this.modoPrevio
    this.modoPrevio = e.modo
    const arriba = this.cabezaVaso(v)

    if (cambio && previo !== null) {
      if (e.modo === 'lista') {
        // Apoyaste la tarjeta: golpe de cámara, líneas de impacto y el "!".
        this.golpe(0.9)
        this.lineas = 1
        this.saltar(v, 46)
        this.sumar({ tipo: 'excl', x: arriba.x - 120, y: arriba.y - 40, vx: 0, vy: -20, vida: 1.4, max: 1.4, rot: -0.15, vr: 0, tam: 92, color: '#ffd23f', g: 0 })
      } else if (e.modo === 'servida') {
        const resto = e.ml - Math.floor(e.ml / vaso) * vaso
        const cerca = Math.min(resto, vaso - resto) / vaso
        this.perfecta = e.ml >= vaso * 0.97 && cerca <= 0.03
        if (this.perfecta) {
          this.fiesta = 4.5
          this.golpe(1.2)
          this.lineas = 1.2
          this.temblor = 1
          this.saltar(v, 80)
          if (!quieto) {
            for (let i = 0; i < 90; i++) {
              const a = entre(-Math.PI * 0.95, -Math.PI * 0.05)
              const s = entre(380, 900)
              this.sumar({ tipo: 'confeti', x: arriba.x, y: arriba.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vida: entre(2.2, 3.6), max: 3.6, rot: rnd() * 6, vr: entre(-12, 12), tam: entre(12, 20), color: CONFETI[i % CONFETI.length], g: 900 })
            }
          }
          for (let i = 0; i < 10; i++) this.chispa(arriba.x + entre(-180, 180), arriba.y + entre(-60, 260), entre(14, 30))
        } else {
          this.saltar(v, 28)
          this.sumar({ tipo: 'corazon', x: arriba.x + 140, y: arriba.y + 40, vx: 0, vy: -50, vida: 2, max: 2, rot: 0.15, vr: 0, tam: 34, color: '#ff5d8f', g: 0 })
        }
      } else if (e.modo === 'exhibicion') {
        this.proxAccion = 2
      }
    }

    // Hasta que no está en su lugar no actúa: viene saltando.
    if (v.t < 1) { v.cara = e.modo === 'apagada' ? 'dormida' : 'feliz'; return }

    this.proxEfecto -= dt
    this.proxSalto -= dt
    v.mirar = { x: 0, y: 0 }

    if (e.modo === 'apagada') {
      v.cara = 'dormida'
      if (this.proxEfecto <= 0) {
        this.proxEfecto = 1.4
        this.sumar({ tipo: 'z', x: arriba.x + 110, y: arriba.y + 60, vx: 18, vy: -45, vida: 2.6, max: 2.6, rot: rnd() * 6, vr: 0, tam: entre(26, 40), color: '#cfe3ff', g: 0 })
      }
      return
    }

    if (e.modo === 'exhibicion') {
      // La vidriera: cada tanto hace algo, para que se la mire desde lejos.
      if (!this.accion) {
        this.proxAccion -= dt
        v.cara = 'feliz'
        v.mirar = { x: Math.sin(this.reloj * 0.7) * 0.4, y: 0.1 }
        if (this.proxAccion <= 0) {
          const tipos = ['salto', 'guino', 'mira', 'canta'] as const
          const tipo = tipos[Math.floor(rnd() * tipos.length)]
          this.accion = { tipo, t: 0, dur: tipo === 'canta' ? 3.2 : tipo === 'salto' ? 1.6 : tipo === 'mira' ? 2 : 1.6 }
          if (tipo === 'salto') this.saltar(v, 60)
          if (tipo === 'guino') this.sumar({ tipo: 'corazon', x: arriba.x + 130, y: arriba.y + 60, vx: 10, vy: -60, vida: 1.8, max: 1.8, rot: 0.2, vr: 0, tam: 30, color: '#ff5d8f', g: 0 })
        }
      } else {
        const a = this.accion
        a.t += dt
        if (a.tipo === 'canta') {
          v.cara = 'canta'
          this.proxNota -= dt
          if (this.proxNota <= 0) {
            this.proxNota = 0.45
            const lado = rnd() < 0.5 ? -1 : 1
            this.sumar({ tipo: 'nota', x: arriba.x + lado * entre(90, 150), y: arriba.y + entre(40, 120), vx: lado * 20, vy: -70, vida: 2, max: 2, rot: rnd() * 6, vr: 0, tam: entre(26, 36), color: CONFETI[Math.floor(rnd() * 4)], g: 0 })
          }
        } else if (a.tipo === 'guino') v.cara = 'guino'
        else if (a.tipo === 'mira') { v.cara = 'feliz'; v.mirar = { x: a.t < a.dur / 2 ? -1 : 1, y: -0.2 } }
        else {
          v.cara = 'emocionada'
          if (a.t < 0.1) for (let i = 0; i < 3; i++) this.sumar({ tipo: 'nota', x: arriba.x + entre(-140, 140), y: arriba.y + 30, vx: entre(-30, 30), vy: -90, vida: 1.6, max: 1.6, rot: rnd() * 6, vr: 0, tam: 30, color: CONFETI[i], g: 0 })
        }
        if (a.t >= a.dur) { this.accion = null; this.proxAccion = entre(2.2, 4.2) }
      }
      if (this.proxEfecto <= 0) { this.proxEfecto = 1.2; this.chispa(arriba.x + entre(-120, 120), arriba.y + entre(0, 380), entre(10, 18)) }
      return
    }
    this.accion = null

    if (e.modo === 'lista') {
      // Tu turno: ojos de estrella, salta de las ganas mirando la canilla.
      v.cara = 'emocionada'
      v.mirar = { x: 0.3, y: -1 }
      if (this.proxSalto <= 0) { this.proxSalto = 1.05; this.saltar(v, 22) }
      if (this.proxEfecto <= 0) { this.proxEfecto = 0.35; this.chispa(arriba.x + entre(-170, 170), arriba.y + entre(-40, 360), entre(10, 20)) }
      return
    }

    if (e.modo === 'sirviendo') {
      if (this.fluyendo) {
        const nervioso = v.nivel >= 0.86
        v.cara = nervioso ? 'nerviosa' : 'recibiendo'
        if (nervioso && this.ultimoLleno < 0.86) { this.lineas = Math.max(this.lineas, 0.6); this.golpe(0.4) }
        if (this.proxEfecto <= 0 && !nervioso) { this.proxEfecto = 0.5; this.chispa(arriba.x + entre(-150, 150), arriba.y + entre(0, 300), entre(10, 16)) }
      } else {
        v.cara = 'esperando'
        v.mirar = { x: 0.25, y: -0.9 }
      }
      this.ultimoLleno = v.nivel
      return
    }

    // Ticket
    if (this.perfecta) {
      v.cara = 'orgullosa'
      if (this.fiesta > 1.2 && this.proxSalto <= 0) { this.proxSalto = 0.8; this.saltar(v, 46) }
      if (this.proxEfecto <= 0) { this.proxEfecto = this.fiesta > 0 ? 0.12 : 0.6; this.chispa(arriba.x + entre(-190, 190), arriba.y + entre(-80, 380), entre(12, 26)) }
    } else {
      v.cara = (this.reloj % 4) < 1.3 ? 'contenta' : 'feliz'
      if (this.proxEfecto <= 0) { this.proxEfecto = 1; this.chispa(arriba.x + entre(-140, 140), arriba.y + entre(0, 340), entre(10, 16)) }
    }
  }

  private avanzarVaso(v: Vaso, dt: number, recibe: boolean) {
    const altoLiq = alturaDe(v.nivel)
    const sup = FONDO_Y - altoLiq

    // Espuma: crece rápido con el chorro y se asienta despacio, pero una
    // cerveza servida nunca se queda sin corona.
    const metaEspuma = v.nivel < 0.004 ? 0 : Math.min(54, 6 + altoLiq * 0.36)
    if (recibe) v.espuma = acercar(v.espuma, metaEspuma, 0.45, dt)
    else {
      const meta = Math.max(metaEspuma * 0.6, Math.min(v.espuma, metaEspuma * 0.85))
      v.espuma = acercar(v.espuma, meta, v.espuma < meta ? 1.2 : 14, dt)
    }
    if (v.nivel < 0.004) v.espuma = acercar(v.espuma, 0, 0.3, dt)
    v.remolino = acercar(v.remolino, recibe ? 1 : 0, recibe ? 0.3 : 0.9, dt)
    if (v.nivel > 0.02) v.frio = Math.min(1, v.frio + dt / 5)

    // Burbujas: pocas y grandes, con brillito. En un dibujo se lee mejor
    // una burbuja clara que cien puntitos.
    if (altoLiq > 10) {
      const mult = this.reducido ? 0.4 : 1
      const n = ((6 + altoLiq * 0.025) + (recibe ? 26 : 0)) * mult * dt
      for (let k = 0; k < Math.floor(n) + (rnd() < n % 1 ? 1 : 0); k++) {
        v.burbujas.push({ x: entre(-0.8, 0.8), y: FONDO_Y - rnd() * altoLiq * 0.85, r: entre(2.5, 6), v: entre(60, 130), fase: rnd() * 6 })
      }
    }
    for (const b of v.burbujas) { b.y -= b.v * dt; b.fase += dt * 5 }
    v.burbujas = v.burbujas.filter(b => b.y > sup + 6)
    if (v.burbujas.length > 90) v.burbujas.splice(0, v.burbujas.length - 90)

    // ── El cuerpo ─────────────────────────────────────────────────────────
    // Salto: gravedad y, al caer, se aplasta y la cerveza se sacude.
    if (v.alto < 0 || v.valto < 0) {
      v.valto += SALTO_G * dt
      v.alto += v.valto * dt
      if (v.alto >= 0) {
        v.vsq += v.valto * 0.0055
        v.vola += (rnd() < 0.5 ? -1 : 1) * v.valto * 0.002
        v.alto = 0; v.valto = 0
      }
    }
    if (recibe && !this.reducido) v.vsq += (rnd() - 0.5) * dt * 40
    const fsq = -320 * v.sq - 15 * v.vsq
    v.vsq += fsq * dt
    v.sq = Math.max(-0.2, Math.min(0.28, v.sq + v.vsq * dt))

    // Inclinación del cuerpo según el humor.
    const t = this.reloj + v.semilla
    let rot = Math.sin(t * 1.4) * 0.02
    if (v.cara === 'canta') rot = Math.sin(t * 4) * 0.07
    else if (v.cara === 'nerviosa') rot = Math.sin(t * 38) * 0.012
    else if (v.cara === 'emocionada' || v.cara === 'orgullosa') rot = Math.sin(t * 5) * 0.04
    else if (v.cara === 'dormida') rot = 0.05
    if (v.t < 1) rot = v.saliendo ? 0.14 * Math.sin(v.t * Math.PI) : -0.12 * (1 - v.t)
    v.rot = this.reducido ? 0 : acercar(v.rot, rot, 0.12, dt)

    // El oleaje: un resorte. Moverse de golpe (llegar, irse, saltar) lo excita.
    if (v.t < 1) v.vola += (v.saliendo ? 1 : -1) * dt * 2.4 * Math.sin(v.t * Math.PI * 2)
    const fo = -70 * v.ola - 3.2 * v.vola
    v.vola += fo * dt
    v.ola = Math.max(-0.35, Math.min(0.35, v.ola + v.vola * dt))

    // ── La cara ───────────────────────────────────────────────────────────
    v.mirada.x = acercar(v.mirada.x, v.mirar.x, 0.12, dt)
    v.mirada.y = acercar(v.mirada.y, v.mirar.y, 0.12, dt)
    v.parpadeo -= dt
    if (v.parpadeo <= 0 && v.cerrando === 0) v.cerrando = 0.0001
    if (v.cerrando > 0) {
      v.cerrando += dt / 0.16
      if (v.cerrando >= 1) { v.cerrando = 0; v.parpadeo = rnd() < 0.2 ? 0.25 : entre(2.2, 4.8) }
    }
    v.sudor = acercar(v.sudor, v.cara === 'nerviosa' ? 1 : 0, 0.25, dt)
  }

  private saltar(v: Vaso, h: number) {
    if (this.reducido || v.alto < -1 || v.t < 1) return
    v.valto = -Math.sqrt(2 * SALTO_G * h)
    v.alto = -0.01
    v.vsq -= 3.2
  }

  private golpe(f: number) {
    if (this.reducido) return
    this.vZoom += f
  }

  private chispa(x: number, y: number, tam: number) {
    if (this.reducido && rnd() < 0.6) return
    this.sumar({ tipo: 'chispa', x, y, vx: 0, vy: -10, vida: 0.9, max: 0.9, rot: rnd() * 0.6, vr: 0, tam, color: rnd() < 0.5 ? '#ffffff' : '#ffe58a', g: 0 })
  }

  private sumar(p: Particula) {
    if (this.reducido && (p.tipo === 'confeti' || p.tipo === 'puf' || p.tipo === 'gota')) return
    this.parts.push(p)
    if (this.parts.length > 260) this.parts.splice(0, this.parts.length - 260)
  }

  /** Posición del vaso: entra saltando desde la izquierda, se va saltando a
   *  la derecha. Pasa por delante de la torre. */
  private posicion(v: Vaso) {
    if (v.t >= 1 && !v.saliendo) return { dx: 0, dy: v.alto }
    if (v.saliendo) {
      const k = entrada(v.t)
      return { dx: SALIDA * k, dy: -Math.abs(Math.sin(v.t * Math.PI * 2.5)) * 46 }
    }
    const k = salida(v.t)
    return { dx: -SALIDA * (1 - k), dy: -Math.abs(Math.sin(v.t * Math.PI * 2)) * 56 * (1 - v.t) + v.alto }
  }

  /** Dónde queda la boca del vaso en la escena: para ubicar los efectos. */
  private cabezaVaso(v: Vaso) {
    const p = this.posicion(v)
    return { x: GX + p.dx, y: BOCA_Y + p.dy }
  }

  /** Dónde pega el chorro: la espuma del vaso si está debajo, si no la bandeja. */
  private impactoY(v: Vaso | undefined): number {
    if (!v) return BANDEJA.y0
    const p = this.posicion(v)
    if (Math.abs(p.dx) > 40) return BANDEJA.y0
    const sup = v.nivel > 0.004 ? FONDO_Y - alturaDe(v.nivel) - v.espuma * 0.5 : FONDO_Y
    return BASE_Y + p.dy + (sup - BASE_Y) * (1 - v.sq)
  }

  // ── Dibujo ───────────────────────────────────────────────────────────────
  private dibujar() {
    const c = this.ctx
    const d = this.dpr
    c.setTransform(d, 0, 0, d, 0, 0)
    c.clearRect(0, 0, this.cssW, this.cssH)
    if (!this.placa) this.prepararPlaca()

    // La cámara: escala de la escena, golpe de zoom y temblor.
    const z = this.zoom
    const tx = this.temblor > 0 ? (rnd() - 0.5) * this.temblor * 10 : 0
    const ty = this.temblor > 0 ? (rnd() - 0.5) * this.temblor * 10 : 0
    const foco = { x: GX, y: 640 }
    const fx = this.ox + foco.x * this.esc, fy = this.oy + foco.y * this.esc
    c.save()
    c.translate(fx + tx, fy + ty)
    c.scale(this.esc * z, this.esc * z)
    c.translate(-foco.x, -foco.y)

    this.dibujarRayos(c)
    this.dibujarFlotantes(c)
    this.dibujarMostrador(c, z)
    this.dibujarTorre(c)
    this.dibujarManija(c)
    this.dibujarBandeja(c)

    const orden = [...this.vasos].sort((a, b) => Number(a.saliendo) - Number(b.saliendo))
    for (const v of orden) this.dibujarSombra(c, v)
    for (const v of orden) this.dibujarVaso(c, v, 'atras')
    this.dibujarChorro(c)
    for (const v of orden) this.dibujarVaso(c, v, 'frente')
    for (const g of this.gotas) this.gotaDibujo(c, g.x, g.y, 4.5, css(this.pal.luz))
    this.dibujarParticulas(c)
    c.restore()

    this.dibujarLineas(c, fx, fy)
    if (this.apagado > 0.01) {
      c.fillStyle = `rgba(6,8,18,${0.5 * this.apagado})`
      c.fillRect(0, 0, this.cssW, this.cssH)
    }
  }

  /** Rayos de fondo, como en el anime cuando algo es importante. */
  private dibujarRayos(c: CanvasRenderingContext2D) {
    const cx = GX, cy = 640, R = 1300
    const g = c.createRadialGradient(cx, cy, 40, cx, cy, R)
    const col = this.pal.brillo
    const fuerza = this.fiesta > 0 ? 0.3 : this.entrada.modo === 'lista' || this.fluyendo ? 0.2 : 0.13
    g.addColorStop(0, css(col, fuerza))
    g.addColorStop(0.35, css(col, fuerza * 0.45))
    g.addColorStop(1, css(col, 0))
    c.fillStyle = g
    c.beginPath()
    const n = 18
    for (let i = 0; i < n; i++) {
      const a0 = this.rayosAng + (i / n) * Math.PI * 2
      const a1 = a0 + (Math.PI * 2 / n) * 0.5
      c.moveTo(cx, cy)
      c.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R)
      c.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R)
      c.closePath()
    }
    c.fill()
    // Un círculo de luz detrás del vaso: separa al personaje del fondo.
    const h = c.createRadialGradient(cx, cy, 0, cx, cy, 300)
    h.addColorStop(0, css(mezclar(col, [255, 255, 255], 0.4), 0.32))
    h.addColorStop(1, css(col, 0))
    c.fillStyle = h
    c.fillRect(cx - 300, cy - 300, 600, 600)
  }

  private dibujarFlotantes(c: CanvasRenderingContext2D) {
    const col = mezclar(this.pal.brillo, [255, 255, 255], 0.5)
    for (const f of this.flotan) {
      const parpadeo = 0.5 + 0.5 * Math.sin(this.reloj * 2 + f.fase)
      if (f.estrella) {
        this.estrella4(c, f.x, f.y, f.r * 0.5 * (0.6 + parpadeo * 0.6), css(col, 0.25 + parpadeo * 0.35), null)
      } else {
        c.beginPath()
        c.arc(f.x + Math.sin(this.reloj + f.fase) * 10, f.y, f.r, 0, Math.PI * 2)
        c.fillStyle = css(col, 0.05)
        c.fill()
        c.lineWidth = 2
        c.strokeStyle = css(col, 0.16)
        c.stroke()
      }
    }
  }

  private dibujarMostrador(c: CanvasRenderingContext2D, z: number) {
    const izq = (-this.ox / this.esc) / z - 400
    const der = ((this.cssW - this.ox) / this.esc) / z + 400
    const abajo = (this.cssH - this.oy) / this.esc / z + 400
    // Tapa: madera clara con un filo de luz.
    c.fillStyle = '#c98a4b'
    c.fillRect(izq, MOSTRADOR_Y, der - izq, 26)
    c.fillStyle = '#f0b97c'
    c.fillRect(izq, MOSTRADOR_Y, der - izq, 6)
    // Frente: se oscurece hasta el color del panel de texto.
    const g = c.createLinearGradient(0, MOSTRADOR_Y + 26, 0, MOSTRADOR_Y + 260)
    g.addColorStop(0, '#6b3d22')
    g.addColorStop(0.4, '#3a2216')
    g.addColorStop(1, '#0e1316')
    c.fillStyle = g
    c.fillRect(izq, MOSTRADOR_Y + 26, der - izq, abajo - MOSTRADOR_Y)
    c.strokeStyle = TINTA
    c.lineWidth = 4
    c.beginPath()
    c.moveTo(izq, MOSTRADOR_Y); c.lineTo(der, MOSTRADOR_Y)
    c.moveTo(izq, MOSTRADOR_Y + 26); c.lineTo(der, MOSTRADOR_Y + 26)
    c.stroke()
    // Vetas: dos trazos sueltos, como en un fondo de anime.
    c.strokeStyle = 'rgba(28,18,38,0.35)'
    c.lineWidth = 3
    c.beginPath()
    c.moveTo(20, MOSTRADOR_Y + 13); c.lineTo(120, MOSTRADOR_Y + 13)
    c.moveTo(470, MOSTRADOR_Y + 15); c.lineTo(560, MOSTRADOR_Y + 15)
    c.stroke()
  }

  /** Cromo de dibujo animado: plano, con una franja de sombra y una de brillo. */
  private cromo(c: CanvasRenderingContext2D, camino: () => void, x0: number, x1: number, vertical = true, y0 = 0, y1 = 0) {
    c.save()
    camino()
    c.fillStyle = '#b9c5d8'
    c.fill()
    c.clip()
    c.fillStyle = '#7f8ca6'
    if (vertical) c.fillRect(x0 + (x1 - x0) * 0.64, -2000, x1 - x0, 4000)
    else c.fillRect(-2000, y0 + (y1 - y0) * 0.62, 4000, y1 - y0)
    c.fillStyle = 'rgba(255,255,255,0.95)'
    if (vertical) c.fillRect(x0 + (x1 - x0) * 0.16, -2000, Math.max(4, (x1 - x0) * 0.13), 4000)
    else c.fillRect(-2000, y0 + (y1 - y0) * 0.18, 4000, Math.max(3, (y1 - y0) * 0.16))
    c.restore()
    camino()
    c.strokeStyle = TINTA
    c.lineWidth = 5
    c.stroke()
  }

  private dibujarTorre(c: CanvasRenderingContext2D) {
    const { x0, x1, y0, y1 } = TORRE
    const r = (x1 - x0) / 2
    // Cuerpo con cúpula
    this.cromo(c, () => {
      c.beginPath()
      c.moveTo(x0, y1)
      c.lineTo(x0, y0)
      c.arc(x0 + r, y0, r, Math.PI, 0)
      c.lineTo(x1, y1)
      c.closePath()
    }, x0, x1)
    // Brillo de la cúpula
    c.beginPath()
    c.ellipse(x0 + r * 0.62, y0 - r * 0.45, 7, 11, -0.5, 0, Math.PI * 2)
    c.fillStyle = '#fff'
    c.fill()
    // Anillo de la base
    this.cromo(c, () => {
      c.beginPath()
      c.roundRect(x0 - 16, y1 - 22, x1 - x0 + 32, 24, 8)
    }, x0 - 16, x1 + 16)
    // Brazo hacia el pico
    this.cromo(c, () => {
      c.beginPath()
      c.roundRect(GX - 22, BRAZO.y0, x0 + 6 - (GX - 22), BRAZO.y1 - BRAZO.y0, 15)
    }, 0, 0, false, BRAZO.y0, BRAZO.y1)
    // Pico
    this.cromo(c, () => {
      c.beginPath()
      c.moveTo(GX - 15, BRAZO.y1 - 4)
      c.lineTo(GX - 11, PICO_Y - 6)
      c.lineTo(GX + 11, PICO_Y - 6)
      c.lineTo(GX + 15, BRAZO.y1 - 4)
      c.closePath()
    }, GX - 15, GX + 15)
    this.cromo(c, () => {
      c.beginPath()
      c.roundRect(GX - 14, PICO_Y - 10, 28, 12, 5)
    }, GX - 14, GX + 14)
  }

  private dibujarManija(c: CanvasRenderingContext2D) {
    c.save()
    c.translate(PIVOTE.x, PIVOTE.y)
    c.rotate(this.angulo)
    // Virola de cromo
    this.cromo(c, () => { c.beginPath(); c.roundRect(-15, -30, 30, 32, 6) }, -15, 15)
    // Cuerpo: laca negra, más ancho arriba
    const cuerpo = () => {
      c.beginPath()
      c.moveTo(-12, -28)
      c.lineTo(-19, -168)
      c.quadraticCurveTo(-19, -186, 0, -188)
      c.quadraticCurveTo(19, -186, 19, -168)
      c.lineTo(12, -28)
      c.closePath()
    }
    c.save()
    cuerpo()
    c.fillStyle = '#2a2236'
    c.fill()
    c.clip()
    c.fillStyle = '#17121f'
    c.fillRect(6, -200, 30, 200)
    c.fillStyle = 'rgba(255,255,255,0.4)'
    c.fillRect(-13, -180, 4, 150)
    c.restore()
    // La placa con el nombre
    const py0 = -160, py1 = -58
    c.save()
    c.beginPath()
    c.roundRect(-15, py0, 30, py1 - py0, 5)
    c.fillStyle = css(this.pal.base)
    c.fill()
    c.clip()
    if (this.placa) {
      c.save()
      c.translate(0, (py0 + py1) / 2)
      c.rotate(-Math.PI / 2)
      c.drawImage(this.placa, -(py1 - py0) / 2 + 4, -11, py1 - py0 - 8, 22)
      c.restore()
    }
    c.restore()
    c.beginPath()
    c.roundRect(-15, py0, 30, py1 - py0, 5)
    c.lineWidth = 3
    c.strokeStyle = TINTA
    c.stroke()
    cuerpo()
    c.lineWidth = 5
    c.stroke()
    // Bolita de arriba
    c.beginPath()
    c.arc(0, -190, 9, 0, Math.PI * 2)
    c.fillStyle = '#d7dfeb'
    c.fill()
    c.lineWidth = 4
    c.stroke()
    c.restore()

    // Líneas de movimiento si la manija se mueve rápido
    const vel = Math.abs(this.velAngulo)
    if (vel > 1.2 && !this.reducido) {
      const a = Math.min(1, (vel - 1.2) / 3)
      c.save()
      c.translate(PIVOTE.x, PIVOTE.y)
      c.strokeStyle = `rgba(255,255,255,${0.8 * a})`
      c.lineWidth = 4
      c.lineCap = 'round'
      const sentido = Math.sign(this.velAngulo)
      for (let i = 0; i < 3; i++) {
        const rr = 150 + i * 22
        const a0 = this.angulo - Math.PI / 2 - sentido * 0.12
        c.beginPath()
        c.arc(0, 0, rr, a0 - sentido * 0.35, a0, sentido < 0)
        c.stroke()
      }
      c.restore()
    }
  }

  private dibujarBandeja(c: CanvasRenderingContext2D) {
    const { x0, x1, y0, y1 } = BANDEJA
    c.beginPath()
    c.roundRect(x0, y0, x1 - x0, y1 - y0, 5)
    c.fillStyle = '#3d3550'
    c.fill()
    c.fillStyle = '#5c5275'
    c.fillRect(x0 + 4, y0 + 3, x1 - x0 - 8, 5)
    c.strokeStyle = 'rgba(20,14,30,0.6)'
    c.lineWidth = 2
    c.beginPath()
    for (let x = x0 + 16; x < x1 - 8; x += 14) { c.moveTo(x, y0 + 9); c.lineTo(x, y1 - 4) }
    c.stroke()
    c.beginPath()
    c.roundRect(x0, y0, x1 - x0, y1 - y0, 5)
    c.strokeStyle = TINTA
    c.lineWidth = 4
    c.stroke()
  }

  private dibujarSombra(c: CanvasRenderingContext2D, v: Vaso) {
    const p = this.posicion(v)
    const alto = Math.min(1, -p.dy / 160)
    c.beginPath()
    c.ellipse(GX + p.dx, BASE_Y + 3, R_BASE * 1.2 * (1 - alto * 0.45), 9 * (1 - alto * 0.45), 0, 0, Math.PI * 2)
    c.fillStyle = `rgba(20,10,30,${0.45 * (1 - alto * 0.6)})`
    c.fill()
  }

  private caminoVaso(c: CanvasRenderingContext2D) {
    c.beginPath()
    c.moveTo(GX - R_BOCA, BOCA_Y)
    c.lineTo(GX - R_BASE, BASE_Y - 16)
    c.quadraticCurveTo(GX - R_BASE + 1, BASE_Y, GX - R_BASE + 16, BASE_Y)
    c.lineTo(GX + R_BASE - 16, BASE_Y)
    c.quadraticCurveTo(GX + R_BASE - 1, BASE_Y, GX + R_BASE, BASE_Y - 16)
    c.lineTo(GX + R_BOCA, BOCA_Y)
  }

  private caminoInterior(c: CanvasRenderingContext2D) {
    const a = rInt(BOCA_Y), b = rInt(FONDO_Y)
    c.beginPath()
    c.moveTo(GX - a, BOCA_Y - 40)
    c.lineTo(GX - a, BOCA_Y)
    c.lineTo(GX - b, FONDO_Y - 12)
    c.quadraticCurveTo(GX - b, FONDO_Y, GX - b + 12, FONDO_Y)
    c.lineTo(GX + b - 12, FONDO_Y)
    c.quadraticCurveTo(GX + b, FONDO_Y, GX + b, FONDO_Y - 12)
    c.lineTo(GX + a, BOCA_Y)
    c.lineTo(GX + a, BOCA_Y - 40)
    c.closePath()
  }

  private dibujarVaso(c: CanvasRenderingContext2D, v: Vaso, capa: 'atras' | 'frente') {
    const p = this.posicion(v)
    const respiro = this.reducido ? 0 : Math.sin(this.reloj * 2.3 + v.semilla) * (v.cara === 'dormida' ? 0.03 : 0.012)
    const s = v.sq + respiro
    c.save()
    c.translate(GX + p.dx, BASE_Y + p.dy)
    c.rotate(v.rot)
    c.scale(1 + s, 1 - s)
    c.translate(-GX, -BASE_Y)
    if (capa === 'atras') this.vasoAtras(c, v)
    else this.vasoFrente(c, v)
    c.restore()
  }

  private superficie(v: Vaso, x: number, sup: number) {
    const t = this.reloj
    const amp = 2.5 + v.remolino * 5 + Math.abs(v.ola) * 10
    return sup + (x - GX) * v.ola * 0.5 + Math.sin((x - GX) * 0.06 + t * 5) * amp * 0.5 + Math.sin((x - GX) * 0.11 - t * 3.4) * amp * 0.3
  }

  private vasoAtras(c: CanvasRenderingContext2D, v: Vaso) {
    const pal = this.pal
    // Vidrio de atrás: un celeste muy suave
    this.caminoVaso(c)
    c.closePath()
    c.fillStyle = 'rgba(200,232,255,0.13)'
    c.fill()
    // Borde de atrás de la boca
    c.beginPath()
    c.ellipse(GX, BOCA_Y, R_BOCA, 15, 0, Math.PI, Math.PI * 2)
    c.strokeStyle = 'rgba(190,225,255,0.7)'
    c.lineWidth = 3
    c.stroke()

    if (v.nivel <= 0.004 && v.espuma < 1) return
    const sup = FONDO_Y - alturaDe(v.nivel)
    c.save()
    this.caminoInterior(c)
    c.clip()
    // El líquido: color plano, sombra dura a la derecha, brillo a la izquierda
    const paso = 8
    const camLiq = () => {
      c.beginPath()
      c.moveTo(GX - 160, FONDO_Y + 10)
      for (let x = GX - 160; x <= GX + 160; x += paso) c.lineTo(x, this.superficie(v, x, sup))
      c.lineTo(GX + 160, FONDO_Y + 10)
      c.closePath()
    }
    camLiq()
    c.fillStyle = css(pal.base)
    c.fill()
    c.save()
    camLiq()
    c.clip()
    // Franja de luz debajo de la superficie
    const g = c.createLinearGradient(0, sup - 10, 0, sup + 70)
    g.addColorStop(0, css(pal.brillo, 0.85))
    g.addColorStop(1, css(pal.brillo, 0))
    c.fillStyle = g
    c.fillRect(GX - 160, sup - 20, 320, 90)
    // Sombra dura (cel) a la derecha
    c.fillStyle = css(pal.hondo, 0.5)
    c.beginPath()
    c.moveTo(GX + 46, sup - 30); c.lineTo(GX + 34, FONDO_Y + 10); c.lineTo(GX + 200, FONDO_Y + 10); c.lineTo(GX + 200, sup - 30)
    c.fill()
    // Brillo vertical a la izquierda
    c.fillStyle = css(pal.luz, 0.75)
    c.beginPath()
    c.moveTo(GX - 92, sup - 30); c.lineTo(GX - 66, sup - 30); c.lineTo(GX - 52, FONDO_Y + 10); c.lineTo(GX - 74, FONDO_Y + 10)
    c.fill()
    // Remolinos cuando cae el chorro
    if (v.remolino > 0.05) {
      c.strokeStyle = `rgba(255,255,255,${0.45 * v.remolino})`
      c.lineWidth = 4
      c.lineCap = 'round'
      for (let i = 0; i < 3; i++) {
        const a = this.reloj * (5 + i) + i * 2
        const cy = sup + 40 + i * 34
        if (cy > FONDO_Y - 10) break
        c.beginPath()
        c.ellipse(GX + Math.sin(a * 0.5) * 20, cy, 30 - i * 5, 10, 0, a, a + 2.2)
        c.stroke()
      }
    }
    // Burbujas: aro blanco con brillito
    for (const b of v.burbujas) {
      const x = GX + b.x * rInt(b.y) + Math.sin(b.fase) * 3
      c.beginPath()
      c.arc(x, b.y, b.r, 0, Math.PI * 2)
      c.strokeStyle = 'rgba(255,255,255,0.75)'
      c.lineWidth = 1.8
      c.stroke()
      c.fillStyle = 'rgba(255,255,255,0.9)'
      c.fillRect(x - b.r * 0.45, b.y - b.r * 0.55, b.r * 0.4, b.r * 0.4)
    }
    c.restore()
    c.restore()

    // Espuma: una nube de dibujo animado. Llena, se asoma por encima del borde.
    if (v.espuma > 1) this.dibujarEspuma(c, v, sup)
  }

  private dibujarEspuma(c: CanvasRenderingContext2D, v: Vaso, sup: number) {
    const pal = this.pal
    const r = rInt(Math.max(BOCA_Y, sup)) + 1
    const x0 = GX - r, x1 = GX + r
    const arriba = sup - v.espuma
    const domo = Math.max(0, Math.min(34, (LLENO_Y + 30 - arriba) * 0.9))
    const n = 7
    const t = this.reloj
    const tope = (u: number) => arriba - domo * (1 - u * u)
    const camino = () => {
      c.beginPath()
      c.moveTo(x0, this.superficie(v, x0, sup))
      c.lineTo(x0, tope(-1) + 8)
      for (let i = 0; i < n; i++) {
        const ua = -1 + (2 * i) / n, ub = -1 + (2 * (i + 1)) / n
        const xa = GX + ua * r, xb = GX + ub * r
        const bulto = 13 + Math.sin(t * 2.4 + i * 1.7 + v.semilla) * 2.5
        c.quadraticCurveTo((xa + xb) / 2, Math.min(tope(ua), tope(ub)) - bulto, xb, tope(ub) + (i === n - 1 ? 8 : 0))
      }
      c.lineTo(x1, this.superficie(v, x1, sup))
      for (let x = x1; x >= x0; x -= 8) c.lineTo(x, this.superficie(v, x, sup))
      c.closePath()
    }
    c.save()
    camino()
    c.fillStyle = css(pal.espuma)
    c.fill()
    c.clip()
    // Sombra de abajo (cel) y brillos arriba
    c.fillStyle = css(pal.espumaBaja, 0.85)
    c.fillRect(x0 - 20, sup - v.espuma * 0.38, 2 * r + 40, v.espuma + 30)
    c.fillStyle = 'rgba(255,255,255,0.95)'
    for (let i = 0; i < 3; i++) {
      const u = -0.7 + i * 0.5
      c.beginPath()
      c.ellipse(GX + u * r, tope(u) - 4, 9, 4.5, -0.3, 0, Math.PI * 2)
      c.fill()
    }
    // Burbujitas de la espuma
    c.strokeStyle = css(mezclar(pal.espumaBaja, TINTA_RGB, 0.3), 0.6)
    c.lineWidth = 1.6
    const az = azar(v.semilla * 31)
    for (let i = 0; i < 9; i++) {
      const u = az() * 1.7 - 0.85
      const yy = sup - az() * v.espuma * 0.8
      c.beginPath()
      c.arc(GX + u * r, yy, 2 + az() * 3, 0, Math.PI * 2)
      c.stroke()
    }
    c.restore()
    camino()
    c.strokeStyle = TINTA
    c.lineWidth = 4
    c.lineJoin = 'round'
    c.stroke()
  }

  private vasoFrente(c: CanvasRenderingContext2D, v: Vaso) {
    // Vidrio: base gruesa, bordes celestes, dos brillos blancos en diagonal.
    c.save()
    this.caminoVaso(c)
    c.closePath()
    c.clip()
    c.fillStyle = 'rgba(190,225,255,0.35)'
    c.fillRect(GX - 200, FONDO_Y, 400, 60)
    c.fillStyle = 'rgba(255,255,255,0.8)'
    c.beginPath()
    c.moveTo(GX - 100, BOCA_Y + 26); c.lineTo(GX - 82, BOCA_Y + 26); c.lineTo(GX - 66, BOCA_Y + 300); c.lineTo(GX - 82, BOCA_Y + 300)
    c.closePath()
    c.moveTo(GX - 70, BOCA_Y + 40); c.lineTo(GX - 62, BOCA_Y + 40); c.lineTo(GX - 52, BOCA_Y + 170); c.lineTo(GX - 60, BOCA_Y + 170)
    c.closePath()
    c.fill()
    c.fillStyle = 'rgba(170,215,255,0.28)'
    c.beginPath()
    c.moveTo(GX + R_BOCA - 26, BOCA_Y); c.lineTo(GX + R_BOCA, BOCA_Y); c.lineTo(GX + R_BASE, BASE_Y); c.lineTo(GX + R_BASE - 22, BASE_Y)
    c.fill()
    c.restore()
    // Línea del fondo grueso
    c.beginPath()
    c.moveTo(GX - rInt(FONDO_Y) + 4, FONDO_Y + 2)
    c.quadraticCurveTo(GX, FONDO_Y + 12, GX + rInt(FONDO_Y) - 4, FONDO_Y + 2)
    c.strokeStyle = 'rgba(160,210,255,0.8)'
    c.lineWidth = 3
    c.stroke()
    // Gotitas de frío
    if (v.frio > 0.2) {
      const az = azar(v.semilla * 13)
      for (let i = 0; i < 5; i++) {
        const y = BOCA_Y + 60 + az() * 300
        const lado = az() < 0.5 ? -1 : 1
        const x = GX + lado * (rExt(y) - 10 - az() * 14)
        this.gotaDibujo(c, x, y + Math.min(30, (this.reloj * (4 + i)) % 40), 4 + az() * 2.5, `rgba(235,248,255,${0.75 * v.frio})`, 2)
      }
    }
    // Contorno
    this.caminoVaso(c)
    c.strokeStyle = TINTA
    c.lineWidth = 5.5
    c.lineJoin = 'round'
    c.stroke()
    // Boca: el arco de adelante
    c.beginPath()
    c.ellipse(GX, BOCA_Y, R_BOCA, 15, 0, 0, Math.PI)
    c.stroke()
    c.beginPath()
    c.ellipse(GX, BOCA_Y + 3, R_BOCA - 8, 10, 0, 0.15 * Math.PI, 0.55 * Math.PI)
    c.strokeStyle = 'rgba(255,255,255,0.9)'
    c.lineWidth = 3
    c.stroke()

    this.dibujarCara(c, v)
  }

  // ── La cara ──────────────────────────────────────────────────────────────
  /** Un trazo que se lee sobre cualquier cerveza: halo claro y tinta encima. */
  private trazo(c: CanvasRenderingContext2D, camino: () => void, ancho: number) {
    camino()
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.strokeStyle = 'rgba(255,248,235,0.55)'
    c.lineWidth = ancho + 5
    c.stroke()
    c.strokeStyle = TINTA
    c.lineWidth = ancho
    c.stroke()
  }

  private dibujarCara(c: CanvasRenderingContext2D, v: Vaso) {
    const t = this.reloj
    const cara = v.cara
    let fy = CARA_Y
    let fx = GX
    if (cara === 'nerviosa' && !this.reducido) { fx += (rnd() - 0.5) * 2.5; fy += (rnd() - 0.5) * 2 }
    const parp = v.cerrando > 0 ? Math.sin(v.cerrando * Math.PI) : 0

    type Ojo = 'normal' | 'feliz' | 'estrella' | 'nervioso' | 'dormido'
    let izq: Ojo = 'normal', der: Ojo = 'normal'
    let boca: 'gato' | 'sonrisa' | 'chica' | 'grande' | 'abierta' | 'ondulada' | 'o' = 'sonrisa'
    let rubor = 0.6
    switch (cara) {
      case 'feliz': boca = 'gato'; break
      case 'canta': izq = der = 'feliz'; boca = 'abierta'; rubor = 0.8; break
      case 'guino': der = 'feliz'; boca = 'sonrisa'; rubor = 0.9; break
      case 'emocionada': izq = der = 'estrella'; boca = 'grande'; rubor = 1; break
      case 'recibiendo': izq = der = 'feliz'; boca = 'grande'; rubor = 1; break
      case 'nerviosa': izq = der = 'nervioso'; boca = 'ondulada'; rubor = 0.3; break
      case 'esperando': boca = 'chica'; rubor = 0.5; break
      case 'orgullosa': izq = der = 'estrella'; boca = 'grande'; rubor = 1; break
      case 'contenta': der = 'feliz'; boca = 'grande'; rubor = 0.8; break
      case 'chau': izq = der = 'feliz'; boca = 'sonrisa'; rubor = 0.7; break
      case 'dormida': izq = der = 'dormido'; boca = 'o'; rubor = 0.4; break
    }

    // Cachetes: rosado con rayitas, el rubor del anime
    if (rubor > 0) {
      for (const lado of [-1, 1]) {
        const cx = fx + lado * 74, cy = fy + 24
        c.beginPath()
        c.ellipse(cx, cy, 21, 11, 0, 0, Math.PI * 2)
        c.fillStyle = `rgba(255,105,140,${0.5 * rubor})`
        c.fill()
        c.strokeStyle = `rgba(200,40,80,${0.55 * rubor})`
        c.lineWidth = 2.5
        c.lineCap = 'round'
        c.beginPath()
        for (let i = -1; i <= 1; i++) { c.moveTo(cx + i * 8 - 3, cy + 5); c.lineTo(cx + i * 8 + 3, cy - 5) }
        c.stroke()
      }
    }

    this.ojo(c, fx - 46, fy - 12, -1, izq, v, parp)
    this.ojo(c, fx + 46, fy - 12, 1, der, v, parp)

    // Cejas de preocupación
    if (cara === 'nerviosa') {
      for (const lado of [-1, 1]) {
        this.trazo(c, () => {
          c.beginPath()
          c.moveTo(fx + lado * 30, fy - 60)
          c.lineTo(fx + lado * 64, fy - 52)
        }, 4.5)
      }
    }

    // Boca
    const by = fy + 34
    if (boca === 'gato') {
      this.trazo(c, () => {
        c.beginPath()
        c.moveTo(fx - 17, by - 3)
        c.quadraticCurveTo(fx - 8, by + 9, fx, by - 1)
        c.quadraticCurveTo(fx + 8, by + 9, fx + 17, by - 3)
      }, 4.5)
    } else if (boca === 'sonrisa') {
      this.trazo(c, () => { c.beginPath(); c.moveTo(fx - 20, by - 3); c.quadraticCurveTo(fx, by + 15, fx + 20, by - 3) }, 5)
    } else if (boca === 'chica') {
      this.trazo(c, () => { c.beginPath(); c.moveTo(fx - 10, by); c.quadraticCurveTo(fx, by + 7, fx + 10, by) }, 4.5)
    } else if (boca === 'ondulada') {
      this.trazo(c, () => {
        c.beginPath()
        c.moveTo(fx - 22, by + 2)
        for (let i = 1; i <= 6; i++) c.lineTo(fx - 22 + i * 7.3, by + (i % 2 ? -4 : 3))
      }, 4)
    } else {
      // Bocas abiertas: rojo oscuro con lengua
      const abre = boca === 'grande'
        ? (cara === 'recibiendo' ? 0.85 + Math.sin(t * 9) * 0.15 : 1)
        : boca === 'abierta' ? 0.6 + Math.abs(Math.sin(t * 6)) * 0.5 : 0.5 + Math.sin(t * 1.6) * 0.15
      const camino = () => {
        c.beginPath()
        if (boca === 'grande') {
          c.moveTo(fx - 25, by - 6)
          c.lineTo(fx + 25, by - 6)
          c.quadraticCurveTo(fx + 23, by - 6 + 36 * abre, fx, by - 6 + 36 * abre)
          c.quadraticCurveTo(fx - 23, by - 6 + 36 * abre, fx - 25, by - 6)
        } else {
          const rr = boca === 'abierta' ? 12 : 7
          c.ellipse(fx, by + 4, rr, rr * 1.2 * abre + 2, 0, 0, Math.PI * 2)
        }
        c.closePath()
      }
      camino()
      c.strokeStyle = 'rgba(255,248,235,0.55)'
      c.lineWidth = 9
      c.stroke()
      c.save()
      camino()
      c.fillStyle = '#5b1328'
      c.fill()
      c.clip()
      c.beginPath()
      c.ellipse(fx, by + 4 + (boca === 'grande' ? 26 * abre : 10 * abre), 15, 9, 0, 0, Math.PI * 2)
      c.fillStyle = '#ff7d96'
      c.fill()
      c.restore()
      camino()
      c.strokeStyle = TINTA
      c.lineWidth = 4.5
      c.lineJoin = 'round'
      c.stroke()
    }

    // Burbuja de dormir, del costado de la boca
    if (cara === 'dormida' && !this.reducido) {
      const k = 0.5 + 0.5 * Math.sin(t * 1.6)
      c.beginPath()
      c.arc(fx + 30, by - 4, 6 + k * 14, 0, Math.PI * 2)
      c.fillStyle = 'rgba(190,230,255,0.35)'
      c.fill()
      c.strokeStyle = 'rgba(255,255,255,0.85)'
      c.lineWidth = 2.5
      c.stroke()
    }

    // Gota de sudor
    if (v.sudor > 0.05) {
      const caida = (t * 0.6) % 1
      this.gotaDibujo(c, fx + 92, fy - 70 + caida * 26, 13 * v.sudor, '#9fdcff', 3)
    }
  }

  private ojo(c: CanvasRenderingContext2D, cx: number, cy: number, lado: number, tipo: string, v: Vaso, parp: number) {
    const t = this.reloj
    if (tipo === 'feliz') {
      this.trazo(c, () => { c.beginPath(); c.moveTo(cx - 21, cy + 7); c.quadraticCurveTo(cx, cy - 22, cx + 21, cy + 7) }, 6)
      return
    }
    if (tipo === 'dormido') {
      this.trazo(c, () => { c.beginPath(); c.moveTo(cx - 20, cy); c.quadraticCurveTo(cx, cy + 16, cx + 20, cy) }, 5.5)
      return
    }
    const nervioso = tipo === 'nervioso'
    const rx = nervioso ? 27 : 25
    const ry = (nervioso ? 34 : 31) * (tipo === 'normal' ? 1 - parp : 1)
    if (tipo === 'normal' && parp > 0.8) {
      this.trazo(c, () => { c.beginPath(); c.moveTo(cx - 20, cy + 2); c.quadraticCurveTo(cx, cy + 12, cx + 20, cy + 2) }, 5.5)
      return
    }
    const blanco = () => { c.beginPath(); c.ellipse(cx, cy, rx, Math.max(2, ry), 0, 0, Math.PI * 2) }
    blanco()
    c.fillStyle = '#ffffff'
    c.fill()
    c.save()
    blanco()
    c.clip()
    if (tipo === 'estrella') {
      const k = 1 + Math.sin(t * 8) * 0.12
      this.estrella5(c, cx, cy + 2, 20 * k, t * 1.5)
    } else if (nervioso) {
      const jx = this.reducido ? 0 : Math.sin(t * 45) * 1.5
      c.beginPath()
      c.arc(cx + jx, cy + 2, 6.5, 0, Math.PI * 2)
      c.fillStyle = TINTA
      c.fill()
    } else {
      // Iris anime: degradé del tono de la cerveza, pupila y dos brillos.
      const ix = cx + v.mirada.x * 8, iy = cy + 3 + v.mirada.y * 8
      const g = c.createLinearGradient(0, iy - 24, 0, iy + 24)
      g.addColorStop(0, '#24133a')
      g.addColorStop(0.55, css(mezclar(this.pal.base, [36, 19, 58], 0.35)))
      g.addColorStop(1, css(this.pal.brillo))
      c.beginPath()
      c.ellipse(ix, iy, 18, 24, 0, 0, Math.PI * 2)
      c.fillStyle = g
      c.fill()
      c.beginPath()
      c.ellipse(ix, iy - 2, 8.5, 12, 0, 0, Math.PI * 2)
      c.fillStyle = '#120a1c'
      c.fill()
      c.fillStyle = '#ffffff'
      c.beginPath()
      c.ellipse(ix - 7, iy - 10, 7, 9, -0.3, 0, Math.PI * 2)
      c.fill()
      c.beginPath()
      c.arc(ix + 7, iy + 9, 3.2, 0, Math.PI * 2)
      c.fill()
    }
    c.restore()
    blanco()
    c.strokeStyle = TINTA
    c.lineWidth = 4
    c.stroke()
    // Pestaña de arriba, gruesa, con la puntita hacia afuera
    if (ry > 8) {
      this.trazo(c, () => {
        c.beginPath()
        c.ellipse(cx, cy, rx + 1, Math.max(2, ry) + 1, 0, Math.PI * 1.08, Math.PI * 1.92)
        const ax = cx + lado * (rx + 2), ay = cy - ry * 0.35
        c.moveTo(ax, ay)
        c.lineTo(ax + lado * 9, ay - 8)
      }, 6)
    }
  }

  private dibujarChorro(c: CanvasRenderingContext2D) {
    if (this.chorro === 'no') return
    const y0 = this.cola, y1 = this.cabeza
    if (y1 - y0 < 2) return
    const t = this.reloj
    const ancho = (y: number) => 8 + Math.sin(y * 0.07 - t * 22) * 1.4 + (this.chorro === 'bajando' ? 0 : Math.min(2, (y - PICO_Y) * 0.01))
    const camino = () => {
      c.beginPath()
      c.moveTo(GX - ancho(y0), y0)
      for (let y = y0; y <= y1; y += 8) c.lineTo(GX - ancho(y), y)
      c.lineTo(GX - ancho(y1), y1)
      c.arc(GX, y1, ancho(y1), Math.PI, 0, true)
      for (let y = y1; y >= y0; y -= 8) c.lineTo(GX + ancho(y), y)
      c.lineTo(GX + ancho(y0), y0)
      c.closePath()
    }
    c.save()
    camino()
    c.fillStyle = css(this.pal.base)
    c.fill()
    c.clip()
    c.fillStyle = css(this.pal.hondo, 0.5)
    c.fillRect(GX + 3, y0, 20, y1 - y0 + 20)
    c.fillStyle = css(this.pal.brillo)
    c.fillRect(GX - 5, y0, 3.5, y1 - y0 + 20)
    // Rayitas que bajan: el chorro se ve correr
    c.fillStyle = 'rgba(255,255,255,0.75)'
    for (let y = y0 + ((t * 900) % 60); y < y1; y += 60) c.fillRect(GX - 2, y, 2.5, 18)
    c.restore()
    camino()
    c.strokeStyle = TINTA
    c.lineWidth = 3.5
    c.stroke()
  }

  private dibujarParticulas(c: CanvasRenderingContext2D) {
    for (const p of this.parts) {
      const vida = p.vida / p.max
      const a = Math.min(1, vida * 2.5)
      c.save()
      c.globalAlpha = a
      switch (p.tipo) {
        case 'chispa': {
          const k = Math.sin((1 - vida) * Math.PI)
          this.estrella4(c, p.x, p.y, p.tam * k, p.color, TINTA)
          break
        }
        case 'puf': {
          c.beginPath()
          c.arc(p.x, p.y, p.tam * (1.4 - vida * 0.4), 0, Math.PI * 2)
          c.fillStyle = p.color
          c.fill()
          c.strokeStyle = TINTA
          c.lineWidth = 2.5
          c.stroke()
          break
        }
        case 'gota':
          this.gotaDibujo(c, p.x, p.y, p.tam, p.color, 2.5)
          break
        case 'confeti': {
          c.translate(p.x, p.y)
          c.rotate(p.rot)
          c.scale(1, Math.cos(p.rot * 1.7))
          c.fillStyle = p.color
          c.fillRect(-p.tam / 2, -p.tam / 4, p.tam, p.tam / 2)
          c.strokeStyle = TINTA
          c.lineWidth = 1.5
          c.strokeRect(-p.tam / 2, -p.tam / 4, p.tam, p.tam / 2)
          break
        }
        case 'corazon': {
          const k = vida > 0.85 ? 1 + (1 - vida) * 4 : 1 + Math.sin(this.reloj * 10) * 0.06
          c.translate(p.x, p.y)
          c.rotate(p.rot)
          c.scale(k, k)
          this.corazon(c, p.tam, p.color)
          break
        }
        case 'nota': {
          c.translate(p.x, p.y)
          c.rotate(Math.sin(this.reloj * 4 + p.rot) * 0.25)
          this.nota(c, p.tam, p.color)
          break
        }
        case 'z':
        case 'excl': {
          const pop = p.tipo === 'excl' ? Math.min(1.25, (1 - vida) * 10) - Math.max(0, Math.min(0.25, (1 - vida) * 10 - 1)) : 1
          c.translate(p.x, p.y)
          c.rotate(p.tipo === 'excl' ? p.rot : Math.sin(p.rot + this.reloj) * 0.2)
          c.scale(pop, pop)
          c.font = `900 ${p.tam}px "Big Shoulders Display Variable", "Archivo Variable", sans-serif`
          c.textAlign = 'center'
          c.textBaseline = 'middle'
          c.lineJoin = 'round'
          c.lineWidth = p.tam * 0.14
          c.strokeStyle = TINTA
          const txt = p.tipo === 'z' ? 'Z' : '!'
          c.strokeText(txt, 0, 0)
          c.fillStyle = p.color
          c.fillText(txt, 0, 0)
          break
        }
      }
      c.restore()
    }
  }

  /** Líneas de concentración (集中線): el golpe de efecto del manga. */
  private dibujarLineas(c: CanvasRenderingContext2D, cx: number, cy: number) {
    if (this.lineas <= 0.01 || this.reducido) return
    const az = azar(this.lineasSemilla)
    const R = Math.hypot(this.cssW, this.cssH)
    const r0 = Math.min(this.area.x1 - this.area.x0, this.area.y1 - this.area.y0) * 0.42
    c.save()
    c.fillStyle = `rgba(255,255,255,${0.55 * Math.min(1, this.lineas)})`
    c.beginPath()
    for (let i = 0; i < 70; i++) {
      const a = az() * Math.PI * 2
      const ini = r0 * (1 + az() * 0.6)
      const w = 0.004 + az() * 0.01
      c.moveTo(cx + Math.cos(a) * ini, cy + Math.sin(a) * ini)
      c.lineTo(cx + Math.cos(a - w) * R, cy + Math.sin(a - w) * R)
      c.lineTo(cx + Math.cos(a + w) * R, cy + Math.sin(a + w) * R)
      c.closePath()
    }
    c.fill()
    c.restore()
  }

  // ── Formas ───────────────────────────────────────────────────────────────
  private estrella4(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, borde: string | null) {
    if (r <= 0.5) return
    c.beginPath()
    c.moveTo(x, y - r)
    c.quadraticCurveTo(x, y, x + r, y)
    c.quadraticCurveTo(x, y, x, y + r)
    c.quadraticCurveTo(x, y, x - r, y)
    c.quadraticCurveTo(x, y, x, y - r)
    c.closePath()
    c.fillStyle = color
    c.fill()
    if (borde) { c.strokeStyle = borde; c.lineWidth = 2; c.stroke() }
  }

  private estrella5(c: CanvasRenderingContext2D, x: number, y: number, r: number, giro: number) {
    c.beginPath()
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? r * 0.45 : r
      const a = giro + (i / 10) * Math.PI * 2 - Math.PI / 2
      if (i === 0) c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
      else c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    }
    c.closePath()
    c.fillStyle = '#ffd23f'
    c.fill()
    c.strokeStyle = TINTA
    c.lineWidth = 3
    c.lineJoin = 'round'
    c.stroke()
    c.beginPath()
    c.arc(x - r * 0.2, y - r * 0.25, r * 0.16, 0, Math.PI * 2)
    c.fillStyle = '#fff'
    c.fill()
  }

  private gotaDibujo(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, borde = 2.5) {
    if (r < 0.5) return
    c.beginPath()
    c.moveTo(x, y - r * 2.1)
    c.quadraticCurveTo(x + r * 1.05, y - r * 0.4, x + r, y + r * 0.2)
    c.arc(x, y + r * 0.2, r, 0, Math.PI)
    c.quadraticCurveTo(x - r * 1.05, y - r * 0.4, x, y - r * 2.1)
    c.closePath()
    c.fillStyle = color
    c.fill()
    c.strokeStyle = TINTA
    c.lineWidth = borde
    c.stroke()
    c.beginPath()
    c.ellipse(x - r * 0.35, y - r * 0.1, r * 0.22, r * 0.38, -0.3, 0, Math.PI * 2)
    c.fillStyle = 'rgba(255,255,255,0.9)'
    c.fill()
  }

  private corazon(c: CanvasRenderingContext2D, s: number, color: string) {
    c.beginPath()
    c.moveTo(0, s * 0.35)
    c.bezierCurveTo(-s * 0.9, -s * 0.2, -s * 0.45, -s * 0.85, 0, -s * 0.38)
    c.bezierCurveTo(s * 0.45, -s * 0.85, s * 0.9, -s * 0.2, 0, s * 0.35)
    c.closePath()
    c.fillStyle = color
    c.fill()
    c.strokeStyle = TINTA
    c.lineWidth = 3
    c.lineJoin = 'round'
    c.stroke()
    c.beginPath()
    c.ellipse(-s * 0.3, -s * 0.38, s * 0.1, s * 0.15, -0.6, 0, Math.PI * 2)
    c.fillStyle = '#fff'
    c.fill()
  }

  private nota(c: CanvasRenderingContext2D, s: number, color: string) {
    const k = s / 30
    c.beginPath()
    c.ellipse(-6 * k, 10 * k, 8 * k, 6 * k, -0.4, 0, Math.PI * 2)
    c.rect(0.5 * k, -20 * k, 3.5 * k, 30 * k)
    c.moveTo(4 * k, -20 * k)
    c.quadraticCurveTo(16 * k, -14 * k, 12 * k, -2 * k)
    c.quadraticCurveTo(12 * k, -10 * k, 4 * k, -12 * k)
    c.closePath()
    c.fillStyle = color
    c.fill()
    c.strokeStyle = TINTA
    c.lineWidth = 2.5
    c.lineJoin = 'round'
    c.stroke()
  }

  // ── Lo que se pinta una vez ──────────────────────────────────────────────
  /** El nombre de la cerveza para la placa de la manija. */
  private prepararPlaca() {
    const lienzo = document.createElement('canvas')
    const W = 300, H = 76
    lienzo.width = W; lienzo.height = H
    const x = lienzo.getContext('2d')!
    const texto = (this.entrada.etiqueta || 'GRIFO').toUpperCase()
    let tam = 62
    x.font = `800 ${tam}px "Big Shoulders Display Variable", sans-serif`
    const ancho = x.measureText(texto).width
    if (ancho > W - 16) tam = Math.max(26, tam * (W - 16) / ancho)
    x.font = `800 ${tam}px "Big Shoulders Display Variable", sans-serif`
    x.textAlign = 'center'
    x.textBaseline = 'middle'
    const claro = this.pal.luminosidad > 0.5
    x.fillStyle = claro ? TINTA : '#fff8ea'
    x.fillText(texto, W / 2, H / 2 + 3, W - 16)
    this.placa = lienzo
  }

  /** La contrabarra: noche violeta, estantes con botellas y trama de manga. */
  private pintarFondo() {
    const f = this.fondo
    const c = f.getContext('2d')
    if (!c || !this.cssW) return
    const k = f.width / this.cssW
    c.setTransform(k, 0, 0, k, 0, 0)
    const W = this.cssW, H = this.cssH
    const g = c.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#1a1036')
    g.addColorStop(0.45, '#2a1745')
    g.addColorStop(0.75, '#160f22')
    g.addColorStop(1, '#0e1316')
    c.fillStyle = g
    c.fillRect(0, 0, W, H)

    // En coordenadas de la escena, para que los estantes queden detrás de la torre.
    c.save()
    c.translate(this.ox, this.oy)
    c.scale(this.esc, this.esc)
    const izq = -this.ox / this.esc, der = (W - this.ox) / this.esc
    const az = azar(42)
    const colores = ['#3d5a7c', '#6a3f7e', '#7e553a', '#3f7e66', '#8a7a3a', '#7e3a52']
    for (const y of [430, 690]) {
      for (let x = izq + 10; x < der - 20;) {
        const w = 26 + az() * 18, h = 70 + az() * 70
        const col = colores[Math.floor(az() * colores.length)]
        c.globalAlpha = 0.5
        c.beginPath()
        c.roundRect(x, y - h, w, h, [w * 0.35, w * 0.35, 3, 3])
        c.rect(x + w * 0.35, y - h - 26, w * 0.3, 30)
        c.fillStyle = col
        c.fill()
        c.strokeStyle = TINTA
        c.lineWidth = 3
        c.stroke()
        c.fillStyle = 'rgba(255,255,255,0.35)'
        c.fillRect(x + w * 0.18, y - h + 10, 4, h - 20)
        c.fillStyle = 'rgba(255,240,210,0.6)'
        c.fillRect(x + 3, y - h * 0.55, w - 6, h * 0.22)
        x += w + 8 + az() * 22
      }
      c.globalAlpha = 0.85
      c.fillStyle = '#3a2850'
      c.fillRect(izq, y, der - izq, 16)
      c.fillStyle = '#5b4378'
      c.fillRect(izq, y, der - izq, 4)
    }
    c.globalAlpha = 1
    c.restore()

    // Trama de puntos (screentone), más marcada hacia los bordes.
    const cx = this.ox + GX * this.esc, cy = this.oy + 640 * this.esc
    const paso = 12
    c.fillStyle = 'rgba(255,255,255,0.05)'
    const lim = this.area.y1
    for (let y = 0; y < lim; y += paso) {
      for (let x = (y / paso) % 2 ? paso / 2 : 0; x < W; x += paso) {
        const d = Math.hypot(x - cx, y - cy) / Math.max(W, lim)
        const r = Math.max(0, (d - 0.25) * 4)
        if (r < 0.3) continue
        c.beginPath()
        c.arc(x, y, Math.min(2.6, r), 0, Math.PI * 2)
        c.fill()
      }
    }
  }
}
