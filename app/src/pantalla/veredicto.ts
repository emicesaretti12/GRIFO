/**
 * El chiste de la pantalla: comparar lo servido contra el vaso de referencia y
 * decir algo. Un número solo no genera nada; "pinta perfecta" sí.
 *
 * La gracia de que dependa de la puntería es que la gente vuelve a intentarlo.
 */
export function veredicto(ml: number, vaso: number): { titulo: string; sub: string } {
  const r = ml / vaso

  if (r < 0.15) return { titulo: 'Apenas un sorbo', sub: 'Para probar, está bien' }
  if (r < 0.45) return { titulo: 'Media medida', sub: 'Te quedaste con ganas' }

  // La zona de la puntería: cerca del vaso exacto
  if (r >= 0.97 && r <= 1.03) return { titulo: '¡Pinta perfecta!', sub: 'Servida al milímetro' }
  if (r >= 0.92 && r <= 1.08) return { titulo: '¡Casi perfecta!', sub: 'Por poquito' }
  if (r < 0.92) return { titulo: 'Bien servida', sub: 'Un poco corta' }

  if (r <= 1.6) return { titulo: 'Generosa', sub: 'Nadie te va a juzgar' }
  if (r <= 2.5) return { titulo: '¡Sed de verdad!', sub: 'Más de dos vasos de una' }
  return { titulo: 'Leyenda', sub: 'Eso fue una jarra' }
}

/** Qué tan cerca del vaso exacto, de 0 a 100. */
export function punteria(ml: number, vaso: number): number {
  return Math.max(0, Math.round((1 - Math.abs(ml - vaso) / vaso) * 100))
}
