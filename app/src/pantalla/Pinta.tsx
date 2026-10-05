import { useEffect, useRef, useState } from 'react'
import { Motor, type Entrada } from './pinta/motor'
import { Motor3D } from './pinta/motor3d'

// La escena de la canilla: dos lienzos a pantalla completa. Atrás, la pared
// del bar (se pinta una vez); adelante, la escena en 3D (WebGL). Si la tablet
// no tiene WebGL, se usa el motor 2D, que muestra lo mismo dibujado en plano.
// Toda la lógica está en el motor: acá solo se le pasan los datos y se le
// avisa cuando cambia el tamaño.

type Props = Entrada & {
  /** Los mililitros que muestra el vaso, redondeados, cada vez que cambian.
   *  Sirve para que el contador de texto suba junto con el líquido sin
   *  re-renderizar React 60 veces por segundo. */
  alContar?: (ml: number) => void
}

export default function Pinta({ alContar, ...entrada }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const escena = useRef<HTMLCanvasElement>(null)
  const fondo = useRef<HTMLCanvasElement>(null)
  const motor = useRef<Motor | Motor3D | null>(null)
  const [plano, setPlano] = useState(false)
  const contar = useRef(alContar)
  contar.current = alContar

  useEffect(() => {
    let m: Motor | Motor3D
    if (!plano) {
      try {
        m = new Motor3D(escena.current!, fondo.current!)
      } catch {
        // Sin WebGL. El lienzo ya quedó tomado por el intento: se remonta uno
        // nuevo para el 2D.
        setPlano(true)
        return
      }
    } else m = new Motor(escena.current!, fondo.current!)
    motor.current = m
    m.alContar = (n: number) => contar.current?.(n)
    const reducido = matchMedia('(prefers-reduced-motion: reduce)')
    const medir = () => {
      const r = caja.current!.getBoundingClientRect()
      m.medir(r.width, r.height, reducido.matches)
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(caja.current!)
    reducido.addEventListener('change', medir)
    // El nombre de la manija se pinta con la tipografía de la pantalla; si
    // todavía no cargó, sale con la de reserva y se repinta cuando llega.
    document.fonts?.load('800 20px "Big Shoulders Display Variable"')
      .then(() => m.repintarManija())
      .catch(() => {})
    m.iniciar()
    return () => {
      ro.disconnect()
      reducido.removeEventListener('change', medir)
      m.detener()
      motor.current = null
    }
  }, [plano])

  const { modo, ml, vaso, color, etiqueta, sesion } = entrada
  useEffect(() => {
    motor.current?.actualizar({ modo, ml, vaso, color, etiqueta, sesion })
  }, [modo, ml, vaso, color, etiqueta, sesion, plano])

  return (
    <div className="pinta" ref={caja} aria-hidden="true">
      <canvas ref={fondo} className="pinta-lienzo" />
      <canvas ref={escena} key={plano ? '2d' : '3d'} className="pinta-lienzo" />
    </div>
  )
}
