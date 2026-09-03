import { useEffect, useRef, useState } from 'react'

/** Ancho real del contenedor, para que los gráficos SVG se dibujen a medida y
 *  las etiquetas no queden deformadas por un escalado del viewBox. */
export function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [ancho, setAncho] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setAncho(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return { ref, ancho }
}
