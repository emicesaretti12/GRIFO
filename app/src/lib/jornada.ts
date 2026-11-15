// ─────────────────────────────────────────────────────────────────────────────
// La jornada del bar: de 6 de la mañana a 6 de la mañana, hora argentina.
//
// Un bar cierra de madrugada. Lo que se sirve a las 2 AM del sábado es de la
// noche del viernes: si el día cambiara a las 12, la noche quedaría partida en
// dos y ningún número del panel coincidiría con el cajón.
//
// Es la misma regla que usa el servidor (`inicio_jornada` en 29-qr.sql), y se
// calcula en hora argentina aunque la computadora tenga puesta otra zona: el
// panel y el servidor tienen que cortar la noche en el mismo instante.
//
//   ⚠ No usar `toISOString().slice(0, 10)` para saber "de qué día" es algo:
//   eso devuelve el día en UTC, y en Argentina todo lo que pasa después de las
//   21 cae en el día siguiente. Era un bug real: las ventas de la noche
//   aparecían en la columna de mañana.
// ─────────────────────────────────────────────────────────────────────────────

export const HORA_DE_CIERRE = 6
export const ZONA = 'America/Argentina/Buenos_Aires'

// Argentina está fija en UTC−3 y no cambia la hora desde 2009. Si algún día
// volviera el horario de verano, este número es lo que hay que revisar.
const DESFASE_MS = 3 * 3600 * 1000
const DIA_MS = 24 * 3600 * 1000

/** El momento en que empezó la jornada a la que pertenece `d`. */
export function inicioDeJornada(d: Date = new Date()): Date {
  // Se corre el reloj a "hora argentina leída como UTC" y se le restan las 6
  // horas del cierre: lo que queda cae en el día de la jornada.
  const corrido = d.getTime() - DESFASE_MS - HORA_DE_CIERRE * 3600 * 1000
  const dia = Math.floor(corrido / DIA_MS) * DIA_MS
  return new Date(dia + HORA_DE_CIERRE * 3600 * 1000 + DESFASE_MS)
}

/** "2026-11-14": el día de la jornada, para usar de clave al agrupar. */
export function claveDeJornada(d: Date | string): string {
  const j = inicioDeJornada(typeof d === 'string' ? new Date(d) : d)
  return new Date(j.getTime() - DESFASE_MS).toISOString().slice(0, 10)
}

/** El inicio de la jornada de hace `dias` días (0 = la de hoy). */
export function inicioDeJornadaHace(dias: number, desde: Date = new Date()): Date {
  return new Date(inicioDeJornada(desde).getTime() - dias * DIA_MS)
}
