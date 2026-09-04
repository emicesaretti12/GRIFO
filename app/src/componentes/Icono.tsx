// Iconos SVG en línea: sin dependencias, heredan color y tamaño del texto.
type Props = { nombre: Nombre; tam?: number; className?: string }

export type Nombre =
  | 'caja' | 'tarjeta' | 'grifo' | 'grafico' | 'personas' | 'inicio'
  | 'buscar' | 'mas' | 'candado' | 'candado-abierto' | 'refrescar' | 'salir'
  | 'ok' | 'alerta' | 'info' | 'cerrar' | 'descargar' | 'sol' | 'luna'
  | 'lapiz' | 'llave' | 'vacio' | 'reloj' | 'devolver' | 'arqueo'

const D: Record<Nombre, string> = {
  inicio:  'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  caja:    'M3 7h18v13H3zM3 7l2-4h14l2 4M12 11v5M9.5 13.5h5',
  tarjeta: 'M2 6h20v12H2zM2 10h20M6 15h4',
  grifo:   'M7 4h6v4H7zM13 6h4v3M17 9h-3v3a4 4 0 0 1-4 4v4h4v-4M10 8v8',
  grafico: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  personas:'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
  buscar:  'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3',
  mas:     'M12 5v14M5 12h14',
  candado: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  'candado-abierto': 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2',
  refrescar:'M21 12a9 9 0 1 1-3-6.7M21 4v5h-5',
  salir:   'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  ok:      'M20 6 9 17l-5-5',
  alerta:  'M12 3 2 20h20zM12 9v5M12 17.5v.5',
  info:    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5M12 7.5v.5',
  cerrar:  'M18 6 6 18M6 6l12 12',
  descargar:'M12 3v12M7 11l5 5 5-5M4 20h16',
  sol:     'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  luna:    'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8',
  lapiz:   'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  llave:   'M21 2 15 8M18 5l2.5 2.5M10.5 12.5a5 5 0 1 1-7 7 5 5 0 0 1 7-7',
  vacio:   'M4 7h16v13H4zM4 7l2-3h12l2 3M9 12h6',
  reloj:   'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  // Flecha que vuelve: la plata sale del sistema y se le devuelve al cliente.
  devolver:'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-5',
  // Balanza: los dos platos del arqueo, lo que dice el sistema y lo que hay.
  arqueo:  'M12 3v18M7 21h10M12 6 5 9m7-3 7 3M2 13a3 3 0 0 0 6 0L5 9zm14 0a3 3 0 0 0 6 0l-3-4z',
}

export default function Icono({ nombre, tam = 16, className }: Props) {
  return (
    <svg className={className} width={tam} height={tam} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={D[nombre]} />
    </svg>
  )
}
