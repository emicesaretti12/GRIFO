// ─────────────────────────────────────────────────────────────────────────────
// Normalización del UID de la tarjeta.
//
// El lío: no todos los lectores RFID USB devuelven lo mismo para la MISMA
// tarjeta. Los hay que tipean el UID en hexadecimal ("A1B2C3D4") y los hay que
// lo tipean en decimal ("2712847316"), y algunos encima con el orden de bytes
// invertido. Si no normalizamos, la misma tarjeta se carga en caja como un UID
// y el ESP32 la lee como otro: el cliente paga y el grifo no lo reconoce.
//
// La base guarda SIEMPRE hexadecimal en mayúsculas, que es lo que reporta el
// MFRC522 del grifo. Acá traducimos lo que venga del lector de caja a eso.
// ─────────────────────────────────────────────────────────────────────────────

export type FormatoLector = 'hex' | 'decimal'

/** Normaliza lo que sea que haya escupido el lector al formato de la base. */
export function normalizarUid(crudo: string, formato: FormatoLector = 'hex'): string {
  const limpio = crudo.trim().replace(/[\s:-]/g, '').toUpperCase()
  if (limpio === '') return ''

  if (formato === 'decimal' && /^\d+$/.test(limpio)) {
    // Los lectores decimales suelen dar 10 dígitos para un UID de 4 bytes.
    const hex = BigInt(limpio).toString(16).toUpperCase()
    return hex.padStart(8, '0')
  }
  return limpio
}

/** ¿Tiene pinta de UID válido? 4, 7 o 10 bytes en hexa. */
export function uidValido(uid: string): boolean {
  return /^[0-9A-F]{8}$|^[0-9A-F]{14}$|^[0-9A-F]{20}$/.test(uid)
}
