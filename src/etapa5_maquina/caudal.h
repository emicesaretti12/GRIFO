#pragma once
// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — conteo de pulsos del caudalímetro
//
// Lo validado en la etapa 3, encapsulado. El conteo lo hace el periférico PCNT
// del ESP32, no una interrupción por pulso: es un contador de hardware que
// sigue contando aunque el procesador esté ocupado hablando por WiFi.
//
//   Es la diferencia entre un `setInterval` que incrementa una variable y un
//   `COUNT(*)` en la base. El primero depende de que tu proceso llegue a tiempo.
// ═════════════════════════════════════════════════════════════════════════════

#include <stdint.h>

/** @param pullupInterno  true usa el pull-up interno del ESP32 (~45k).
 *                        false espera uno externo (resistencia de 10k o el
 *                        conversor de niveles). Ver la nota en el .cpp. */
void caudalIniciar(bool pullupInterno);

/** Pulsos acumulados desde el arranque. Monotónico, nunca baja. */
uint32_t caudalPulsos();
