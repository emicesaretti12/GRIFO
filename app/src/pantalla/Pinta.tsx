import { useEffect, useRef } from 'react'
import { Motor, type Entrada } from './pinta/motor'

// La escena de la canilla: dos lienzos a pantalla completa. Atrás, la
// contrabarra (se pinta una vez); adelante, el vaso personaje en estilo anime.
// Toda la lógica está en el motor: acá solo se le pasan los datos y se le
// avisa cuando cambia el tamaño.

type Props = Entrada & {
  /** Los mililitros que muestra el vaso, redondeados, cada vez que cambian.
   *  Sirve para que el contador de texto suba junto con el líquido sin
   *  re-renderizar React 60 veces por segundo. */
  alContar?: (ml: number) => void
  /** Qué motor quedó andando (se muestra en el modo demostración). */
  alMotor?: (tipo: string) => void
}

export default function Pinta({ alContar, alMotor, ...entrada }: Props) {
  const caja = useRef<HTMLDivElement>(null)
  const escena = useRef<HTMLCanvasElement>(null)
  const fondo = useRef<HTMLCanvasElement>(null)
  const motor = useRef<Motor | null>(null)
  const contar = useRef(alContar)
  contar.current = alContar
  const avisar = useRef(alMotor)
  avisar.current = alMotor

  useEffect(() => {
    const m = new Motor(escena.current!, fondo.current!)
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
    avisar.current?.(m.tipo)
    return () => {
      ro.disconnect()
      reducido.removeEventListener('change', medir)
      m.detener()
      motor.current = null
    }
  }, [])

  const { modo, ml, vaso, color, etiqueta, sesion } = entrada
  useEffect(() => {
    motor.current?.actualizar({ modo, ml, vaso, color, etiqueta, sesion })
  }, [modo, ml, vaso, color, etiqueta, sesion])

  return (
    <div className="pinta" ref={caja} aria-hidden="true">
      <canvas ref={fondo} className="pinta-lienzo" />
      <canvas ref={escena} className="pinta-lienzo" />
    </div>
  )
}
