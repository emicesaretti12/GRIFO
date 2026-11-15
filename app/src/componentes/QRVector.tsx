import { useMemo } from 'react'
import QRCode from 'qrcode'

/**
 * Un QR dibujado como vector (SVG), no como imagen.
 *
 * Es el que lee la cámara de la tablet: el de la app del cliente y el del
 * ticket de la caja. Vector a propósito: en la pantalla de un celular queda
 * nítido a cualquier tamaño, y en la impresora térmica sale con los bordes
 * rectos en vez de un gris borroneado.
 *
 * Siempre negro sobre blanco y con margen: es lo que un lector necesita para
 * encontrar el código, sea cual sea el tema de la pantalla que lo rodea.
 */
export default function QRVector({ texto, margen = 3, className, titulo = 'Código QR' }: {
  texto: string
  /** Cuántos módulos de blanco alrededor. Menos de 2 y algunos lectores no lo encuentran. */
  margen?: number
  className?: string
  titulo?: string
}) {
  const { d, lado } = useMemo(() => {
    const q = QRCode.create(texto, { errorCorrectionLevel: 'M' })
    const n = q.modules.size
    const datos = q.modules.data
    let d = ''
    for (let y = 0; y < n; y++) {
      // Los módulos seguidos de una fila van en un solo trazo: menos nodos y
      // sin las rayitas blancas que aparecen entre cuadraditos pegados.
      let x = 0
      while (x < n) {
        if (!datos[y * n + x]) { x++; continue }
        let fin = x
        while (fin < n && datos[y * n + fin]) fin++
        d += `M${x + margen} ${y + margen}h${fin - x}v1h${x - fin}z`
        x = fin
      }
    }
    return { d, lado: n + margen * 2 }
  }, [texto, margen])

  return (
    <svg className={className} viewBox={`0 0 ${lado} ${lado}`} role="img" aria-label={titulo}
         shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg">
      <rect width={lado} height={lado} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  )
}
