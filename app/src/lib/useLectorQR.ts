import { useCallback, useEffect, useRef, useState } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// La cámara de la tablet como lector de códigos QR.
//
// Reemplaza al lector NFC: el cliente muestra el QR de su app o el de su ticket
// y la tablet lo lee sola, sin que nadie toque nada.
//
// ── Dos formas de leer ───────────────────────────────────────────────────────
// 1. `BarcodeDetector`, que es del navegador: Chrome en Android lo trae y usa
//    el lector del sistema. Rápido y casi sin gasto.
// 2. `jsQR`, una librería que hace lo mismo a mano sobre los píxeles. Solo se
//    descarga si lo primero no está (o falla): así ninguna tablet se queda sin
//    leer por ser vieja.
//
//   Es feature detection con polyfill: se usa lo nativo si está, y si no, el
//   repuesto.
//
// ── Por qué la cámara queda siempre prendida ─────────────────────────────────
// A diferencia del NFC, el navegador recuerda el permiso de la cámara para el
// sitio: se da una vez y al recargar la página arranca sola, sin tocar nada.
// Por eso acá no hay botón de "encender" salvo que el permiso falte.
// ─────────────────────────────────────────────────────────────────────────────

export type EstadoCamara =
  | 'apagada'      // todavía no se pidió, o no hace falta
  | 'pidiendo'     // esperando al navegador (o al permiso)
  | 'leyendo'      // con imagen, buscando un QR
  | 'sin_permiso'  // el usuario o el navegador dijeron que no
  | 'sin_camara'   // el aparato no tiene, o no es https
  | 'error'        // se cortó: se reintenta sola

type Detector = { detect: (fuente: CanvasImageSource) => Promise<{ rawValue: string }[]> }
type ConDetector = { BarcodeDetector?: new (o: { formats: string[] }) => Detector }

const CADA_MS = 180          // unas cinco lecturas por segundo: sobra para un QR quieto
const LADO_MAXIMO = 560      // a jsQR se le pasa la imagen achicada; un QR de 29×29 se lee igual
const CLAVE_CAMARA = 'grifo.camara'

function leerPreferencia(): boolean {
  try { return localStorage.getItem(CLAVE_CAMARA) !== 'trasera' } catch { return true }
}

export function useLectorQR({ habilitado, leyendo, alLeer }: {
  /** Si la cámara tiene que estar prendida. */
  habilitado: boolean
  /** Si hay que buscar códigos ahora. Con la canilla ocupada no: la cámara
   *  sigue prendida, pero no se gasta procesador mirando. */
  leyendo: boolean
  alLeer: (texto: string) => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [estado, setEstado] = useState<EstadoCamara>('apagada')
  const [detalle, setDetalle] = useState<string | null>(null)
  const [frontal, setFrontal] = useState(leerPreferencia)
  const [intento, setIntento] = useState(0)
  const [flujo, setFlujo] = useState<MediaStream | null>(null)

  // Lo que cambia seguido va por referencia: el bucle de lectura no se rearma
  // cada vez que la pantalla se redibuja.
  const callback = useRef(alLeer); callback.current = alLeer
  const buscando = useRef(leyendo); buscando.current = leyendo

  // ── Abrir la cámara ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!habilitado) { setEstado('apagada'); return }
    if (!navigator.mediaDevices?.getUserMedia) {
      setEstado('sin_camara')
      setDetalle(window.isSecureContext
        ? 'Este navegador no deja usar la cámara.'
        : 'La cámara solo funciona con https.')
      return
    }

    let vigente = true
    let abierto: MediaStream | null = null
    let reintento: number | undefined
    setEstado('pidiendo'); setDetalle(null)

    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        // `ideal` y no `exact`: si la tablet tiene una sola cámara, que use esa.
        facingMode: { ideal: frontal ? 'user' : 'environment' },
        width: { ideal: 1280 }, height: { ideal: 720 },
      },
    }).then(s => {
      if (!vigente) { s.getTracks().forEach(t => t.stop()); return }
      abierto = s
      // Si otra app se queda con la cámara, el navegador corta la pista.
      // Se vuelve a pedir sola en un par de segundos.
      s.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (!vigente) return
        setEstado('error'); setDetalle('Se cortó la cámara. Reintentando.')
        reintento = window.setTimeout(() => setIntento(i => i + 1), 2000)
      })
      setFlujo(s); setEstado('leyendo')
    }).catch((e: DOMException) => {
      if (!vigente) return
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') {
        setEstado('sin_permiso')
        setDetalle('Falta el permiso de la cámara.')
      } else if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') {
        setEstado('sin_camara')
        setDetalle('Esta tablet no tiene cámara disponible.')
      } else {
        // Ocupada por otra app, o un error pasajero del sistema.
        setEstado('error')
        setDetalle(`No se pudo abrir la cámara (${e.name}). Reintentando.`)
        reintento = window.setTimeout(() => setIntento(i => i + 1), 4000)
      }
    })

    return () => {
      vigente = false
      if (reintento) clearTimeout(reintento)
      abierto?.getTracks().forEach(t => t.stop())
      setFlujo(null)
    }
  }, [habilitado, frontal, intento])

  // ── Conectar la imagen al <video> ────────────────────────────────────────
  useEffect(() => {
    const v = video.current
    if (!v) return
    v.srcObject = flujo
    if (flujo) void v.play().catch(() => { /* arranca sola con autoplay+muted */ })
  }, [flujo])

  // Al volver de otra app o de la pantalla apagada, la pista puede haber muerto
  // sin avisar. Se revisa y, si hace falta, se abre de nuevo.
  useEffect(() => {
    if (!habilitado) return
    const alVolver = () => {
      if (document.visibilityState !== 'visible') return
      const viva = flujo?.getVideoTracks().some(t => t.readyState === 'live')
      if (!viva) setIntento(i => i + 1)
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [habilitado, flujo])

  // ── El bucle de lectura ──────────────────────────────────────────────────
  useEffect(() => {
    if (!flujo) return
    let vigente = true
    let reloj: number | undefined
    let nativo: Detector | null = null
    type LeerAMano = (d: Uint8ClampedArray, w: number, h: number, o?: { inversionAttempts?: 'dontInvert' }) => { data: string } | null
    let aMano: LeerAMano | null = null
    const lienzo = document.createElement('canvas')
    const ctx = lienzo.getContext('2d', { willReadFrequently: true })

    const cargarRepuesto = async () => {
      if (aMano) return
      const m = await import('jsqr')
      aMano = m.default as unknown as LeerAMano
    }

    const preparar = async () => {
      const B = (window as unknown as ConDetector).BarcodeDetector
      if (B) {
        try { nativo = new B({ formats: ['qr_code'] }) } catch { nativo = null }
      }
      if (!nativo) await cargarRepuesto()
    }

    const mirar = async () => {
      const v = video.current
      if (!v || v.readyState < 2 || v.videoWidth === 0) return
      let texto: string | null = null

      if (nativo) {
        try {
          const r = await nativo.detect(v)
          texto = r[0]?.rawValue ?? null
        } catch {
          // Hay tablets que anuncian el lector y después no lo tienen instalado.
          // Se pasa al repuesto y no se vuelve a intentar con el nativo.
          nativo = null
          await cargarRepuesto()
        }
      } else if (aMano && ctx) {
        const escala = Math.min(1, LADO_MAXIMO / Math.max(v.videoWidth, v.videoHeight))
        const w = Math.round(v.videoWidth * escala), h = Math.round(v.videoHeight * escala)
        if (lienzo.width !== w) lienzo.width = w
        if (lienzo.height !== h) lienzo.height = h
        ctx.drawImage(v, 0, 0, w, h)
        const img = ctx.getImageData(0, 0, w, h)
        texto = aMano(img.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null
      }

      if (texto && vigente) callback.current(texto.trim())
    }

    const vuelta = async () => {
      if (!vigente) return
      if (buscando.current && document.visibilityState === 'visible') {
        try { await mirar() } catch { /* un cuadro que falla no detiene el bucle */ }
      }
      if (vigente) reloj = window.setTimeout(vuelta, CADA_MS)
    }

    void preparar().catch(() => {}).then(vuelta)
    return () => { vigente = false; if (reloj) clearTimeout(reloj) }
  }, [flujo])

  const reintentar = useCallback(() => setIntento(i => i + 1), [])

  /** Cambia entre la cámara del frente y la de atrás, y lo recuerda. */
  const girar = useCallback(() => {
    setFrontal(f => {
      try { localStorage.setItem(CLAVE_CAMARA, f ? 'trasera' : 'frontal') } catch { /* sin almacenamiento */ }
      return !f
    })
  }, [])

  return { video, estado, detalle, frontal, reintentar, girar }
}
