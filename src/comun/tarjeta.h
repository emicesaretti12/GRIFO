#pragma once
// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — presencia de la tarjeta (MFRC522)
//
// Lo validado en la etapa 2. Lo único que el resto del firmware necesita saber
// es **si hay una tarjeta apoyada y cuál**.
// ═════════════════════════════════════════════════════════════════════════════

#include <stdint.h>

bool tarjetaIniciar();          // false si el lector no contesta

/** Llamar seguido desde el loop. Adentro se auto-limita a un chequeo cada
 *  100 ms: preguntarle más rápido al MFRC522 no mejora nada y le roba tiempo
 *  al resto. */
void tarjetaActualizar(uint32_t ahora);

bool        tarjetaPresente();
const char *tarjetaUid();       // "" cuando no hay ninguna
