import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

/**
 * QR para vincular la pantalla de una canilla.
 *
 * Sin esto, emparejar una tablet significaría tipear un token de 64 caracteres
 * hexadecimales a mano. Con el QR se apunta la cámara y listo.
 */
export default function QR({ texto, tam = 220 }: { texto: string; tam?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current) return
    void QRCode.toCanvas(ref.current, texto, {
      width: tam, margin: 1,
      color: { dark: '#0b0b0b', light: '#ffffff' },
    })
  }, [texto, tam])
  return <canvas ref={ref} width={tam} height={tam}
                 style={{ borderRadius: 10, display: 'block', margin: '0 auto' }} />
}
