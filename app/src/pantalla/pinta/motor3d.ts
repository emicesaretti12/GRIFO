import * as THREE from 'three'
import { css, mezclar, paleta, type Paleta, type RGB } from './color'
import type { Entrada } from './motor'

// ─────────────────────────────────────────────────────────────────────────────
// La tirada en 3D (WebGL, con Three.js).
//
// El motor 2D (motor.ts) dibujaba la escena: por bien que estuviera pintada,
// era un dibujo plano. Acá la escena es un modelo: el vaso es vidrio de verdad
// (refracta lo que tiene detrás), el cromo refleja las luces de un bar, la
// cerveza proyecta luz ámbar sobre la bandeja y todo arroja sombra. La cámara
// está en tres cuartos, como se ve una canilla parado frente a la barra.
//
// La lógica es la misma que en el 2D, probada contra una tirada simulada:
//   · la manija se abre cuando SUBE lo medido, y se cierra 2,4 s después;
//   · el vaso se llena por volumen (es un cono truncado);
//   · qué vaso es lo decide lo medido, nunca la predicción;
//   · el contador de plata nunca va adelante de lo medido.
//
// Unidades: decímetros. El vaso mide 1,5 (15 cm).
// ─────────────────────────────────────────────────────────────────────────────

const VASO_H = 1.5
const R_BOCA = 0.43
const R_BASE = 0.33
const PARED = 0.022
const FONDO = 0.14                  // la base maciza de una pinta
const LLENO = VASO_H - 0.2          // hasta dónde llega el líquido con el vaso lleno
const MESA = -0.1                   // la bandeja mide 1 cm: el vaso apoya en y = 0
const PICO = new THREE.Vector3(0, 2.02, 0)
const PIVOTE = new THREE.Vector3(0, 2.42, -0.1)
const TORRE = { z: -0.95, r: 0.2, alto: 2.78 }
const G = 26                        // gravedad del chorro, a ojo
const MANIJA_CERRADA = -0.1
const MANIJA_ABIERTA = 0.52
const SALIDA = 2.8                  // cuánto se corre un vaso al entrar o salir
/** Hacia dónde mira la cámara, alrededor del vaso. Es fijo: la cámara siempre
 *  está en el mismo ángulo y solo se aleja o se acerca según la pantalla. */
const DIR_CAM = new THREE.Vector3(0.62, 0.2, 1).normalize()
const ANG = Math.atan2(DIR_CAM.x, DIR_CAM.z)

const rExt = (y: number) => R_BASE + (R_BOCA - R_BASE) * Math.max(0, Math.min(VASO_H, y)) / VASO_H
const rInt = (y: number) => rExt(y) - PARED
const rLiq = (y: number) => rInt(y) - 0.006

/** Volumen → altura. El mismo volumen ocupa menos altura arriba, donde el
 *  vaso es más ancho. Se tabula una vez. */
const TABLA: number[] = (() => {
  const vol = (h: number) => {
    const r0 = rLiq(FONDO), r1 = rLiq(FONDO + h)
    return Math.PI * h * (r0 * r0 + r0 * r1 + r1 * r1) / 3
  }
  const hMax = LLENO - FONDO, vMax = vol(hMax)
  const t: number[] = []
  for (let i = 0; i <= 256; i++) {
    let lo = 0, hi = hMax
    for (let k = 0; k < 28; k++) { const m = (lo + hi) / 2; if (vol(m) < (i / 256) * vMax) lo = m; else hi = m }
    t.push(lo)
  }
  return t
})()
function alturaDe(f: number) {
  const x = Math.max(0, Math.min(1, f)) * 256, i = Math.floor(x)
  return i >= 256 ? TABLA[256] : TABLA[i] + (TABLA[i + 1] - TABLA[i]) * (x - i)
}

const acercar = (a: number, b: number, tau: number, dt: number) => a + (b - a) * (1 - Math.exp(-dt / Math.max(1e-4, tau)))
const suaveInOut = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

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

const color3 = ([r, g, b]: RGB) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)

function lienzo(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return { c, x: c.getContext('2d')! }
}

// ── Texturas generadas (nada se descarga) ───────────────────────────────────
function texturaRocio(): THREE.CanvasTexture {
  // Mapa de relieve: gotitas sobre el vidrio frío. Con transmisión, cada gota
  // desvía la luz y el vaso se ve mojado de verdad.
  const { c, x } = lienzo(1024, 512)
  x.fillStyle = '#000'; x.fillRect(0, 0, 1024, 512)
  const r = azar(4242)
  for (let i = 0; i < 2600; i++) {
    const px = r() * 1024, py = 40 + r() * 460, grande = r() < 0.04
    const rr = grande ? 5 + r() * 6 : 0.8 + r() * r() * 3.2
    const g = x.createRadialGradient(px - rr * 0.2, py - rr * 0.2, 0, px, py, rr)
    g.addColorStop(0, '#fff'); g.addColorStop(0.7, '#aaa'); g.addColorStop(1, '#000')
    x.fillStyle = g
    x.beginPath(); x.ellipse(px, py, rr * 0.9, rr, 0, 0, Math.PI * 2); x.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.RepeatWrapping
  t.repeat.set(2, 1)
  return t
}

function texturaEspuma(): THREE.CanvasTexture {
  const { c, x } = lienzo(512, 512)
  x.fillStyle = '#808080'; x.fillRect(0, 0, 512, 512)
  const r = azar(9001)
  for (let i = 0; i < 2600; i++) {
    const px = r() * 512, py = r() * 512, rr = 1.2 + Math.pow(r(), 2.6) * 9
    for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
      const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rr)
      g.addColorStop(0, '#b8b8b8'); g.addColorStop(0.75, '#d8d8d8'); g.addColorStop(0.9, '#5a5a5a'); g.addColorStop(1, 'rgba(128,128,128,0)')
      x.fillStyle = g
      x.beginPath(); x.arc(px + ox, py + oy, rr, 0, Math.PI * 2); x.fill()
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(5, 1.4)
  return t
}

function texturaVetas(): THREE.CanvasTexture {
  // Vetas que corren por el chorro: lo que lo hace leerse como líquido que cae.
  const { c, x } = lienzo(128, 512)
  x.fillStyle = '#5a5a5a'; x.fillRect(0, 0, 128, 512)
  const r = azar(77)
  for (let i = 0; i < 90; i++) {
    const px = r() * 128, py = r() * 512, l = 40 + r() * 220, w = 1 + r() * 5, a = 0.15 + r() * 0.6
    for (const oy of [-512, 0, 512]) {
      const g = x.createLinearGradient(0, py + oy, 0, py + oy + l)
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = g
      x.fillRect(px, py + oy, w, l)
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function texturaLente(): THREE.CanvasTexture {
  // La cerveza es una lente: concentra la luz en el centro y oscurece los
  // costados. Es un mapa de emisión en U (alrededor del vaso), centrado en la
  // cara que mira la cámara.
  const { c, x } = lienzo(512, 64)
  const g = x.createLinearGradient(0, 0, 512, 0)
  g.addColorStop(0, '#000'); g.addColorStop(0.27, '#0c0c0c'); g.addColorStop(0.4, '#9a9a9a')
  g.addColorStop(0.47, '#fff'); g.addColorStop(0.56, '#c8c8c8'); g.addColorStop(0.7, '#1a1a1a'); g.addColorStop(1, '#000')
  x.fillStyle = g; x.fillRect(0, 0, 512, 64)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function texturaMadera(): THREE.CanvasTexture {
  const { c, x } = lienzo(1024, 1024)
  x.fillStyle = '#3a2516'; x.fillRect(0, 0, 1024, 1024)
  const r = azar(808)
  for (let i = 0; i < 260; i++) {
    const y = r() * 1024, a = 0.04 + r() * 0.12, h = 1 + r() * 5
    x.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,190,130,${a * 0.5})`
    x.beginPath()
    x.moveTo(0, y)
    for (let px = 0; px <= 1024; px += 64) x.lineTo(px, y + Math.sin(px * 0.004 + i) * 6)
    x.lineTo(1024, y + h); x.lineTo(0, y + h); x.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(3, 3)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function texturaRejilla(): THREE.CanvasTexture {
  const { c, x } = lienzo(512, 256)
  x.fillStyle = '#c9cfd3'; x.fillRect(0, 0, 512, 256)
  x.fillStyle = '#121518'
  for (let i = 0; i < 9; i++) x.fillRect(18, 16 + i * 26, 476, 13)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function texturaManija(nombre: string, p: Paleta): THREE.CanvasTexture {
  const { c, x } = lienzo(256, 1024)
  const g = x.createLinearGradient(0, 0, 256, 0)
  g.addColorStop(0, css(p.hondo)); g.addColorStop(0.35, css(p.luz)); g.addColorStop(0.5, css(mezclar(p.brillo, [255, 255, 255], 0.3)))
  g.addColorStop(0.65, css(p.base)); g.addColorStop(1, css(p.hondo))
  x.fillStyle = g; x.fillRect(0, 0, 256, 1024)
  x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 10; x.strokeRect(8, 8, 240, 1008)
  const texto = (nombre || 'GRIFO').toUpperCase().slice(0, 18)
  x.save()
  x.translate(128, 512); x.rotate(-Math.PI / 2)
  let tam = 150
  x.font = `800 ${tam}px "Big Shoulders Display Variable", "Archivo Variable", sans-serif`
  const w = x.measureText(texto).width
  if (w > 900) { tam = tam * 900 / w; x.font = `800 ${tam}px "Big Shoulders Display Variable", "Archivo Variable", sans-serif` }
  const [r0, g0, b0] = p.base
  x.fillStyle = r0 * 0.299 + g0 * 0.587 + b0 * 0.114 > 140 ? 'rgba(22,15,8,0.92)' : 'rgba(255,248,236,0.95)'
  x.textAlign = 'center'; x.textBaseline = 'middle'
  x.fillText(texto, 0, 6)
  x.restore()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** El entorno que reflejan el cromo y el vidrio: una barra de noche. Paneles
 *  de luz cálida, una ventana fría atrás y luces chicas en el fondo. */
function entornoBar(renderer: THREE.WebGLRenderer): THREE.Texture {
  const sc = new THREE.Scene()
  sc.add(new THREE.Mesh(new THREE.BoxGeometry(24, 12, 24), new THREE.MeshBasicMaterial({ color: 0x2b2722, side: THREE.BackSide })))
  const panel = (w: number, h: number, col: number, k: number, pos: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }))
    m.position.set(...pos); m.lookAt(0, 1.5, 0); sc.add(m)
  }
  // Un cromo es un espejo: si el entorno es oscuro, el cromo se ve negro. Lo
  // que lo hace leerse como metal son las bandas claras y oscuras alternadas,
  // así que el bar tiene luces altas y verticales alrededor.
  panel(6, 2.6, 0xffd6a8, 10, [-5, 6, 4])     // la luz principal, arriba a la izquierda
  panel(10, 10, 0xfff0dc, 1.4, [0, 9, 0])     // el techo, apenas iluminado
  panel(1.4, 7, 0xffffff, 6, [7, 3, 5])       // un reflejo duro a la derecha
  panel(1.0, 7, 0xffe2c0, 4, [-7, 3, 2])      // otro a la izquierda
  panel(1.0, 7, 0xffd0a0, 3, [2, 3, 9])       // detrás de la cámara: da el brillo frontal
  panel(3, 5, 0x8fb8e8, 2.4, [7, 3, -6])      // una ventana fría
  panel(14, 0.7, 0xffa860, 5, [0, 4.5, -10])  // la tira bajo el estante
  panel(24, 2, 0x3a2516, 1.2, [0, -1.5, 0])   // el mostrador de madera, abajo
  const r = azar(31)
  for (let i = 0; i < 14; i++) {
    panel(0.5, 0.5, r() < 0.7 ? 0xffb066 : 0xffe0b0, 3 + r() * 5, [(r() - 0.5) * 20, 1 + r() * 6, -10 + r() * 2])
  }
  const pm = new THREE.PMREMGenerator(renderer)
  const tex = pm.fromScene(sc, 0.02).texture
  pm.dispose()
  return tex
}

// ── Estado de un vaso ──────────────────────────────────────────────────────
type Burbuja = { ang: number; y: number; r: number; arrastre: number; fase: number }
type Vaso = {
  clave: string
  t: number
  saliendo: boolean
  nivel: number
  espuma: number
  turbio: number
  frio: number
  burbujas: Burbuja[]
  grupo: THREE.Group
  liquido: THREE.Mesh
  espumaM: THREE.Mesh
  burbujasM: THREE.InstancedMesh
  matLiq: THREE.MeshPhysicalMaterial
  hecho: { nivel: number; espuma: number }
}

export class Motor3D {
  private renderer: THREE.WebGLRenderer
  private fondo: HTMLCanvasElement
  private escena = new THREE.Scene()
  private camara = new THREE.PerspectiveCamera(24, 1, 0.1, 100)
  private cssW = 0
  private cssH = 0
  private dpr = 1
  private calidad: 'alta' | 'baja' = 'alta'
  private lento = 0
  private reducido = false

  private entrada: Entrada = { modo: 'exhibicion', ml: 0, vaso: 473, color: '#d9a21b', etiqueta: '', sesion: null }
  private pal: Paleta = paleta('#d9a21b')

  // Medición (idéntica al motor 2D)
  private mlPrevio = 0
  private cambioEn = 0
  private caudal = 0
  private fluyendo = false
  private mlVisual = 0
  private mlContador = 0
  private ultimoContado = -1
  private alias: { de: string | null; a: string } | null = null

  // Escena
  private vasos: Vaso[] = []
  private manija = new THREE.Group()
  private matEtiqueta: THREE.MeshStandardMaterial
  private matVidrio: THREE.MeshPhysicalMaterial
  private matEspuma: THREE.MeshStandardMaterial
  private matChorro: THREE.MeshPhysicalMaterial
  private matBurbuja: THREE.MeshStandardMaterial
  private texLente = texturaLente()
  private texVetas = texturaVetas()
  private chorroM: THREE.Mesh
  private gotasM: THREE.InstancedMesh
  private salpicaM: THREE.InstancedMesh
  private luzClave: THREE.SpotLight
  private luzCerveza: THREE.PointLight
  private geoVidrio: THREE.LatheGeometry
  /** La pared del bar, como un plano detrás de todo. Tiene que estar DENTRO de
   *  la escena: el vidrio refracta lo que hay en la escena, y un fondo pintado
   *  aparte (en otro lienzo) el vidrio no lo ve: el vaso vacío salía blanco. */
  private pared: THREE.Mesh | null = null

  private angulo = MANIJA_CERRADA
  private velAngulo = 0
  private chorro: 'no' | 'bajando' | 'si' | 'cortando' = 'no'
  private cabeza = PICO.y
  private vCabeza = 0
  private cola = PICO.y
  private vCola = 0
  private gotas: { y: number; vy: number }[] = []
  private goteos: number[] = []
  private salpica: { p: THREE.Vector3; v: THREE.Vector3; vida: number }[] = []
  private luz = 0.7
  private reloj = 0
  private ultimo = 0
  private raf = 0
  private semillas = 1
  private dummy = new THREE.Object3D()

  alContar: ((ml: number) => void) | null = null

  constructor(lienzo3d: HTMLCanvasElement, fondo: HTMLCanvasElement) {
    this.fondo = fondo
    // Si no hay WebGL esto tira, y Pinta cae al motor 2D.
    this.renderer = new THREE.WebGLRenderer({ canvas: lienzo3d, antialias: true, alpha: true, powerPreference: 'high-performance' })
    const r = this.renderer
    r.setClearColor(0x000000, 0)
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.toneMappingExposure = 1.05
    r.outputColorSpace = THREE.SRGBColorSpace
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFSoftShadowMap

    this.escena.environment = entornoBar(r)
    this.escena.environmentIntensity = 1

    // ── Luces ─────────────────────────────────────────────────────────────
    this.luzClave = new THREE.SpotLight(0xffd8b0, 140, 0, 0.42, 0.75, 2)
    this.luzClave.position.set(-2.6, 6.2, 3.4)
    this.luzClave.target.position.set(0, 0.8, 0)
    this.luzClave.castShadow = true
    this.luzClave.shadow.mapSize.set(1024, 1024)
    this.luzClave.shadow.bias = -0.0004
    this.luzClave.shadow.radius = 6
    this.escena.add(this.luzClave, this.luzClave.target)
    const contra = new THREE.DirectionalLight(0x9cc0ff, 1.6)
    contra.position.set(1.5, 3, -5)
    this.escena.add(contra)
    this.escena.add(new THREE.HemisphereLight(0xffe2c4, 0x140d08, 0.35))
    // La luz que atraviesa la cerveza y tiñe la bandeja de ámbar
    this.luzCerveza = new THREE.PointLight(0xffb040, 0, 1.7, 2)
    this.luzCerveza.position.set(0, 0.04, 0.95)
    this.escena.add(this.luzCerveza)

    // ── Materiales ────────────────────────────────────────────────────────
    const cromo = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, metalness: 1, roughness: 0.07 })
    const acero = new THREE.MeshStandardMaterial({ color: 0xd8dde0, metalness: 1, roughness: 0.32 })
    this.matVidrio = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.012, transmission: 1, thickness: 0.05, ior: 1.5,
      specularIntensity: 0.85, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.5,
      attenuationColor: new THREE.Color(0xe6fff2), attenuationDistance: 2.5,
      bumpMap: texturaRocio(), bumpScale: 0.0,
    })
    this.matEspuma = new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.82, bumpMap: texturaEspuma(), bumpScale: 1.6, side: THREE.DoubleSide })
    this.matChorro = new THREE.MeshPhysicalMaterial({
      color: 0xd9a21b, emissive: 0xffc860, emissiveMap: this.texVetas, emissiveIntensity: 0.9,
      roughness: 0.06, clearcoat: 1,
    })
    // Todo lo que está DENTRO del vaso tiene que ser opaco: Three.js dibuja lo
    // transparente después del vidrio, y la pared de adelante lo taparía. Lo
    // opaco, en cambio, entra en la pasada de transmisión y se ve refractado.
    this.matBurbuja = new THREE.MeshStandardMaterial({ color: 0xfff6e2, roughness: 0.08, metalness: 0, emissive: 0xfff2d0, emissiveIntensity: 0.3 })
    this.matEtiqueta = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 })

    // ── El mostrador ──────────────────────────────────────────────────────
    const mesa = new THREE.Mesh(new THREE.PlaneGeometry(40, 20),
      new THREE.MeshStandardMaterial({ map: texturaMadera(), color: 0x8a6a52, roughness: 0.3, metalness: 0 }))
    mesa.rotation.x = -Math.PI / 2
    mesa.position.set(0, MESA, 8.6)
    mesa.receiveShadow = true
    this.escena.add(mesa)
    const canto = new THREE.Mesh(new THREE.BoxGeometry(40, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.25 }))
    canto.position.set(0, MESA - 0.02, -1.4)
    this.escena.add(canto)

    // ── La torre ──────────────────────────────────────────────────────────
    const torre = new THREE.Group()
    const columna = new THREE.Mesh(new THREE.CylinderGeometry(TORRE.r, TORRE.r, TORRE.alto - MESA, 48), cromo)
    columna.position.set(0, (TORRE.alto + MESA) / 2, TORRE.z)
    const capuchon = new THREE.Mesh(new THREE.SphereGeometry(TORRE.r * 1.04, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), cromo)
    capuchon.position.set(0, TORRE.alto, TORRE.z)
    const aro = new THREE.Mesh(new THREE.TorusGeometry(TORRE.r * 1.02, 0.018, 12, 48), cromo)
    aro.rotation.x = Math.PI / 2; aro.position.set(0, TORRE.alto - 0.02, TORRE.z)
    const pie = new THREE.Mesh(new THREE.CylinderGeometry(TORRE.r * 1.3, TORRE.r * 1.55, 0.12, 48), cromo)
    pie.position.set(0, MESA + 0.06, TORRE.z)
    for (const m of [columna, capuchon, aro, pie]) { m.castShadow = true; torre.add(m) }

    // ── La canilla: sale de la torre hacia el cliente ─────────────────────
    const yC = 2.33
    const largo = -TORRE.z - TORRE.r + 0.06
    const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, largo, 40), cromo)
    cuerpo.rotation.x = Math.PI / 2
    cuerpo.position.set(0, yC, TORRE.z + TORRE.r + largo / 2 - 0.02)
    const tuerca = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.13, 6), cromo)
    tuerca.rotation.x = Math.PI / 2
    tuerca.position.set(0, yC, TORRE.z + TORRE.r + 0.1)
    const punta = new THREE.Mesh(new THREE.SphereGeometry(0.075, 32, 16), cromo)
    punta.position.set(0, yC, 0.04)
    const pico = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.044, yC - PICO.y, 32), cromo)
    pico.position.set(0, (yC + PICO.y) / 2, 0)
    const labio = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.008, 10, 32), cromo)
    labio.rotation.x = Math.PI / 2; labio.position.copy(PICO)
    const bonete = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 32), cromo)
    bonete.position.set(PIVOTE.x, PIVOTE.y - 0.05, PIVOTE.z)
    for (const m of [cuerpo, tuerca, punta, pico, labio, bonete]) { m.castShadow = true; torre.add(m) }
    this.escena.add(torre)

    // ── La manija: laca negra, virola de cromo y la placa con el nombre ────
    const virola = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.048, 0.16, 32), cromo)
    virola.position.y = 0.08
    const perfil = [new THREE.Vector2(0.045, 0.16), new THREE.Vector2(0.05, 0.3), new THREE.Vector2(0.066, 0.95),
      new THREE.Vector2(0.07, 1.02), new THREE.Vector2(0.06, 1.07), new THREE.Vector2(0.03, 1.09), new THREE.Vector2(0, 1.095)]
    const laca = new THREE.Mesh(new THREE.LatheGeometry(perfil, 40),
      new THREE.MeshPhysicalMaterial({ color: 0x0b0b0c, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 }))
    const placa = new THREE.Mesh(new THREE.CylinderGeometry(0.0675, 0.0555, 0.56, 40, 1, true, ANG - Math.PI, Math.PI * 2), this.matEtiqueta)
    placa.position.y = 0.66
    const tapa = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), cromo)
    tapa.position.y = 1.09
    for (const m of [virola, laca, placa, tapa]) { m.castShadow = true; this.manija.add(m) }
    this.manija.position.copy(PIVOTE)
    this.escena.add(this.manija)

    // ── La bandeja de goteo ───────────────────────────────────────────────
    const bandeja = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.0), acero)
    bandeja.position.set(0, MESA + 0.05, 0.05)
    bandeja.castShadow = true; bandeja.receiveShadow = true
    const rejilla = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.92),
      new THREE.MeshStandardMaterial({ map: texturaRejilla(), metalness: 0.85, roughness: 0.38 }))
    rejilla.rotation.x = -Math.PI / 2
    rejilla.position.set(0, 0.001, 0.05)
    rejilla.receiveShadow = true
    this.escena.add(bandeja, rejilla)

    // ── El vidrio (compartido por todos los vasos) ────────────────────────
    this.geoVidrio = this.geometriaVidrio()

    // ── Chorro, gotas y salpicaduras ──────────────────────────────────────
    const geoChorro = new THREE.CylinderGeometry(0.046, 0.03, 1, 28, 6, true)
    geoChorro.translate(0, -0.5, 0)
    this.chorroM = new THREE.Mesh(geoChorro, this.matChorro)
    this.chorroM.visible = false
    this.escena.add(this.chorroM)
    this.gotasM = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), this.matChorro, 4)
    this.gotasM.count = 0
    this.salpicaM = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), this.matChorro, 48)
    this.salpicaM.count = 0
    this.escena.add(this.gotasM, this.salpicaM)
  }

  // ── API (la misma que el motor 2D) ─────────────────────────────────────────
  medir(cssW: number, cssH: number, reducido: boolean) {
    if (cssW < 10 || cssH < 10) return
    this.cssW = cssW; this.cssH = cssH; this.reducido = reducido
    this.dpr = this.calidad === 'baja' ? 1 : Math.min(1.75, window.devicePixelRatio || 1)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(cssW, cssH, false)

    // La escena ocupa el 58 % de arriba con la tablet parada, o el 54 % de la
    // izquierda acostada. La cámara se arma para esa zona y el resto de la
    // pantalla (donde va el texto) sigue siendo el mismo mostrador.
    const apaisado = cssW / cssH > 1.05
    const aw = apaisado ? cssW * 0.54 : cssW
    const ah = apaisado ? cssH : cssH * 0.58
    const c = this.camara
    c.aspect = aw / ah
    const alto = Math.max(3.95, 2.25 / c.aspect)
    const d = alto / (2 * Math.tan(THREE.MathUtils.degToRad(c.fov / 2)))
    const objetivo = new THREE.Vector3(-0.06, 1.62, -0.3)
    c.position.copy(objetivo).addScaledVector(DIR_CAM, d)
    c.lookAt(objetivo)
    c.setViewOffset(aw, ah, 0, 0, cssW, cssH)
    c.updateProjectionMatrix()

    this.pintarFondo()
    this.ponerPared(d, aw, ah)
    this.prepararManija()
    for (const v of this.vasos) v.hecho = { nivel: -1, espuma: -1 }
  }

  actualizar(e: Entrada) {
    const ahora = performance.now() / 1000
    if (e.modo === 'servida' && (this.entrada.modo === 'sirviendo' || this.entrada.modo === 'lista') && this.entrada.sesion) {
      this.alias = { de: e.sesion, a: this.entrada.sesion }
    }
    if (this.alias && e.modo === 'servida' && e.sesion === this.alias.de) e = { ...e, sesion: this.alias.a }
    const cambioColor = e.color !== this.entrada.color
    const cambioEtiqueta = e.etiqueta !== this.entrada.etiqueta
    if (e.sesion !== this.entrada.sesion || e.ml < this.mlPrevio) {
      this.mlPrevio = e.ml; this.mlVisual = e.ml; this.mlContador = e.ml; this.caudal = 0; this.cambioEn = 0
    } else if (e.ml > this.mlPrevio) {
      const dt = this.cambioEn > 0 ? ahora - this.cambioEn : 0
      if (dt > 0.05 && dt < 4) {
        const r = (e.ml - this.mlPrevio) / dt
        this.caudal = this.caudal > 0 ? this.caudal * 0.5 + r * 0.5 : r
      }
      this.mlPrevio = e.ml; this.cambioEn = ahora
    }
    this.entrada = e
    if (cambioColor) { this.pal = paleta(e.color); this.aplicarColor() }
    if (cambioColor || cambioEtiqueta) this.prepararManija()
  }

  iniciar() {
    if (this.raf) return
    this.aplicarColor()
    this.ultimo = performance.now()
    const paso = (t: number) => {
      this.raf = requestAnimationFrame(paso)
      const ms = t - this.ultimo
      const dt = Math.min(0.05, ms / 1000)
      this.ultimo = t
      if (document.hidden) return
      // Si la tablet no llega, se baja la densidad de píxeles una vez.
      if (this.calidad === 'alta' && this.reloj > 3 && ms < 500) {
        this.lento = ms > 30 ? this.lento + ms / 1000 : Math.max(0, this.lento - ms / 2000)
        if (this.lento > 2) {
          this.calidad = 'baja'
          this.renderer.shadowMap.enabled = false
          this.medir(this.cssW, this.cssH, this.reducido)
        }
      }
      this.avanzar(dt)
      this.renderer.render(this.escena, this.camara)
    }
    this.raf = requestAnimationFrame(paso)
  }

  detener() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.renderer.dispose()
  }

  repintarManija() { this.prepararManija() }

  // ── Simulación ─────────────────────────────────────────────────────────────
  private avanzar(dt: number) {
    this.reloj += dt
    const ahora = performance.now() / 1000
    const e = this.entrada
    const vaso = Math.max(50, e.vaso)

    this.fluyendo = e.modo === 'sirviendo' && this.cambioEn > 0 && ahora - this.cambioEn < 2.4
    const pred = this.fluyendo ? e.ml + this.caudal * Math.min(1.1, ahora - this.cambioEn) : e.ml
    this.mlVisual = Math.max(this.mlVisual, acercar(this.mlVisual, pred, 0.22, dt))
    if (!this.fluyendo && this.mlVisual > e.ml + 0.5) this.mlVisual = acercar(this.mlVisual, e.ml, 0.4, dt)
    this.mlContador = Math.min(e.ml, acercar(this.mlContador, e.ml, 0.3, dt))
    const contado = Math.round(this.mlContador)
    if (contado !== this.ultimoContado) { this.ultimoContado = contado; this.alContar?.(contado) }

    // ── Qué vaso corresponde ──────────────────────────────────────────────
    let clave: string, objetivo: number
    if (e.modo === 'exhibicion') { clave = 'muestra'; objetivo = 1 }
    else if (e.modo === 'apagada') { clave = 'vacio'; objetivo = 0 }
    else {
      const medido = e.modo === 'lista' ? 0 : e.ml
      const indice = medido > 0 ? Math.ceil(medido / vaso - 1e-6) - 1 : 0
      const visto = Math.min((indice + 1) * vaso, Math.max(indice * vaso, e.modo === 'lista' ? 0 : this.mlVisual))
      clave = `s:${e.sesion ?? '-'}:${indice}`
      objetivo = medido > 0 ? (visto - indice * vaso) / vaso : 0
    }
    let activo = this.vasos.find(v => !v.saliendo)
    if (activo && activo.clave !== clave && activo.nivel < 0.004 && clave !== 'muestra' && activo.clave !== 'muestra') activo.clave = clave
    if (!activo || activo.clave !== clave) {
      if (activo) { activo.saliendo = true; activo.t = 0 }
      const muestra = clave === 'muestra'
      const inicial = muestra ? 1 : Math.max(0, Math.min(1, objetivo))
      const algo = inicial > 0.02
      activo = this.nuevoVaso(clave, inicial, muestra ? 0.19 : algo ? Math.min(0.2, 0.02 + alturaDe(inicial) * 0.15) : 0, algo ? 1 : 0)
    }

    for (const v of this.vasos) {
      v.t = Math.min(1, v.t + dt / (v.saliendo ? 0.6 : 0.7))
      if (v === activo) v.nivel = e.modo === 'sirviendo' ? Math.min(1, objetivo) : acercar(v.nivel, objetivo, 0.6, dt)
      this.avanzarVaso(v, dt, v === activo && this.fluyendo && this.chorro === 'si')
    }
    for (const v of this.vasos.filter(x => x.saliendo && x.t >= 1)) this.quitarVaso(v)
    this.vasos = this.vasos.filter(v => !(v.saliendo && v.t >= 1))

    // ── Manija: resorte ───────────────────────────────────────────────────
    const meta = this.fluyendo ? MANIJA_ABIERTA : MANIJA_CERRADA
    if (this.reducido) this.angulo = meta
    else {
      this.velAngulo += (-140 * (this.angulo - meta) - 19 * this.velAngulo) * dt
      this.angulo += this.velAngulo * dt
    }
    this.manija.rotation.x = this.angulo

    // ── Chorro ────────────────────────────────────────────────────────────
    const impacto = this.impacto(activo)
    if (this.fluyendo && (this.chorro === 'no' || this.chorro === 'cortando')) {
      this.chorro = 'bajando'; this.cabeza = PICO.y; this.vCabeza = 1.2; this.cola = PICO.y; this.vCola = 0
    }
    if (!this.fluyendo && (this.chorro === 'si' || this.chorro === 'bajando')) {
      this.chorro = 'cortando'; this.vCola = 0.8; this.goteos = [0.35, 0.95, 1.9]
    }
    if (this.chorro === 'bajando') {
      this.vCabeza += G * dt; this.cabeza -= this.vCabeza * dt
      if (this.cabeza <= impacto) { this.cabeza = impacto; this.chorro = 'si' }
    } else if (this.chorro === 'si') this.cabeza = impacto
    else if (this.chorro === 'cortando') {
      this.cabeza = Math.min(this.cabeza, impacto)
      this.vCola += G * dt; this.cola -= this.vCola * dt
      if (this.cola <= this.cabeza) { this.chorro = 'no'; this.cola = PICO.y }
    }
    const arriba = this.chorro === 'cortando' ? this.cola : PICO.y
    const largo = arriba - this.cabeza
    this.chorroM.visible = this.chorro !== 'no' && largo > 0.01
    if (this.chorroM.visible) {
      const ond = this.reducido ? 0 : Math.sin(this.reloj * 11) * 0.004
      this.chorroM.position.set(ond, arriba, 0)
      this.chorroM.scale.set(1, largo, 1)
      if (!this.reducido) this.texVetas.offset.y = (this.texVetas.offset.y + dt * 3.2) % 1
    }

    // Goteo después de cerrar
    if (this.goteos.length) {
      this.goteos = this.goteos.map(t => t - dt)
      while (this.goteos.length && this.goteos[0] <= 0) { this.goteos.shift(); this.gotas.push({ y: PICO.y - 0.02, vy: 0.2 }) }
    }
    for (const g of this.gotas) { g.vy += G * 0.6 * dt; g.y -= g.vy * dt }
    this.gotas = this.gotas.filter(g => g.y > impacto)
    this.gotasM.count = this.gotas.length
    this.gotas.forEach((g, i) => {
      this.dummy.position.set(0, g.y, 0); this.dummy.scale.set(0.014, 0.022, 0.014); this.dummy.rotation.set(0, 0, 0)
      this.dummy.updateMatrix(); this.gotasM.setMatrixAt(i, this.dummy.matrix)
    })
    this.gotasM.instanceMatrix.needsUpdate = true

    // Salpicaduras
    if (this.chorro === 'si' && !this.reducido && Math.random() < dt * 40 && this.salpica.length < 48) {
      const a = Math.random() * Math.PI * 2, s = 0.25 + Math.random() * 0.5
      this.salpica.push({ p: new THREE.Vector3(0, impacto + 0.01, 0), v: new THREE.Vector3(Math.cos(a) * s, 1 + Math.random() * 1.4, Math.sin(a) * s), vida: 0.35 + Math.random() * 0.2 })
    }
    for (const s of this.salpica) { s.v.y -= 14 * dt; s.p.addScaledVector(s.v, dt); s.vida -= dt }
    // Una gota que vuelve a la superficie se mete en la espuma: deja de existir.
    this.salpica = this.salpica.filter(s => s.vida > 0 && (s.v.y > 0 || s.p.y > impacto))
    this.salpicaM.count = this.salpica.length
    this.salpica.forEach((s, i) => {
      this.dummy.position.copy(s.p); const k = 0.006 + s.vida * 0.012; this.dummy.scale.set(k, k, k)
      this.dummy.updateMatrix(); this.salpicaM.setMatrixAt(i, this.dummy.matrix)
    })
    this.salpicaM.instanceMatrix.needsUpdate = true

    // Luz de escenario y luz que atraviesa la cerveza
    const metaLuz = e.modo === 'lista' || e.modo === 'sirviendo' ? 1 : e.modo === 'apagada' ? 0.35 : 0.75
    this.luz = acercar(this.luz, metaLuz, 0.5, dt)
    this.luzClave.intensity = 150 * this.luz
    const nivelActivo = activo ? activo.nivel : 0
    this.luzCerveza.intensity = acercar(this.luzCerveza.intensity, Math.min(1, nivelActivo * 3) * 1.6 * this.luz, 0.4, dt)
  }

  private impacto(v: Vaso | undefined): number {
    if (!v || v.t < 0.8) return 0.01
    if (v.nivel < 0.004) return FONDO + 0.005
    return FONDO + alturaDe(v.nivel) + v.espuma
  }

  private avanzarVaso(v: Vaso, dt: number, recibe: boolean) {
    const alto = alturaDe(v.nivel)
    const sup = FONDO + alto
    const metaE = v.nivel < 0.004 ? 0 : Math.min(0.2, 0.02 + alto * 0.17)
    if (recibe) v.espuma = acercar(v.espuma, metaE, 0.45, dt)
    else {
      const m = Math.max(metaE * 0.55, Math.min(v.espuma, metaE * 0.82))
      v.espuma = acercar(v.espuma, m, v.espuma < m ? 1.2 : 14, dt)
    }
    if (v.nivel < 0.004) v.espuma = acercar(v.espuma, 0, 0.3, dt)
    v.turbio = recibe ? acercar(v.turbio, 1, 0.35, dt) : acercar(v.turbio, 0, 1.4, dt)
    if (v.nivel > 0.02) v.frio = Math.min(1, v.frio + dt / 7)

    // Burbujas: sobre la cara del líquido que mira la cámara
    if (alto > 0.03) {
      const mult = this.reducido || this.calidad === 'baja' ? 0.45 : 1
      const r = Math.random
      const n = (26 + alto * 40 + (recibe ? 160 : 0)) * mult * dt
      for (let k = 0; k < Math.floor(n) + (r() < n % 1 ? 1 : 0); k++) {
        const arr = recibe && r() < 0.6
        v.burbujas.push({
          ang: ANG + (r() - 0.5) * 2.4,
          y: arr ? sup - 0.02 - r() * 0.12 : FONDO + 0.01 + r() * alto * (r() < 0.4 ? 0.1 : 0.9),
          r: 0.0035 + r() * 0.006, arrastre: arr ? 0.6 + r() * 0.9 : 0, fase: r() * 6,
        })
      }
    }
    const tope = this.reducido || this.calidad === 'baja' ? 160 : 380
    if (v.burbujas.length > tope) v.burbujas.splice(0, v.burbujas.length - tope)
    for (const b of v.burbujas) {
      b.r += dt * 0.0012
      b.arrastre = Math.max(0, b.arrastre - dt * 2.6)
      b.y += (0.3 + b.r * 40 - b.arrastre) * dt
      b.fase += dt * 3
      b.ang += Math.sin(b.fase) * 0.002
    }
    v.burbujas = v.burbujas.filter(b => b.y < sup - 0.004 && b.y > FONDO)

    // ── Geometría y materiales del vaso ───────────────────────────────────
    if (Math.abs(v.hecho.nivel - v.nivel) > 0.0015 || Math.abs(v.hecho.espuma - v.espuma) > 0.002) {
      this.armarLiquido(v)
      v.hecho = { nivel: v.nivel, espuma: v.espuma }
    }
    v.liquido.visible = v.nivel > 0.004
    v.espumaM.visible = v.nivel > 0.004 && v.espuma > 0.004
    const p = this.pal
    v.matLiq.color.copy(color3(mezclar(p.base, [255, 246, 220], v.turbio * 0.22)))
    v.matLiq.emissiveIntensity = 0.55 + v.turbio * 0.35

    const m = v.burbujasM
    m.count = v.burbujas.length
    v.burbujas.forEach((b, i) => {
      const rr = rLiq(b.y) + 0.002
      this.dummy.position.set(Math.sin(b.ang) * rr, b.y, Math.cos(b.ang) * rr)
      this.dummy.scale.setScalar(b.r)
      this.dummy.updateMatrix()
      m.setMatrixAt(i, this.dummy.matrix)
    })
    m.instanceMatrix.needsUpdate = true

    // El que se va sale hacia la derecha, deslizándose por la barra; el nuevo
    // entra desde la izquierda. Pasan por delante de la torre (está más atrás),
    // así que nunca la atraviesan. Con movimiento reducido, cambian sin viaje.
    if (v.saliendo) {
      v.grupo.position.x = this.reducido ? 0 : SALIDA * suaveInOut(v.t)
      v.grupo.visible = !this.reducido && v.t < 1
    } else if (v.t < 1) {
      v.grupo.position.x = this.reducido ? 0 : -SALIDA * (1 - (1 - Math.pow(1 - v.t, 3)))
      v.grupo.visible = true
    } else v.grupo.position.x = 0
    // Rocío: el vidrio se moja de a poco cuando hay cerveza fría adentro
    if (v === this.vasos.find(x => !x.saliendo)) this.matVidrio.bumpScale = 0.35 * v.frio
  }

  private nuevoVaso(clave: string, nivel: number, espuma: number, frio: number): Vaso {
    const grupo = new THREE.Group()
    const vidrio = new THREE.Mesh(this.geoVidrio, this.matVidrio)
    vidrio.renderOrder = 2
    const matLiq = new THREE.MeshPhysicalMaterial({
      // De los dos lados: el torno arma las caras según el orden del perfil, y
      // de un solo lado se vería el interior de la cara de atrás, con lo que
      // está adentro (el chorro, las salpicaduras) a la vista a través de la
      // cerveza.
      side: THREE.DoubleSide,
      color: color3(this.pal.base), roughness: 0.16, clearcoat: 0.6,
      emissive: color3(this.pal.luz), emissiveMap: this.texLente, emissiveIntensity: 0.55,
    })
    const liquido = new THREE.Mesh(new THREE.BufferGeometry(), matLiq)
    liquido.castShadow = true
    const espumaM = new THREE.Mesh(new THREE.BufferGeometry(), this.matEspuma.clone())
    const burbujasM = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), this.matBurbuja, 420)
    burbujasM.count = 0
    burbujasM.frustumCulled = false
    grupo.add(liquido, espumaM, burbujasM, vidrio)
    this.escena.add(grupo)
    const v: Vaso = {
      clave, t: this.vasos.length ? 0 : 1, saliendo: false, nivel, espuma, turbio: 0, frio,
      burbujas: [], grupo, liquido, espumaM, burbujasM, matLiq, hecho: { nivel: -1, espuma: -1 },
    }
    this.vasos.push(v)
    this.semillas++
    this.aplicarColorVaso(v)
    return v
  }

  private quitarVaso(v: Vaso) {
    this.escena.remove(v.grupo)
    v.liquido.geometry.dispose(); v.espumaM.geometry.dispose()
    v.matLiq.dispose(); (v.espumaM.material as THREE.Material).dispose()
    v.burbujasM.geometry.dispose()
  }

  // ── Geometría ──────────────────────────────────────────────────────────────
  private geometriaVidrio(): THREE.LatheGeometry {
    const P = THREE.Vector2
    const pts = [
      new P(0, 0.002), new P(R_BASE - 0.03, 0), new P(R_BASE - 0.004, 0.012), new P(R_BASE, 0.04),
      new P(R_BOCA, VASO_H - 0.01), new P(R_BOCA - 0.004, VASO_H), new P(R_BOCA - PARED + 0.004, VASO_H),
      new P(R_BOCA - PARED, VASO_H - 0.01), new P(rInt(FONDO + 0.04), FONDO + 0.04),
      new P(rInt(FONDO) - 0.04, FONDO), new P(0, FONDO),
    ]
    return new THREE.LatheGeometry(pts, 96, ANG - Math.PI)
  }

  private armarLiquido(v: Vaso) {
    const P = THREE.Vector2
    const sup = FONDO + alturaDe(v.nivel)
    const y0 = FONDO + 0.003
    const liq = [new P(0, y0), new P(rLiq(y0) - 0.035, y0), new P(rLiq(y0 + 0.03), y0 + 0.03), new P(rLiq(sup), sup), new P(0, sup)]
    v.liquido.geometry.dispose()
    v.liquido.geometry = new THREE.LatheGeometry(liq, 72, ANG - Math.PI)

    // La espuma: sigue la pared y, si pasa la boca, forma una corona apenas
    // más angosta, con la cara de arriba en cúpula.
    const tope = sup + v.espuma
    const pts: THREE.Vector2[] = [new P(rLiq(sup) + 0.001, sup)]
    if (tope > VASO_H) {
      pts.push(new P(rLiq(VASO_H) + 0.001, VASO_H))
      const corona = tope - VASO_H
      pts.push(new P(rLiq(VASO_H) - corona * 0.25, tope - 0.012))
    } else pts.push(new P(rLiq(tope) + 0.001, tope - 0.01))
    const rT = pts[pts.length - 1].x
    pts.push(new P(rT * 0.85, tope + 0.006), new P(rT * 0.45, tope + 0.016), new P(0, tope + 0.02))
    v.espumaM.geometry.dispose()
    v.espumaM.geometry = new THREE.LatheGeometry(pts, 72, ANG - Math.PI)
  }

  // ── Color ──────────────────────────────────────────────────────────────────
  private aplicarColor() {
    const p = this.pal
    this.matChorro.color.copy(color3(p.base))
    this.matChorro.emissive.copy(color3(p.luz))
    this.luzCerveza.color.copy(color3(p.luz))
    this.matEspuma.color.copy(color3(p.espuma))
    for (const v of this.vasos) this.aplicarColorVaso(v)
  }

  private aplicarColorVaso(v: Vaso) {
    const p = this.pal
    v.matLiq.color.copy(color3(p.base))
    v.matLiq.emissive.copy(color3(p.luz))
    ;(v.espumaM.material as THREE.MeshStandardMaterial).color.copy(color3(p.espuma))
    // En una cerveza negra las burbujas se ven tostadas y apagadas.
    this.matBurbuja.color.copy(color3(mezclar(p.brillo, [255, 250, 240], 0.25 + p.luminosidad * 0.6)))
    this.matBurbuja.emissiveIntensity = 0.1 + p.luminosidad * 0.3
  }

  private prepararManija() {
    const vieja = this.matEtiqueta.map
    this.matEtiqueta.map = texturaManija(this.entrada.etiqueta, this.pal)
    this.matEtiqueta.needsUpdate = true
    vieja?.dispose()
  }

  private ponerPared(d: number, aw: number, ah: number) {
    const c = this.camara
    const D = d + 16
    // A esa distancia, un píxel de la zona de la escena mide `u` unidades. La
    // pantalla entera (que se estira más allá de esa zona con setViewOffset)
    // mide entonces cssW·u por cssH·u: el plano la cubre exacta y el fondo
    // queda a la misma escala que si estuviera pintado en la pantalla.
    const u = 2 * D * Math.tan(THREE.MathUtils.degToRad(c.fov / 2)) / ah
    const alto = this.cssH * u * 1.02
    const ancho = this.cssW * u * 1.02
    if (this.pared) {
      this.escena.remove(this.pared)
      this.pared.geometry.dispose()
      const m = this.pared.material as THREE.MeshBasicMaterial
      m.map?.dispose(); m.dispose()
    }
    const tex = new THREE.CanvasTexture(this.fondo)
    tex.colorSpace = THREE.SRGBColorSpace
    const pared = new THREE.Mesh(new THREE.PlaneGeometry(ancho, alto),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, depthWrite: false }))
    pared.renderOrder = -1
    // El centro de la pantalla está corrido respecto del centro de la zona de
    // la escena: el plano se corre igual para que el fondo cubra todo.
    const adelante = new THREE.Vector3(); c.getWorldDirection(adelante)
    const derecha = new THREE.Vector3().crossVectors(adelante, c.up).normalize()
    const arriba = new THREE.Vector3().crossVectors(derecha, adelante).normalize()
    const pxAUnidad = u
    pared.position.copy(c.position).addScaledVector(adelante, D)
      .addScaledVector(derecha, (this.cssW / 2 - aw / 2) * pxAUnidad)
      .addScaledVector(arriba, -(this.cssH / 2 - ah / 2) * pxAUnidad)
    pared.quaternion.copy(c.quaternion)
    this.escena.add(pared)
    this.pared = pared
  }

  // ── Fondo: la pared del bar de noche, desenfocada ─────────────────────────
  private pintarFondo() {
    const f = this.fondo
    const s = Math.min(1.5, this.dpr)
    f.width = Math.round(this.cssW * s); f.height = Math.round(this.cssH * s)
    const c = f.getContext('2d')!
    const W = this.cssW, H = this.cssH
    c.setTransform(s, 0, 0, s, 0, 0)
    // Dónde cae el fondo del mostrador en la pantalla: de ahí para abajo lo
    // dibuja el 3D.
    const v = new THREE.Vector3(0, MESA, -1.4).project(this.camara)
    const horizonte = (1 - v.y) / 2 * H
    const pared = c.createLinearGradient(0, 0, 0, horizonte)
    pared.addColorStop(0, '#090d10'); pared.addColorStop(0.6, '#121a1f'); pared.addColorStop(1, '#1a1612')
    c.fillStyle = pared
    c.fillRect(0, 0, W, H)
    const m = Math.min(W, H)
    const rnd = azar(31337)
    c.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 46; i++) {
      const x = rnd() * W, y = m * 0.03 + rnd() * Math.max(10, horizonte - m * 0.06)
      const r = m * (0.02 + rnd() * rnd() * 0.075)
      const t = rnd()
      const col: RGB = t < 0.62 ? [255, 168, 82] : t < 0.88 ? [255, 214, 152] : [118, 168, 196]
      const a = 0.05 + rnd() * 0.15
      const g = c.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, css(col, a * 0.5)); g.addColorStop(0.8, css(col, a * 0.75)); g.addColorStop(0.95, css(col, a * 0.3)); g.addColorStop(1, css(col, 0))
      c.fillStyle = g
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill()
    }
    // Una luz cálida detrás del vaso, como la de la contrabarra. El vidrio
    // refracta el fondo: sin luz detrás, un vaso vacío se ve oscuro.
    const pv = new THREE.Vector3(0, 0.9, -0.4).project(this.camara)
    const gx = (pv.x + 1) / 2 * W, gy = (1 - pv.y) / 2 * H
    const halo = c.createRadialGradient(gx, gy, 0, gx, gy, m * 0.42)
    halo.addColorStop(0, 'rgba(255,184,110,0.30)')
    halo.addColorStop(0.5, 'rgba(255,170,95,0.12)')
    halo.addColorStop(1, 'rgba(255,170,95,0)')
    c.fillStyle = halo
    c.fillRect(0, 0, W, H)
    const tira = c.createLinearGradient(0, horizonte * 0.38, 0, horizonte * 0.52)
    tira.addColorStop(0, 'rgba(255,190,120,0)'); tira.addColorStop(0.5, 'rgba(255,190,120,0.08)'); tira.addColorStop(1, 'rgba(255,190,120,0)')
    c.fillStyle = tira
    c.fillRect(0, horizonte * 0.38, W, horizonte * 0.14)
    c.globalCompositeOperation = 'source-over'
    const vi = c.createRadialGradient(W * 0.5, H * 0.35, m * 0.25, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.62)
    vi.addColorStop(0, 'rgba(0,0,0,0)'); vi.addColorStop(1, 'rgba(0,0,0,0.62)')
    c.fillStyle = vi
    c.fillRect(0, 0, W, H)
  }
}
