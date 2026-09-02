// ─────────────────────────────────────────────────────────────────────────────
// Plata SIEMPRE en centavos enteros. Nunca float.
//
// Los floats binarios no pueden representar 0.1 exacto, así que sumar precios
// arrastra error: el clásico 0.1 + 0.2 === 0.30000000000000004. Con centavos
// enteros el problema no existe, y el redondeo se decide una sola vez, a
// propósito, en el borde del sistema.
// ─────────────────────────────────────────────────────────────────────────────

/** 850000 -> "$ 8.500,00" */
export function pesos(centavos: number | null | undefined): string {
  if (centavos == null) return '—'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(centavos / 100)
}

/** 850000 -> "8.500" (sin símbolo ni decimales, para inputs y tablas compactas) */
export function pesosCorto(centavos: number | null | undefined): string {
  if (centavos == null) return '—'
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
    .format(Math.round(centavos / 100))
}

/**
 * Lo que el cajero tipea ("1500", "1.500", "1500,50") -> centavos enteros.
 * Devuelve null si no es un número válido.
 */
export function aCentavos(texto: string): number | null {
  const limpio = texto.trim().replace(/\./g, '').replace(',', '.')
  if (limpio === '' || !/^\d*\.?\d*$/.test(limpio)) return null
  const n = Number(limpio)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/** mL a litros para mostrar: 473 -> "473 ml", 1500 -> "1,50 L" */
export function volumen(ml: number | null | undefined): string {
  if (ml == null) return '—'
  if (ml < 1000) return `${ml} ml`
  return `${(ml / 1000).toFixed(2).replace('.', ',')} L`
}

export function fecha(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}
