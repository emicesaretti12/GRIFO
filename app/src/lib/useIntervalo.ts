import { useEffect, useRef } from 'react'

/** Ejecuta algo cada N ms, pero solo mientras la pestaña está visible: no tiene
 *  sentido refrescar un panel que nadie está mirando. */
export function useIntervalo(fn: () => void, ms: number, activo = true) {
  const guardado = useRef(fn)
  useEffect(() => { guardado.current = fn }, [fn])

  useEffect(() => {
    if (!activo) return
    let id: number | undefined
    const arrancar = () => {
      detener()
      if (document.visibilityState === 'visible') {
        id = window.setInterval(() => guardado.current(), ms)
      }
    }
    const detener = () => { if (id) { clearInterval(id); id = undefined } }
    arrancar()
    document.addEventListener('visibilitychange', arrancar)
    return () => { detener(); document.removeEventListener('visibilitychange', arrancar) }
  }, [ms, activo])
}
