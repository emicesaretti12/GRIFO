import { css, mezclar, paleta, type Paleta } from './color'

// ─────────────────────────────────────────────────────────────────────────────
// El motor de la tirada, en estilo caricatura moderna (el de Cartoon Network):
// el vaso es un personaje.
//
// ── Lo que muestra es lo que pasa ───────────────────────────────────────────
// El vaso se llena con los mililitros que mide el caudalímetro, no con un
// temporizador. La manija se abre cuando la medición sube y se cierra cuando
// deja de subir. Si se pasa de un vaso, el lleno se va saltando y entra otro.
// Lo que cambia con el estilo es la actuación, no los datos: la cara y los
// brazos del vaso cuentan en qué está la tirada.
//
//   Libre       saluda, canta, salta, mira para los costados (es la vidriera)
//   Tu turno    estallido, brazos arriba, salta de las ganas
//   Sirviendo   aplaude feliz; cerca del límite, dientes apretados y sudor
//   En pausa    espera mirando la canilla, parpadea
//   Ticket      pinta perfecta: festejo con papelitos; si no, sonríe y saluda
//   Apagada     duerme
//
// ── El estilo ───────────────────────────────────────────────────────────────
// Contorno grueso y parejo, formas geométricas simples y colores planos y
// brillantes: nada de degradés ni de detalles finos. Los personajes (vaso,
// canilla) llevan contorno; el fondo no, así se despegan solos. Ojos blancos
// con un punto negro, cejas sueltas, brazos de fideo con manos redondas.
//
// ── Cómo está hecho ─────────────────────────────────────────────────────────
// Canvas 2D, todo dibujado con trazos (nada de imágenes). Física simple de
// dibujo animado: resortes para estirar y aplastar (squash & stretch), gravedad
// para los saltos, oleaje en la cerveza y brazos que llegan tarde a su pose
// (follow-through). El fondo se pinta una sola vez.
//
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
const HOMBRO_Y = 650
const PICO_Y = 376
const PIVOTE = { x: 300, y: 302 }
const TORRE = { x0: 424, x1: 482, y0: 300, y1: 902 }
const BRAZO = { y0: 304, y1: 336 }
const MOSTRADOR_Y = 902
const BANDEJA = { x0: 158, x1: 442, y0: 884, y1: 904 }
const SALIDA = 760
const CAJA = { x0: 20, x1: 580, y0: 92, y1: 952 }  // lo que tiene que entrar siempre
const FOCO = { x: GX, y: 640 }

const G = 3400                 // gravedad del chorro
const SALTO_G = 2600           // gravedad de los saltos: más blanda, de dibujo animado
const MANIJA_CERRADA = 5 * Math.PI / 180
const MANIJA_ABIERTA = -32 * Math.PI / 180

// ── Colores planos ─────────────────────────────────────────────────────────
const TINTA = '#17121d'
const COL = {
  pared: '#2a9d8f', paredBaja: '#23867a', tabla: '#1e7368', moldura: '#e9c46a',
  halo: '#3dbcad', rayo: '#52cdbd',
  estante: '#b5693c', estanteSombra: '#87492a',
  tapa: '#e08f4f', tapaBrillo: '#f6b781', frente: '#8c4f2b', frenteBajo: '#5c321c', noche: '#0e1316',
  cromo: '#cfd8e6', cromoSombra: '#97a6be', blanco: '#ffffff',
  manija: '#e63946', manijaSombra: '#b02a36', placa: '#fff3d6',
  bandeja: '#4a4458', bandejaBrillo: '#6d6582',
  vidrio: 'rgba(215,242,255,0.3)', vidrioBorde: '#bfe6ff',
  boca: '#3d0f1f', lengua: '#ff6b81', rubor: '#ff8fab', sudor: '#7fd4ff',
  estallido: '#ffd93d', estrella: '#ffd93d',
}
const BOTELLAS = ['#e76f51', '#f4a261', '#e9c46a', '#8ab17d', '#5e60ce', '#ef476f', '#4cc9f0']
const CONFETI = ['#ef476f', '#ffd93d', '#4cc9f0', '#06d6a0', '#9b5de5', '#ff9f1c']

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
type Pose = 'descanso' | 'caidos' | 'arriba' | 'saludo' | 'abiertos' | 'aplaude' | 'nervioso'

type Burbuja = { x: number; y: number; r: number; v: number; fase: number }
type Mano = { x: number; y: number; vx: number; vy: number }
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
  manos: [Mano, Mano]          // relativas al hombro: izquierda, derecha
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
type Gota = { x: number; y: number; vy: number }

const POSE: Record<Cara, Pose> = {
  feliz: 'descanso', canta: 'abiertos', guino: 'saludo', emocionada: 'arriba', recibiendo: 'aplaude',
  nerviosa: 'nervioso', esperando: 'descanso', orgullosa: 'arriba', contenta: 'saludo', chau: 'saludo', dormida: 'caidos',
}

export class Motor {
  readonly tipo = 'caricatura'
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
  private reloj = 0
  private ultimo = 0
  private raf = 0
  private semillas = 1
  private calidad: 'alta' | 'baja' = 'alta'
  private lento = 0

  // Dirección de escena
  private modoPrevio: Modo | null = null
  private rayosAng = 0
  private rayos = 0
  private zoom = 1
  private vZoom = 0
  private temblor = 0
  private estallido = 0
  private apagado = 0
  private fiesta = 0
  private perfecta = false
  private accion: { tipo: 'salto' | 'saludo' | 'mira' | 'canta'; t: number; dur: number } | null = null
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
    if (cambioColor) this.pal = paleta(e.color)
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
        clave, nivel: inicial, espuma: muestra ? 50 : conAlgo ? Math.min(54, 6 + alturaDe(inicial) * 0.3) : 0,
        remolino: 0, frio: conAlgo ? 1 : 0, burbujas: [],
        t: this.vasos.length ? 0 : 1, saliendo: false, semilla: this.semillas++,
        sq: 0, vsq: 0, alto: 0, valto: 0, rot: 0, ola: 0, vola: 0,
        manos: [{ x: -34, y: 84, vx: 0, vy: 0 }, { x: 34, y: 84, vx: 0, vy: 0 }],
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
      if (rnd() < dt * 14) this.sumar({ tipo: 'gota', x: GX, y: impacto - 4, vx: entre(-180, 180), vy: entre(-320, -180), vida: 0.6, max: 0.6, rot: 0, vr: 0, tam: entre(4, 7), color: css(this.pal.base), g: 1500 })
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

    // ── Cámara y fondo ────────────────────────────────────────────────────
    const metaRayos = e.modo === 'apagada' ? 0
      : this.fiesta > 0 || e.modo === 'lista' ? 1
      : this.fluyendo ? 0.7 : 0
    this.rayos = acercar(this.rayos, metaRayos, 0.4, dt)
    if (!this.reducido) this.rayosAng += (0.15 + this.rayos * 0.5 + (this.fiesta > 0 ? 0.8 : 0)) * dt
    const fz = -220 * (this.zoom - 1) - 13 * this.vZoom
    this.vZoom += fz * dt
    this.zoom += this.vZoom * dt
    this.temblor = Math.max(0, this.temblor - dt * 2.2)
    this.estallido = Math.max(0, this.estallido - dt * 0.9)
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
        // Apoyaste la tarjeta: estallido detrás, golpe de cámara y el "!".
        this.golpe(0.9)
        this.estallido = 1
        this.saltar(v, 46)
        this.sumar({ tipo: 'excl', x: arriba.x - 140, y: arriba.y - 30, vx: 0, vy: -20, vida: 1.4, max: 1.4, rot: -0.15, vr: 0, tam: 96, color: COL.estallido, g: 0 })
      } else if (e.modo === 'servida') {
        const resto = e.ml - Math.floor(e.ml / vaso) * vaso
        const cerca = Math.min(resto, vaso - resto) / vaso
        this.perfecta = e.ml >= vaso * 0.97 && cerca <= 0.03
        if (this.perfecta) {
          this.fiesta = 4.5
          this.golpe(1.2)
          this.estallido = 1
          this.temblor = 1
          this.saltar(v, 80)
          if (!quieto) {
            for (let i = 0; i < 90; i++) {
              const a = entre(-Math.PI * 0.95, -Math.PI * 0.05)
              const s = entre(380, 900)
              this.sumar({ tipo: 'confeti', x: arriba.x, y: arriba.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vida: entre(2.2, 3.6), max: 3.6, rot: rnd() * 6, vr: entre(-12, 12), tam: entre(12, 20), color: CONFETI[i % CONFETI.length], g: 900 })
            }
          }
          for (let i = 0; i < 8; i++) this.chispaCerca(arriba, -60, 260, entre(16, 30))
        } else {
          this.saltar(v, 28)
          this.sumar({ tipo: 'corazon', x: arriba.x + 150, y: arriba.y + 40, vx: 0, vy: -50, vida: 2, max: 2, rot: 0.15, vr: 0, tam: 38, color: '#ef476f', g: 0 })
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
        this.sumar({ tipo: 'z', x: arriba.x + 110, y: arriba.y + 60, vx: 18, vy: -45, vida: 2.6, max: 2.6, rot: rnd() * 6, vr: 0, tam: entre(30, 44), color: '#ffffff', g: 0 })
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
          const tipos = ['salto', 'saludo', 'mira', 'canta'] as const
          const tipo = tipos[Math.floor(rnd() * tipos.length)]
          this.accion = { tipo, t: 0, dur: tipo === 'canta' ? 3.2 : tipo === 'salto' ? 1.4 : 2 }
          if (tipo === 'salto') this.saltar(v, 60)
          if (tipo === 'saludo') this.sumar({ tipo: 'corazon', x: arriba.x + 150, y: arriba.y + 30, vx: 10, vy: -60, vida: 1.8, max: 1.8, rot: 0.2, vr: 0, tam: 32, color: '#ef476f', g: 0 })
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
            this.sumar({ tipo: 'nota', x: arriba.x + lado * entre(110, 170), y: arriba.y + entre(20, 100), vx: lado * 20, vy: -70, vida: 2, max: 2, rot: rnd() * 6, vr: 0, tam: entre(30, 40), color: CONFETI[Math.floor(rnd() * 5)], g: 0 })
          }
        } else if (a.tipo === 'saludo') v.cara = 'guino'
        else if (a.tipo === 'mira') { v.cara = 'feliz'; v.mirar = { x: a.t < a.dur / 2 ? -1 : 1, y: -0.2 } }
        else v.cara = 'emocionada'
        if (a.t >= a.dur) { this.accion = null; this.proxAccion = entre(2, 3.8) }
      }
      if (this.proxEfecto <= 0) { this.proxEfecto = 1.4; this.chispaCerca(arriba, 0, 380, entre(12, 20)) }
      return
    }
    this.accion = null

    if (e.modo === 'lista') {
      // Tu turno: brazos arriba, salta de las ganas mirando la canilla.
      v.cara = 'emocionada'
      v.mirar = { x: 0.3, y: -1 }
      if (this.proxSalto <= 0) { this.proxSalto = 1.05; this.saltar(v, 24) }
      if (this.proxEfecto <= 0) { this.proxEfecto = 0.45; this.chispaCerca(arriba, -40, 360, entre(12, 22)) }
      return
    }

    if (e.modo === 'sirviendo') {
      if (this.fluyendo) {
        const nervioso = v.nivel >= 0.86
        v.cara = nervioso ? 'nerviosa' : 'recibiendo'
        v.mirar = { x: 0, y: -1 }
        if (nervioso && this.ultimoLleno < 0.86) { this.golpe(0.4); this.temblor = 0.4 }
        if (this.proxEfecto <= 0 && !nervioso) { this.proxEfecto = 0.6; this.chispaCerca(arriba, 0, 300, entre(12, 18)) }
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
      if (this.proxEfecto <= 0) { this.proxEfecto = this.fiesta > 0 ? 0.15 : 0.7; this.chispaCerca(arriba, -80, 380, entre(14, 26)) }
    } else {
      v.cara = (this.reloj % 4) < 1.6 ? 'contenta' : 'feliz'
      if (this.proxEfecto <= 0) { this.proxEfecto = 1.2; this.chispaCerca(arriba, 0, 340, entre(12, 18)) }
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

    // Burbujas: pocas, redondas y blancas. En una caricatura se lee mejor
    // una burbuja clara que cien puntitos.
    if (altoLiq > 10) {
      const mult = this.reducido ? 0.4 : 1
      const n = ((5 + altoLiq * 0.02) + (recibe ? 20 : 0)) * mult * dt
      for (let k = 0; k < Math.floor(n) + (rnd() < n % 1 ? 1 : 0); k++) {
        v.burbujas.push({ x: entre(-0.8, 0.8), y: FONDO_Y - rnd() * altoLiq * 0.85, r: entre(3, 7), v: entre(60, 130), fase: rnd() * 6 })
      }
    }
    for (const b of v.burbujas) { b.y -= b.v * dt; b.fase += dt * 5 }
    v.burbujas = v.burbujas.filter(b => b.y > sup + 8)
    if (v.burbujas.length > 60) v.burbujas.splice(0, v.burbujas.length - 60)

    // ── El cuerpo ─────────────────────────────────────────────────────────
    // Salto: gravedad y, al caer, se aplasta, levanta polvo y la cerveza se sacude.
    if (v.alto < 0 || v.valto < 0) {
      v.valto += SALTO_G * dt
      v.alto += v.valto * dt
      if (v.alto >= 0) {
        v.vsq += v.valto * 0.0055
        v.vola += (rnd() < 0.5 ? -1 : 1) * v.valto * 0.002
        if (v.valto > 250 && !this.reducido) {
          const x = GX + this.posicion(v).dx
          for (const lado of [-1, 1]) {
            for (let i = 0; i < 2; i++) this.sumar({ tipo: 'puf', x: x + lado * (R_BASE + 6), y: BASE_Y - 6, vx: lado * entre(60, 140), vy: entre(-60, -20), vida: 0.45, max: 0.45, rot: 0, vr: 0, tam: entre(8, 13), color: '#ffffff', g: 120 })
          }
        }
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

    // Los brazos: cada mano va a su pose con un resorte flojo, así llegan
    // tarde y se pasan un poco (follow-through), como en un dibujo animado.
    const pose = POSE[v.cara]
    v.manos.forEach((m, i) => {
      const meta = this.metaMano(pose, i === 0 ? -1 : 1, t)
      if (this.reducido) { m.x = meta.x; m.y = meta.y; return }
      m.vx += (-150 * (m.x - meta.x) - 11 * m.vx) * dt
      m.vy += (-150 * (m.y - meta.y) - 11 * m.vy) * dt
      m.x += m.vx * dt
      m.y += m.vy * dt
    })

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

  /** Dónde va cada mano, relativa a su hombro. `lado`: −1 izquierda, 1 derecha. */
  private metaMano(pose: Pose, lado: number, t: number) {
    const hx = rExt(HOMBRO_Y) - 2
    switch (pose) {
      case 'caidos': return { x: lado * 14, y: 98 }
      case 'arriba': return { x: lado * 62, y: -116 + Math.sin(t * 9 + lado) * 12 }
      case 'saludo':
        return lado > 0
          ? { x: 78 + Math.sin(t * 11) * 26, y: -96 + Math.cos(t * 11) * 6 }
          : { x: -34, y: 84 }
      case 'abiertos': return { x: lado * 100, y: -26 + Math.sin(t * 4 + (lado > 0 ? 0 : Math.PI)) * 22 }
      case 'aplaude': {
        // Las manos se juntan delante del cuerpo, debajo de la boca.
        const sep = 18 + Math.abs(Math.sin(t * 7)) * 34
        return { x: lado * sep - lado * hx, y: 116 }
      }
      case 'nervioso': return { x: -lado * 30 + Math.sin(t * 40) * 2, y: 58 + Math.cos(t * 37) * 2 }
      default: return { x: lado * 36, y: 84 + Math.sin(t * 2 + lado) * 4 }
    }
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

  /** Una estrellita a un costado del vaso: nunca encima de la cara. */
  private chispaCerca(arriba: { x: number; y: number }, y0: number, y1: number, tam: number) {
    const lado = rnd() < 0.5 ? -1 : 1
    this.chispa(arriba.x + lado * entre(150, 215), arriba.y + entre(y0, y1), tam)
  }

  private chispa(x: number, y: number, tam: number) {
    if (this.reducido && rnd() < 0.6) return
    this.sumar({ tipo: 'chispa', x, y, vx: 0, vy: -10, vida: 0.9, max: 0.9, rot: rnd() * 0.6, vr: 0, tam, color: rnd() < 0.5 ? '#ffffff' : COL.estrella, g: 0 })
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
    const fx = this.ox + FOCO.x * this.esc, fy = this.oy + FOCO.y * this.esc
    c.save()
    c.translate(fx + tx, fy + ty)
    c.scale(this.esc * z, this.esc * z)
    c.translate(-FOCO.x, -FOCO.y)

    this.dibujarRayos(c)
    this.dibujarEstallido(c)
    this.dibujarMostrador(c, z)
    this.dibujarTorre(c)
    this.dibujarManija(c)
    this.dibujarBandeja(c)

    const orden = [...this.vasos].sort((a, b) => Number(a.saliendo) - Number(b.saliendo))
    for (const v of orden) this.dibujarSombra(c, v)
    for (const v of orden) this.dibujarVaso(c, v, 'atras')
    this.dibujarChorro(c)
    for (const v of orden) this.dibujarVaso(c, v, 'frente')
    for (const g of this.gotas) this.gotaDibujo(c, g.x, g.y, 5, css(this.pal.base))
    this.dibujarParticulas(c)
    c.restore()

    if (this.apagado > 0.01) {
      c.fillStyle = `rgba(6,8,18,${0.5 * this.apagado})`
      c.fillRect(0, 0, this.cssW, this.cssH)
    }
  }

  /** El círculo de luz detrás del vaso: en los momentos fuertes se llena de
   *  rayos que giran, el recurso más clásico del dibujo animado. */
  private dibujarRayos(c: CanvasRenderingContext2D) {
    if (this.rayos < 0.02) return
    const R = 290
    c.save()
    c.beginPath()
    c.arc(FOCO.x, FOCO.y, R * (0.8 + 0.2 * this.rayos), 0, Math.PI * 2)
    c.clip()
    c.globalAlpha = Math.min(1, this.rayos)
    c.fillStyle = COL.rayo
    c.beginPath()
    const n = 14
    for (let i = 0; i < n; i++) {
      const a0 = this.rayosAng + (i / n) * Math.PI * 2
      const a1 = a0 + (Math.PI * 2 / n) * 0.5
      c.moveTo(FOCO.x, FOCO.y)
      c.lineTo(FOCO.x + Math.cos(a0) * R * 1.5, FOCO.y + Math.sin(a0) * R * 1.5)
      c.lineTo(FOCO.x + Math.cos(a1) * R * 1.5, FOCO.y + Math.sin(a1) * R * 1.5)
      c.closePath()
    }
    c.fill()
    c.restore()
  }

  /** Estrella de impacto amarilla detrás del vaso: aparece de golpe y se va. */
  private dibujarEstallido(c: CanvasRenderingContext2D) {
    const e = this.estallido
    if (e <= 0.01 || this.reducido) return
    const k = salida(Math.min(1, (1 - e) * 5))
    const R = 300 * (0.3 + 0.7 * k) * (0.85 + 0.15 * e)
    const n = 16
    c.save()
    c.globalAlpha = Math.min(1, e * 2.5)
    c.beginPath()
    for (let i = 0; i < n * 2; i++) {
      const rr = i % 2 ? R * 0.74 : R
      const a = this.reloj * 0.6 + (i / (n * 2)) * Math.PI * 2
      const x = FOCO.x + Math.cos(a) * rr, y = FOCO.y - 40 + Math.sin(a) * rr
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y)
    }
    c.closePath()
    c.fillStyle = COL.estallido
    c.fill()
    c.lineWidth = 7
    c.lineJoin = 'round'
    c.strokeStyle = TINTA
    c.stroke()
    c.restore()
  }

  private dibujarMostrador(c: CanvasRenderingContext2D, z: number) {
    const izq = (-this.ox / this.esc) / z - 400
    // Acostada, el mostrador termina donde empieza el panel de texto.
    const der = this.apaisada() ? FOCO.x + ((this.area.x1 - this.ox) / this.esc - FOCO.x) / z : ((this.cssW - this.ox) / this.esc) / z + 400
    const abajo = (this.cssH - this.oy) / this.esc / z + 400
    // Tapa con un filo de luz; el frente en dos bandas planas que terminan en
    // el color del panel de texto.
    c.fillStyle = COL.tapa
    c.fillRect(izq, MOSTRADOR_Y, der - izq, 28)
    c.fillStyle = COL.tapaBrillo
    c.fillRect(izq, MOSTRADOR_Y, der - izq, 8)
    c.fillStyle = COL.frente
    c.fillRect(izq, MOSTRADOR_Y + 28, der - izq, 40)
    c.fillStyle = COL.frenteBajo
    c.fillRect(izq, MOSTRADOR_Y + 68, der - izq, 34)
    c.fillStyle = COL.noche
    c.fillRect(izq, MOSTRADOR_Y + 102, der - izq, abajo - MOSTRADOR_Y)
    c.strokeStyle = TINTA
    c.lineWidth = 6
    c.beginPath()
    c.moveTo(izq, MOSTRADOR_Y); c.lineTo(der, MOSTRADOR_Y)
    c.moveTo(izq, MOSTRADOR_Y + 28); c.lineTo(der, MOSTRADOR_Y + 28)
    c.stroke()
  }

  private apaisada() { return this.area.x1 < this.cssW - 1 }

  /** Cromo de caricatura: gris plano, una franja de sombra y una de brillo. */
  private cromo(c: CanvasRenderingContext2D, camino: () => void, x0: number, x1: number, vertical = true, y0 = 0, y1 = 0) {
    c.save()
    camino()
    c.fillStyle = COL.cromo
    c.fill()
    c.clip()
    c.fillStyle = COL.cromoSombra
    if (vertical) c.fillRect(x0 + (x1 - x0) * 0.64, -2000, x1 - x0, 4000)
    else c.fillRect(-2000, y0 + (y1 - y0) * 0.62, 4000, y1 - y0)
    c.fillStyle = COL.blanco
    if (vertical) c.fillRect(x0 + (x1 - x0) * 0.16, -2000, Math.max(5, (x1 - x0) * 0.14), 4000)
    else c.fillRect(-2000, y0 + (y1 - y0) * 0.18, 4000, Math.max(4, (y1 - y0) * 0.17))
    c.restore()
    camino()
    c.strokeStyle = TINTA
    c.lineWidth = 6
    c.lineJoin = 'round'
    c.stroke()
  }

  private dibujarTorre(c: CanvasRenderingContext2D) {
    const { x0, x1, y0, y1 } = TORRE
    const r = (x1 - x0) / 2
    this.cromo(c, () => {
      c.beginPath()
      c.moveTo(x0, y1)
      c.lineTo(x0, y0)
      c.arc(x0 + r, y0, r, Math.PI, 0)
      c.lineTo(x1, y1)
      c.closePath()
    }, x0, x1)
    c.beginPath()
    c.arc(x0 + r * 0.6, y0 - r * 0.45, 7, 0, Math.PI * 2)
    c.fillStyle = COL.blanco
    c.fill()
    this.cromo(c, () => {
      c.beginPath()
      c.roundRect(x0 - 16, y1 - 22, x1 - x0 + 32, 24, 8)
    }, x0 - 16, x1 + 16)
    this.cromo(c, () => {
      c.beginPath()
      c.roundRect(GX - 22, BRAZO.y0, x0 + 6 - (GX - 22), BRAZO.y1 - BRAZO.y0, 15)
    }, 0, 0, false, BRAZO.y0, BRAZO.y1)
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
    this.cromo(c, () => { c.beginPath(); c.roundRect(-15, -30, 30, 32, 6) }, -15, 15)
    // Cuerpo: rojo brillante, más ancho arriba
    const cuerpo = () => {
      c.beginPath()
      c.moveTo(-12, -28)
      c.lineTo(-20, -168)
      c.quadraticCurveTo(-20, -188, 0, -190)
      c.quadraticCurveTo(20, -188, 20, -168)
      c.lineTo(12, -28)
      c.closePath()
    }
    c.save()
    cuerpo()
    c.fillStyle = COL.manija
    c.fill()
    c.clip()
    c.fillStyle = COL.manijaSombra
    c.fillRect(7, -200, 30, 200)
    c.fillStyle = COL.blanco
    c.fillRect(-13, -178, 5, 140)
    c.restore()
    // La placa con el nombre
    const py0 = -158, py1 = -60
    c.save()
    c.beginPath()
    c.roundRect(-15, py0, 30, py1 - py0, 5)
    c.fillStyle = COL.placa
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
    c.lineWidth = 4
    c.strokeStyle = TINTA
    c.stroke()
    cuerpo()
    c.lineWidth = 6
    c.stroke()
    c.beginPath()
    c.arc(0, -192, 10, 0, Math.PI * 2)
    c.fillStyle = COL.placa
    c.fill()
    c.lineWidth = 5
    c.stroke()
    c.restore()

    // Rayitas de movimiento si la manija se mueve rápido
    const vel = Math.abs(this.velAngulo)
    if (vel > 1.2 && !this.reducido) {
      const a = Math.min(1, (vel - 1.2) / 3)
      c.save()
      c.translate(PIVOTE.x, PIVOTE.y)
      c.globalAlpha = a
      c.strokeStyle = TINTA
      c.lineWidth = 5
      c.lineCap = 'round'
      const sentido = Math.sign(this.velAngulo)
      for (let i = 0; i < 3; i++) {
        const rr = 160 + i * 24
        const a0 = this.angulo - Math.PI / 2 - sentido * 0.14
        c.beginPath()
        c.arc(0, 0, rr, a0 - sentido * 0.3, a0, sentido < 0)
        c.stroke()
      }
      c.restore()
    }
  }

  private dibujarBandeja(c: CanvasRenderingContext2D) {
    const { x0, x1, y0, y1 } = BANDEJA
    c.beginPath()
    c.roundRect(x0, y0, x1 - x0, y1 - y0, 5)
    c.fillStyle = COL.bandeja
    c.fill()
    c.fillStyle = COL.bandejaBrillo
    c.fillRect(x0 + 4, y0 + 3, x1 - x0 - 8, 5)
    c.strokeStyle = TINTA
    c.lineWidth = 3
    c.beginPath()
    for (let x = x0 + 18; x < x1 - 8; x += 18) { c.moveTo(x, y0 + 10); c.lineTo(x, y1 - 4) }
    c.stroke()
    c.beginPath()
    c.roundRect(x0, y0, x1 - x0, y1 - y0, 5)
    c.lineWidth = 5
    c.stroke()
  }

  private dibujarSombra(c: CanvasRenderingContext2D, v: Vaso) {
    const p = this.posicion(v)
    const alto = Math.min(1, -p.dy / 160)
    c.beginPath()
    c.ellipse(GX + p.dx, BASE_Y + 3, R_BASE * 1.2 * (1 - alto * 0.45), 10 * (1 - alto * 0.45), 0, 0, Math.PI * 2)
    c.fillStyle = 'rgba(23,18,29,0.45)'
    c.fill()
  }

  private caminoVaso(c: CanvasRenderingContext2D) {
    c.beginPath()
    c.moveTo(GX - R_BOCA, BOCA_Y)
    c.lineTo(GX - R_BASE, BASE_Y - 18)
    c.quadraticCurveTo(GX - R_BASE + 1, BASE_Y, GX - R_BASE + 18, BASE_Y)
    c.lineTo(GX + R_BASE - 18, BASE_Y)
    c.quadraticCurveTo(GX + R_BASE - 1, BASE_Y, GX + R_BASE, BASE_Y - 18)
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
    // Rayas de velocidad debajo cuando sube rápido en un salto.
    if (capa === 'atras' && v.valto < -250 && !this.reducido) {
      c.save()
      c.globalAlpha = Math.min(1, (-v.valto - 250) / 300)
      c.strokeStyle = COL.blanco
      c.lineWidth = 6
      c.lineCap = 'round'
      c.beginPath()
      for (const ox of [-60, 0, 60]) {
        c.moveTo(GX + p.dx + ox, BASE_Y + p.dy + 24)
        c.lineTo(GX + p.dx + ox, BASE_Y + p.dy + 24 + Math.min(70, -v.valto * 0.12))
      }
      c.stroke()
      c.restore()
    }
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
    this.caminoVaso(c)
    c.closePath()
    c.fillStyle = COL.vidrio
    c.fill()
    c.beginPath()
    c.ellipse(GX, BOCA_Y, R_BOCA, 15, 0, Math.PI, Math.PI * 2)
    c.strokeStyle = COL.vidrioBorde
    c.lineWidth = 4
    c.stroke()

    if (v.nivel <= 0.004 && v.espuma < 1) return
    const sup = FONDO_Y - alturaDe(v.nivel)
    c.save()
    this.caminoInterior(c)
    c.clip()
    // El líquido: un color plano, una banda clara bajo la superficie, una
    // sombra plana a la derecha y una franja de brillo a la izquierda.
    const camLiq = (desplazo = 0) => {
      c.beginPath()
      c.moveTo(GX - 160, FONDO_Y + 10)
      for (let x = GX - 160; x <= GX + 160; x += 8) c.lineTo(x, this.superficie(v, x, sup) + desplazo)
      c.lineTo(GX + 160, FONDO_Y + 10)
      c.closePath()
    }
    camLiq()
    c.fillStyle = css(pal.brillo)
    c.fill()
    camLiq(16)
    c.fillStyle = css(pal.base)
    c.fill()
    c.save()
    camLiq()
    c.clip()
    c.fillStyle = css(mezclar(pal.base, pal.hondo, 0.5))
    c.beginPath()
    c.moveTo(GX + 50, sup - 30); c.lineTo(GX + 38, FONDO_Y + 10); c.lineTo(GX + 200, FONDO_Y + 10); c.lineTo(GX + 200, sup - 30)
    c.fill()
    c.fillStyle = css(pal.brillo)
    c.beginPath()
    c.moveTo(GX - 92, sup + 20); c.lineTo(GX - 70, sup + 20); c.lineTo(GX - 56, FONDO_Y + 10); c.lineTo(GX - 78, FONDO_Y + 10)
    c.fill()
    // Remolinos cuando cae el chorro
    if (v.remolino > 0.05) {
      c.globalAlpha = v.remolino
      c.strokeStyle = css(pal.brillo)
      c.lineWidth = 6
      c.lineCap = 'round'
      for (let i = 0; i < 3; i++) {
        const a = this.reloj * (5 + i) + i * 2
        const cy = sup + 46 + i * 36
        if (cy > FONDO_Y - 10) break
        c.beginPath()
        c.ellipse(GX + Math.sin(a * 0.5) * 20, cy, 32 - i * 5, 11, 0, a, a + 2.2)
        c.stroke()
      }
      c.globalAlpha = 1
    }
    // Burbujas: círculos blancos planos
    c.fillStyle = 'rgba(255,255,255,0.85)'
    for (const b of v.burbujas) {
      const x = GX + b.x * rInt(b.y) + Math.sin(b.fase) * 3
      c.beginPath()
      c.arc(x, b.y, b.r, 0, Math.PI * 2)
      c.fill()
    }
    c.restore()
    c.restore()

    // Espuma: una nube de caricatura. Llena, se asoma por encima del borde.
    if (v.espuma > 1) this.dibujarEspuma(c, v, sup)
  }

  private dibujarEspuma(c: CanvasRenderingContext2D, v: Vaso, sup: number) {
    const pal = this.pal
    const r = rInt(Math.max(BOCA_Y, sup)) + 1
    const x0 = GX - r, x1 = GX + r
    const arriba = sup - v.espuma
    const domo = Math.max(0, Math.min(34, (LLENO_Y + 30 - arriba) * 0.9))
    const n = 6
    const t = this.reloj
    const tope = (u: number) => arriba - domo * (1 - u * u)
    const camino = () => {
      c.beginPath()
      c.moveTo(x0, this.superficie(v, x0, sup))
      c.lineTo(x0, tope(-1) + 8)
      for (let i = 0; i < n; i++) {
        const ua = -1 + (2 * i) / n, ub = -1 + (2 * (i + 1)) / n
        const xa = GX + ua * r, xb = GX + ub * r
        const bulto = 16 + Math.sin(t * 2.4 + i * 1.7 + v.semilla) * 3
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
    c.fillStyle = css(pal.espumaBaja)
    c.fillRect(x0 - 20, sup - v.espuma * 0.32, 2 * r + 40, v.espuma + 30)
    c.fillStyle = COL.blanco
    for (let i = 0; i < 3; i++) {
      const u = -0.68 + i * 0.5
      c.beginPath()
      c.ellipse(GX + u * r, tope(u) - 3, 10, 5, -0.3, 0, Math.PI * 2)
      c.fill()
    }
    c.restore()
    camino()
    c.strokeStyle = TINTA
    c.lineWidth = 6
    c.lineJoin = 'round'
    c.stroke()
  }

  private vasoFrente(c: CanvasRenderingContext2D, v: Vaso) {
    // Vidrio: base gruesa, dos brillos blancos en diagonal y un borde celeste.
    c.save()
    this.caminoVaso(c)
    c.closePath()
    c.clip()
    c.fillStyle = 'rgba(205,238,255,0.55)'
    c.fillRect(GX - 200, FONDO_Y, 400, 60)
    c.fillStyle = COL.blanco
    c.beginPath()
    c.moveTo(GX - 102, BOCA_Y + 28); c.lineTo(GX - 82, BOCA_Y + 28); c.lineTo(GX - 66, BOCA_Y + 290); c.lineTo(GX - 84, BOCA_Y + 290)
    c.closePath()
    c.moveTo(GX - 70, BOCA_Y + 40); c.lineTo(GX - 61, BOCA_Y + 40); c.lineTo(GX - 52, BOCA_Y + 150); c.lineTo(GX - 60, BOCA_Y + 150)
    c.closePath()
    c.fill()
    c.fillStyle = 'rgba(191,230,255,0.45)'
    c.beginPath()
    c.moveTo(GX + R_BOCA - 24, BOCA_Y); c.lineTo(GX + R_BOCA, BOCA_Y); c.lineTo(GX + R_BASE, BASE_Y); c.lineTo(GX + R_BASE - 20, BASE_Y)
    c.fill()
    c.restore()
    c.beginPath()
    c.moveTo(GX - rInt(FONDO_Y) + 4, FONDO_Y + 2)
    c.quadraticCurveTo(GX, FONDO_Y + 12, GX + rInt(FONDO_Y) - 4, FONDO_Y + 2)
    c.strokeStyle = COL.vidrioBorde
    c.lineWidth = 4
    c.stroke()
    // Gotitas de frío
    if (v.frio > 0.2) {
      const az = azar(v.semilla * 13)
      for (let i = 0; i < 4; i++) {
        const y = BOCA_Y + 70 + az() * 280
        const lado = az() < 0.5 ? -1 : 1
        const x = GX + lado * (rExt(y) - 12 - az() * 12)
        c.globalAlpha = v.frio
        this.gotaDibujo(c, x, y + Math.min(30, (this.reloj * (4 + i)) % 40), 5 + az() * 2, '#e6f6ff', 3)
        c.globalAlpha = 1
      }
    }
    this.caminoVaso(c)
    c.strokeStyle = TINTA
    c.lineWidth = 7
    c.lineJoin = 'round'
    c.stroke()
    c.beginPath()
    c.ellipse(GX, BOCA_Y, R_BOCA, 15, 0, 0, Math.PI)
    c.stroke()

    this.dibujarCara(c, v)
    this.dibujarBrazos(c, v)
  }

  // ── El personaje ─────────────────────────────────────────────────────────
  /** Trazo de tinta. Sobre una cerveza oscura lleva un borde crema para que
   *  la cara se lea igual. */
  private trazo(c: CanvasRenderingContext2D, camino: () => void, ancho: number) {
    camino()
    c.lineCap = 'round'
    c.lineJoin = 'round'
    if (this.pal.luminosidad < 0.3) {
      c.strokeStyle = COL.placa
      c.lineWidth = ancho + 5
      c.stroke()
    }
    c.strokeStyle = TINTA
    c.lineWidth = ancho
    c.stroke()
  }

  /** Brazos de fideo con manos redondas. */
  private dibujarBrazos(c: CanvasRenderingContext2D, v: Vaso) {
    v.manos.forEach((m, i) => {
      const lado = i === 0 ? -1 : 1
      const sx = GX + lado * (rExt(HOMBRO_Y) - 2), sy = HOMBRO_Y
      const hx = sx + m.x, hy = sy + m.y
      // El codo se arquea hacia afuera: un fideo, no un palo.
      const dx = hx - sx, dy = hy - sy
      const largo = Math.hypot(dx, dy) || 1
      let nx = -dy / largo, ny = dx / largo
      if (nx * lado < 0) { nx = -nx; ny = -ny }
      const curva = Math.max(10, 40 - largo * 0.15)
      const cx = (sx + hx) / 2 + nx * curva, cy = (sy + hy) / 2 + ny * curva
      this.trazo(c, () => { c.beginPath(); c.moveTo(sx, sy); c.quadraticCurveTo(cx, cy, hx, hy) }, 8)
      // La mano: un círculo blanco con el pulgar
      const ang = Math.atan2(hy - cy, hx - cx)
      c.beginPath()
      c.arc(hx + Math.cos(ang - lado * 1.6) * 13, hy + Math.sin(ang - lado * 1.6) * 13, 7, 0, Math.PI * 2)
      c.fillStyle = COL.blanco
      c.fill()
      c.strokeStyle = TINTA
      c.lineWidth = 4.5
      c.stroke()
      c.beginPath()
      c.arc(hx, hy, 15, 0, Math.PI * 2)
      c.fill()
      c.lineWidth = 5
      c.stroke()
    })
  }

  private dibujarCara(c: CanvasRenderingContext2D, v: Vaso) {
    const t = this.reloj
    const cara = v.cara
    let fy = CARA_Y
    let fx = GX
    if (cara === 'nerviosa' && !this.reducido) { fx += (rnd() - 0.5) * 2.5; fy += (rnd() - 0.5) * 2 }
    const parp = v.cerrando > 0 ? Math.sin(v.cerrando * Math.PI) : 0

    type Ojo = 'normal' | 'feliz' | 'grande' | 'nervioso' | 'dormido'
    let izq: Ojo = 'normal', der: Ojo = 'normal'
    let boca: 'gato' | 'sonrisa' | 'chica' | 'abierta' | 'canta' | 'dientes' | 'o' = 'sonrisa'
    // Cejas: [altura, inclinación]. La inclinación positiva sube la punta de adentro.
    let ceja: [number, number] | null = [0, 0]
    let rubor = false
    switch (cara) {
      case 'feliz': boca = 'gato'; ceja = [-4, -0.1]; break
      case 'canta': izq = der = 'feliz'; boca = 'canta'; ceja = [-10, -0.15]; rubor = true; break
      case 'guino': der = 'feliz'; boca = 'sonrisa'; ceja = [-6, -0.1]; rubor = true; break
      case 'emocionada': izq = der = 'grande'; boca = 'abierta'; ceja = [-16, -0.2]; rubor = true; break
      case 'recibiendo': izq = der = 'feliz'; boca = 'abierta'; ceja = [-10, -0.15]; rubor = true; break
      case 'nerviosa': izq = der = 'nervioso'; boca = 'dientes'; ceja = [-14, 0.45]; break
      case 'esperando': boca = 'chica'; ceja = [-2, 0]; break
      case 'orgullosa': izq = der = 'feliz'; boca = 'abierta'; ceja = [-14, -0.25]; rubor = true; break
      case 'contenta': der = 'feliz'; boca = 'abierta'; ceja = [-8, -0.15]; rubor = true; break
      case 'chau': izq = der = 'feliz'; boca = 'sonrisa'; ceja = [-6, -0.1]; break
      case 'dormida': izq = der = 'dormido'; boca = 'o'; ceja = null; break
    }

    if (rubor) {
      c.fillStyle = COL.rubor
      for (const lado of [-1, 1]) {
        c.beginPath()
        c.ellipse(fx + lado * 72, fy + 22, 16, 9, 0, 0, Math.PI * 2)
        c.fill()
      }
    }

    this.ojo(c, fx - 40, fy - 10, izq, v, parp)
    this.ojo(c, fx + 40, fy - 10, der, v, parp)

    if (ceja) {
      const [alto, incl] = ceja
      for (const lado of [-1, 1]) {
        const cx = fx + lado * 40, cy = fy - 48 + alto
        this.trazo(c, () => {
          c.beginPath()
          c.moveTo(cx - lado * 14, cy - incl * 14 * 1)
          c.lineTo(cx + lado * 14, cy + incl * 14 * 1)
        }, 7)
      }
    }

    // Boca
    const by = fy + 36
    if (boca === 'gato') {
      this.trazo(c, () => {
        c.beginPath()
        c.moveTo(fx - 18, by - 3)
        c.quadraticCurveTo(fx - 9, by + 10, fx, by - 1)
        c.quadraticCurveTo(fx + 9, by + 10, fx + 18, by - 3)
      }, 6)
    } else if (boca === 'sonrisa') {
      this.trazo(c, () => { c.beginPath(); c.moveTo(fx - 22, by - 4); c.quadraticCurveTo(fx, by + 16, fx + 22, by - 4) }, 6.5)
    } else if (boca === 'chica') {
      this.trazo(c, () => { c.beginPath(); c.moveTo(fx - 11, by); c.quadraticCurveTo(fx, by + 7, fx + 11, by) }, 6)
    } else if (boca === 'dientes') {
      // Sonrisa nerviosa de dientes apretados: rectángulo blanco con rayitas.
      const tiembla = this.reducido ? 0 : Math.sin(t * 30) * 1.2
      const camino = () => { c.beginPath(); c.roundRect(fx - 28, by - 10 + tiembla, 56, 22, 8) }
      camino()
      c.fillStyle = COL.blanco
      c.fill()
      c.strokeStyle = TINTA
      c.lineWidth = 5
      c.stroke()
      c.beginPath()
      c.moveTo(fx - 28, by + 1 + tiembla); c.lineTo(fx + 28, by + 1 + tiembla)
      for (let i = -2; i <= 2; i++) { c.moveTo(fx + i * 10, by - 10 + tiembla); c.lineTo(fx + i * 10, by + 12 + tiembla) }
      c.lineWidth = 3
      c.stroke()
    } else {
      // Bocas abiertas: oscuras, con lengua y una fila de dientes arriba.
      const abre = boca === 'abierta'
        ? (cara === 'recibiendo' ? 0.85 + Math.sin(t * 9) * 0.15 : 1)
        : boca === 'canta' ? 0.55 + Math.abs(Math.sin(t * 6)) * 0.5 : 0.45 + Math.sin(t * 1.6) * 0.12
      const camino = () => {
        c.beginPath()
        if (boca === 'abierta') {
          c.moveTo(fx - 30, by - 8)
          c.lineTo(fx + 30, by - 8)
          c.quadraticCurveTo(fx + 28, by - 8 + 40 * abre, fx, by - 8 + 40 * abre)
          c.quadraticCurveTo(fx - 28, by - 8 + 40 * abre, fx - 30, by - 8)
        } else {
          const rr = boca === 'canta' ? 14 : 8
          c.ellipse(fx, by + 4, rr, rr * 1.2 * abre + 2, 0, 0, Math.PI * 2)
        }
        c.closePath()
      }
      if (this.pal.luminosidad < 0.3) {
        camino()
        c.strokeStyle = COL.placa
        c.lineWidth = 11
        c.stroke()
      }
      c.save()
      camino()
      c.fillStyle = COL.boca
      c.fill()
      c.clip()
      c.beginPath()
      c.ellipse(fx, by + 6 + (boca === 'abierta' ? 30 * abre : 10 * abre), 17, 10, 0, 0, Math.PI * 2)
      c.fillStyle = COL.lengua
      c.fill()
      if (boca === 'abierta') {
        c.fillStyle = COL.blanco
        c.fillRect(fx - 30, by - 10, 60, 9)
      }
      c.restore()
      camino()
      c.strokeStyle = TINTA
      c.lineWidth = 5.5
      c.lineJoin = 'round'
      c.stroke()
    }

    if (cara === 'dormida' && !this.reducido) {
      const k = 0.5 + 0.5 * Math.sin(t * 1.6)
      c.beginPath()
      c.arc(fx + 34, by - 6, 6 + k * 14, 0, Math.PI * 2)
      c.fillStyle = 'rgba(200,236,255,0.6)'
      c.fill()
      c.strokeStyle = TINTA
      c.lineWidth = 3.5
      c.stroke()
    }

    if (v.sudor > 0.05) {
      const caida = (t * 0.6) % 1
      this.gotaDibujo(c, fx + 96, fy - 66 + caida * 26, 14 * v.sudor, COL.sudor, 4)
    }
  }

  /** Ojos de caricatura: óvalo blanco con contorno y un punto negro. */
  private ojo(c: CanvasRenderingContext2D, cx: number, cy: number, tipo: string, v: Vaso, parp: number) {
    if (tipo === 'feliz') {
      this.trazo(c, () => { c.beginPath(); c.moveTo(cx - 18, cy + 8); c.quadraticCurveTo(cx, cy - 18, cx + 18, cy + 8) }, 7)
      return
    }
    if (tipo === 'dormido') {
      this.trazo(c, () => { c.beginPath(); c.moveTo(cx - 17, cy + 2); c.quadraticCurveTo(cx, cy + 14, cx + 17, cy + 2) }, 7)
      return
    }
    const rx = tipo === 'grande' ? 21 : tipo === 'nervioso' ? 22 : 17
    const ry = (tipo === 'grande' ? 27 : tipo === 'nervioso' ? 28 : 22) * (tipo === 'normal' ? 1 - parp : 1)
    if (tipo === 'normal' && parp > 0.8) {
      this.trazo(c, () => { c.beginPath(); c.moveTo(cx - 16, cy + 2); c.lineTo(cx + 16, cy + 2) }, 7)
      return
    }
    const blanco = () => { c.beginPath(); c.ellipse(cx, cy, rx, Math.max(2, ry), 0, 0, Math.PI * 2) }
    if (this.pal.luminosidad < 0.3) {
      blanco()
      c.strokeStyle = COL.placa
      c.lineWidth = 11
      c.stroke()
    }
    blanco()
    c.fillStyle = COL.blanco
    c.fill()
    c.save()
    blanco()
    c.clip()
    const rp = tipo === 'grande' ? 11 : tipo === 'nervioso' ? 4.5 : 8
    const tiembla = tipo === 'nervioso' && !this.reducido ? Math.sin(this.reloj * 45) * 1.5 : 0
    const px = cx + v.mirada.x * (rx - rp - 3) + tiembla
    const py = cy + 2 + v.mirada.y * (Math.max(2, ry) - rp - 3)
    c.beginPath()
    c.arc(px, py, rp, 0, Math.PI * 2)
    c.fillStyle = TINTA
    c.fill()
    if (tipo === 'grande') {
      c.beginPath()
      c.arc(px - 4, py - 4, 3.5, 0, Math.PI * 2)
      c.fillStyle = COL.blanco
      c.fill()
    }
    c.restore()
    blanco()
    c.strokeStyle = TINTA
    c.lineWidth = 5
    c.stroke()
  }

  private dibujarChorro(c: CanvasRenderingContext2D) {
    if (this.chorro === 'no') return
    const y0 = this.cola, y1 = this.cabeza
    if (y1 - y0 < 2) return
    const t = this.reloj
    const ancho = (y: number) => 9 + Math.sin(y * 0.07 - t * 22) * 1.4 + (this.chorro === 'bajando' ? 0 : Math.min(2, (y - PICO_Y) * 0.01))
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
    c.fillStyle = css(mezclar(this.pal.base, this.pal.hondo, 0.5))
    c.fillRect(GX + 3, y0, 20, y1 - y0 + 20)
    c.fillStyle = css(this.pal.brillo)
    c.fillRect(GX - 6, y0, 4, y1 - y0 + 20)
    c.fillStyle = COL.blanco
    for (let y = y0 + ((t * 900) % 60); y < y1; y += 60) c.fillRect(GX - 2, y, 3, 18)
    c.restore()
    camino()
    c.strokeStyle = TINTA
    c.lineWidth = 4.5
    c.stroke()
  }

  private dibujarParticulas(c: CanvasRenderingContext2D) {
    for (const p of this.parts) {
      const vida = p.vida / p.max
      c.save()
      c.globalAlpha = Math.min(1, vida * 2.5)
      switch (p.tipo) {
        case 'chispa': {
          const k = Math.sin((1 - vida) * Math.PI)
          this.estrella4(c, p.x, p.y, p.tam * k, p.color)
          break
        }
        case 'puf': {
          c.beginPath()
          c.arc(p.x, p.y, p.tam * (1.4 - vida * 0.4), 0, Math.PI * 2)
          c.fillStyle = p.color
          c.fill()
          c.strokeStyle = TINTA
          c.lineWidth = 3.5
          c.stroke()
          break
        }
        case 'gota':
          this.gotaDibujo(c, p.x, p.y, p.tam, p.color, 3)
          break
        case 'confeti': {
          c.translate(p.x, p.y)
          c.rotate(p.rot)
          c.scale(1, Math.cos(p.rot * 1.7))
          c.fillStyle = p.color
          c.fillRect(-p.tam / 2, -p.tam / 4, p.tam, p.tam / 2)
          c.strokeStyle = TINTA
          c.lineWidth = 2.5
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
          c.lineWidth = p.tam * 0.18
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

  // ── Formas ───────────────────────────────────────────────────────────────
  private estrella4(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
    if (r <= 1) return
    const k = r * 0.28
    c.beginPath()
    c.moveTo(x, y - r)
    c.lineTo(x + k, y - k); c.lineTo(x + r, y); c.lineTo(x + k, y + k)
    c.lineTo(x, y + r)
    c.lineTo(x - k, y + k); c.lineTo(x - r, y); c.lineTo(x - k, y - k)
    c.closePath()
    c.fillStyle = color
    c.fill()
    c.strokeStyle = TINTA
    c.lineWidth = 3.5
    c.lineJoin = 'round'
    c.stroke()
  }

  private gotaDibujo(c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, borde = 3) {
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
    c.lineJoin = 'round'
    c.stroke()
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
    c.lineWidth = 4
    c.lineJoin = 'round'
    c.stroke()
  }

  private nota(c: CanvasRenderingContext2D, s: number, color: string) {
    const k = s / 30
    c.beginPath()
    c.ellipse(-6 * k, 10 * k, 8 * k, 6 * k, -0.4, 0, Math.PI * 2)
    c.rect(0.5 * k, -20 * k, 4 * k, 30 * k)
    c.moveTo(4.5 * k, -20 * k)
    c.quadraticCurveTo(16 * k, -14 * k, 12 * k, -2 * k)
    c.quadraticCurveTo(12 * k, -10 * k, 4.5 * k, -12 * k)
    c.closePath()
    c.fillStyle = color
    c.fill()
    c.strokeStyle = TINTA
    c.lineWidth = 3.5
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
    x.fillStyle = TINTA
    x.fillText(texto, W / 2, H / 2 + 3, W - 16)
    this.placa = lienzo
  }

  /** La pared del bar: colores planos, sin contornos (es fondo, el contorno
   *  queda para los personajes), estantes con botellas y un círculo de luz. */
  private pintarFondo() {
    const f = this.fondo
    const c = f.getContext('2d')
    if (!c || !this.cssW) return
    const k = f.width / this.cssW
    c.setTransform(k, 0, 0, k, 0, 0)
    const W = this.cssW, H = this.cssH
    c.fillStyle = COL.noche
    c.fillRect(0, 0, W, H)

    c.save()
    c.translate(this.ox, this.oy)
    c.scale(this.esc, this.esc)
    const izq = -this.ox / this.esc, der = (W - this.ox) / this.esc, arriba = -this.oy / this.esc
    // Pared
    c.fillStyle = COL.pared
    c.fillRect(izq, arriba, der - izq, MOSTRADOR_Y - arriba)
    // Zócalo de tablas
    c.fillStyle = COL.paredBaja
    c.fillRect(izq, 770, der - izq, MOSTRADOR_Y - 770)
    c.fillStyle = COL.tabla
    for (let x = Math.floor(izq / 46) * 46; x < der; x += 46) c.fillRect(x, 778, 5, MOSTRADOR_Y - 778)
    c.fillStyle = COL.moldura
    c.fillRect(izq, 762, der - izq, 14)
    // Círculo de luz detrás del vaso
    c.fillStyle = COL.halo
    c.beginPath()
    c.arc(FOCO.x, FOCO.y, 290, 0, Math.PI * 2)
    c.fill()
    // Estantes con botellas
    const az = azar(42)
    for (const y of [420, 640]) {
      for (let x = izq + 8; x < der - 20;) {
        const w = 28 + az() * 18, h = 66 + az() * 64
        // Detrás del círculo de luz quedan menos botellas: el personaje respira.
        const lejos = Math.abs(x + w / 2 - FOCO.x) > 250
        if (lejos || az() < 0.35) {
          c.fillStyle = BOTELLAS[Math.floor(az() * BOTELLAS.length)]
          c.beginPath()
          c.roundRect(x, y - h, w, h, [w * 0.4, w * 0.4, 4, 4])
          c.rect(x + w * 0.34, y - h - 24, w * 0.32, 28)
          c.fill()
          c.fillStyle = 'rgba(255,255,255,0.45)'
          c.fillRect(x + w * 0.2, y - h + 12, 5, h - 24)
          c.fillStyle = '#fff3d6'
          c.fillRect(x + 4, y - h * 0.56, w - 8, h * 0.24)
        }
        x += w + 10 + az() * 20
      }
      c.fillStyle = COL.estante
      c.fillRect(izq, y, der - izq, 14)
      c.fillStyle = COL.estanteSombra
      c.fillRect(izq, y + 14, der - izq, 7)
    }
    c.restore()

    // Acostada, el panel de texto va sobre la noche, no sobre las botellas:
    // la escena termina en una línea de tinta, como el borde de un cuadro.
    if (this.apaisada()) {
      c.fillStyle = COL.noche
      c.fillRect(this.area.x1, 0, W - this.area.x1, H)
      c.fillStyle = TINTA
      c.fillRect(this.area.x1 - 3, 0, 6, H)
    }
  }
}
