#pragma once
// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — plata y conversiones, todo en ENTEROS
//
// Esta es la única parte del firmware donde hay reglas de negocio, y es la que
// no puede estar mal ni una vez.
//
// **Nunca `float` para plata.** Un float no puede representar 0,10 exacto: lo
// guarda como 0,100000001490116... Sumás mil operaciones y el saldo del cliente
// no cuadra con la caja, y nadie sabe por qué.
//
//   Es el mismo motivo por el que en la base el saldo es `bigint` de centavos y
//   no `numeric` ni `float8`. Acá se sostiene la misma decisión.
//
// Todo se guarda en **centavos**, como entero sin signo. Un peso son 100.
//
// ── Las dos asimetrías ──────────────────────────────────────────────────────
//
// Hay dos divisiones que no dan exacto, y en las dos hay que elegir para qué
// lado redondear. **Las dos redondean a favor del bar**, y es deliberado:
//
//   · Cuántos pulsos autoriza un saldo  → se trunca HACIA ABAJO.
//     Si el saldo alcanza para 449,7 pulsos, se autorizan 449.
//
//   · Cuánto se cobra por lo servido    → se redondea HACIA ARRIBA.
//     Si salieron 156,01 centavos, se cobran 157.
//
// Si fuera al revés, cada tirada regalaría una fracción de centavo. Con miles
// de tiradas eso es plata que falta en el cajón y que nadie puede explicar.
// ═════════════════════════════════════════════════════════════════════════════

#include <stdint.h>
#include <stdio.h>

typedef uint32_t Centavos;

/** Cuántos pulsos puede pagar este saldo.
 *
 *  Se calcula directo en pulsos en vez de pasar por mililitros, para no truncar
 *  dos veces. El intermedio va en 64 bits: saldo × pulsos_por_litro se pasa de
 *  32 bits con saldos grandes, y ahí el número daría cualquier cosa sin avisar.
 */
inline uint32_t pulsosQuePagaElSaldo(Centavos saldo,
                                     uint32_t precioCentavosPorLitro,
                                     uint32_t pulsosPorLitro) {
  if (precioCentavosPorLitro == 0) return 0;
  uint64_t n = (uint64_t)saldo * (uint64_t)pulsosPorLitro;
  return (uint32_t)(n / (uint64_t)precioCentavosPorLitro);
}

/** Cuánto cobrar por estos pulsos. Redondeo hacia ARRIBA.
 *
 *  El `+ divisor - 1` antes de dividir es el techo entero: sube al siguiente
 *  entero salvo que la división ya diera exacta.
 *
 *  Garantía que importa: cobrar lo que autorizó `pulsosQuePagaElSaldo` nunca
 *  supera el saldo. El truncado hacia abajo de allá deja margen suficiente para
 *  el redondeo hacia arriba de acá. Un saldo no puede quedar negativo.
 */
inline Centavos precioDeLosPulsos(uint32_t pulsos,
                                  uint32_t precioCentavosPorLitro,
                                  uint32_t pulsosPorLitro) {
  if (pulsosPorLitro == 0) return 0;
  uint64_t n = (uint64_t)pulsos * (uint64_t)precioCentavosPorLitro;
  return (Centavos)((n + pulsosPorLitro - 1) / (uint64_t)pulsosPorLitro);
}

/** Mililitros servidos, solo para mostrar en el ticket. Truncado. */
inline uint32_t mlDeLosPulsos(uint32_t pulsos, uint32_t pulsosPorLitro) {
  if (pulsosPorLitro == 0) return 0;
  return (uint32_t)(((uint64_t)pulsos * 1000ULL) / (uint64_t)pulsosPorLitro);
}

/** Centavos a texto, sin pasar por float ni una vez.
 *  12345 → "$123,45"
 */
inline void formatearPesos(Centavos c, char *salida, size_t largo) {
  snprintf(salida, largo, "$%lu,%02lu",
           (unsigned long)(c / 100), (unsigned long)(c % 100));
}
