#pragma once
// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — la válvula (relé)
//
// Toda la lógica de la etapa 4 queda encerrada acá para que el resto del
// firmware no tenga que saber nada de open-drain ni de optoacopladores. Afuera
// solo hay `abrir()` y `cerrar()`.
//
//   Es el repositorio que esconde el SQL. Quien lo llama pide lo que quiere, no
//   cómo se hace.
// ═════════════════════════════════════════════════════════════════════════════

#include <stdint.h>

/** Deja la válvula CERRADA y recién después configura el pin.
 *  El orden no es decorativo: ver el comentario adentro. */
void valvulaIniciar();

void valvulaAbrir();
void valvulaCerrar();

bool     valvulaAbierta();
uint32_t valvulaAbiertaDesde();   // millis() del último abrir(); 0 si está cerrada
