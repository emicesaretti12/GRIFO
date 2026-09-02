import { useEffect, useRef } from 'react'
import { normalizarUid, type FormatoLector } from './uid'

// ─────────────────────────────────────────────────────────────────────────────
// Lector RFID USB
//
// Estos lectores se presentan al sistema operativo como un TECLADO: al apoyar
// la tarjeta "tipean" el UID muy rápido y cierran con Enter. Para el navegador
// es indistinguible de alguien escribiendo... salvo por la velocidad.
//
// De eso se agarra este hook: escucha el teclado a nivel documento y, si llegan
// varios caracteres con menos de `msEntreTeclas` de separación y termina en
// Enter, asume que fue el lector y no una persona. Así el cajero puede tener el
// foco en cualquier lado y la tarjeta igual se lee.
//
// Ventaja de escuchar global en vez de usar un <input> con foco: el foco se
// pierde con cualquier clic, y en una caja con gente esperando eso es un
// problema real.
// ─────────────────────────────────────────────────────────────────────────────

type Opciones = {
  alLeer: (uid: string) => void
  formato?: FormatoLector
  /** Máximo entre teclas para considerarlo lector y no una persona. */
  msEntreTeclas?: number
  /** Mínimo de caracteres para tomarlo en serio. */
  largoMinimo?: number
  activo?: boolean
}

export function useLectorRFID({
  alLeer,
  formato = 'hex',
  msEntreTeclas = 60,
  largoMinimo = 6,
  activo = true,
}: Opciones) {
  const buffer = useRef('')
  const ultima = useRef(0)
  // Guardamos el callback en una ref para no re-suscribir el listener en cada
  // render (si no, cada cambio de estado del padre desengancharía el lector).
  const cb = useRef(alLeer)
  useEffect(() => { cb.current = alLeer }, [alLeer])

  useEffect(() => {
    if (!activo) return

    function onKeyDown(e: KeyboardEvent) {
      const ahora = Date.now()
      if (ahora - ultima.current > msEntreTeclas) buffer.current = ''
      ultima.current = ahora

      if (e.key === 'Enter') {
        const crudo = buffer.current
        buffer.current = ''
        if (crudo.length >= largoMinimo) {
          e.preventDefault()
          cb.current(normalizarUid(crudo, formato))
        }
        return
      }

      // Solo caracteres imprimibles sueltos; ignoramos Shift, Tab, flechas...
      if (e.key.length === 1) buffer.current += e.key
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [activo, formato, msEntreTeclas, largoMinimo])
}
