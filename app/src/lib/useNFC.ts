import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizarUid } from './uid'

// ─────────────────────────────────────────────────────────────────────────────
// Lectura de tarjetas por NFC desde el celular (Web NFC).
//
// DÓNDE FUNCIONA: Chrome sobre Android, y sobre HTTPS. En iPhone no existe —
// Apple no expone el NFC a las páginas web, así que ahí solo queda el ingreso
// manual. No es algo que se pueda resolver del lado nuestro.
//
// QUÉ LEEMOS: el `serialNumber` del evento, que es el UID del chip. Llega como
// "04:5a:2b:c1" y la base guarda "045A2BC1", así que pasa por normalizarUid,
// el mismo camino que usa el lector USB de la caja. Un solo formato en toda la
// aplicación es lo que evita que la misma tarjeta se cargue con un número y el
// grifo la lea con otro.
//
// No nos importa el contenido NDEF de la tarjeta: el saldo vive en Supabase y
// la tarjeta solo aporta su identidad.
// ─────────────────────────────────────────────────────────────────────────────

// Web NFC todavía no está en las definiciones estándar de TypeScript.
type EventoNFC = { serialNumber?: string }
type LectorNFC = {
  scan: (opciones?: { signal?: AbortSignal }) => Promise<void>
  onreading: ((e: EventoNFC) => void) | null
  onreadingerror: (() => void) | null
}
declare global {
  interface Window { NDEFReader?: new () => LectorNFC }
}

export type EstadoNFC = 'no-soportado' | 'listo' | 'escaneando' | 'error'

export function useNFC(alLeer: (uid: string) => void) {
  const soportado = typeof window !== 'undefined' && 'NDEFReader' in window
  const [estado, setEstado] = useState<EstadoNFC>(soportado ? 'listo' : 'no-soportado')
  const [error, setError] = useState<string | null>(null)
  const aborto = useRef<AbortController | null>(null)
  const cb = useRef(alLeer)
  useEffect(() => { cb.current = alLeer }, [alLeer])

  const parar = useCallback(() => {
    aborto.current?.abort()
    aborto.current = null
    setEstado(soportado ? 'listo' : 'no-soportado')
  }, [soportado])

  const empezar = useCallback(async () => {
    if (!window.NDEFReader) { setEstado('no-soportado'); return }
    setError(null)
    try {
      const lector = new window.NDEFReader()
      const ctrl = new AbortController()
      aborto.current = ctrl

      // scan() dispara el pedido de permiso del navegador. Tiene que salir de
      // un gesto del usuario (un tap), no del arranque de la página.
      await lector.scan({ signal: ctrl.signal })

      lector.onreading = (e: EventoNFC) => {
        const uid = normalizarUid(e.serialNumber ?? '', 'hex')
        if (uid) cb.current(uid)
      }
      lector.onreadingerror = () => {
        setError('No pudimos leer esa tarjeta. Probá acercarla de nuevo, más quieta.')
      }
      setEstado('escaneando')
    } catch (e) {
      const err = e as DOMException
      setEstado('error')
      setError(
        err.name === 'NotAllowedError'
          ? 'Diste permiso denegado al NFC. Habilitalo para este sitio en la configuración del navegador.'
        : err.name === 'NotSupportedError'
          ? 'Este teléfono no tiene NFC, o está apagado.'
        : err.name === 'NotReadableError'
          ? 'El NFC está apagado. Prendelo desde los ajustes rápidos del teléfono.'
        : `No pudimos usar el NFC: ${err.message}`
      )
    }
  }, [])

  // Si la pantalla se va a segundo plano, cortamos el escaneo: dejar la antena
  // encendida se come la batería del teléfono del mozo durante todo el turno.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'hidden') parar() }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); parar() }
  }, [parar])

  return { soportado, estado, error, empezar, parar }
}

/** Para el mensaje de "acá no vas a poder escanear, y esta es la razón". */
export function porQueNoHayNFC(): string {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return 'En iPhone no se puede: Apple no le da acceso al NFC a las páginas web. ' +
           'Para escanear tarjetas hace falta un Android con Chrome.'
  }
  if (!/Android/i.test(ua)) {
    return 'El escaneo por NFC anda en teléfonos Android con Chrome. ' +
           'Desde una computadora, cargá el número de la tarjeta a mano.'
  }
  if (!/Chrome|Chromium/i.test(ua)) {
    return 'Abrilo con Chrome: es el único navegador de Android que da acceso al NFC.'
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    return 'El NFC solo funciona sobre HTTPS. Entrá por la dirección publicada, no por IP.'
  }
  return 'Este teléfono no expone el NFC al navegador.'
}
