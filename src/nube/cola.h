#pragma once
// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — cola de cierres pendientes, en memoria no volátil
//
// El problema que resuelve: la cerveza ya salió y el WiFi está caído.
//
// El cobro no puede esperar a que vuelva la red en RAM, porque un corte de luz
// o un reset se lleva la RAM y esa tirada queda sin cobrar. Tampoco puede
// bloquear al cliente siguiente.
//
// Entonces el cierre se **escribe en la flash** apenas termina la tirada, y una
// tarea aparte la va vaciando contra Supabase cuando hay red. El cliente se va,
// el sistema sigue funcionando, y la plata no se pierde.
//
//   Es una outbox. Escribís la intención en tu propio almacenamiento dentro de
//   la misma operación, y un worker la entrega después. Lo contrario sería
//   llamar a la API adentro del request y rezar.
//
// ── Por qué no se descarta lo viejo cuando se llena ─────────────────────────
//
// Una cola circular normal pisa lo más viejo cuando no entra más. Acá cada
// entrada es una venta: pisarla es regalar cerveza.
//
// Cuando la cola se llena, lo que se hace es **dejar de autorizar sesiones
// nuevas**. Es preferible que la canilla no sirva a que sirva sin cobrar.
// ═════════════════════════════════════════════════════════════════════════════

#include <stdint.h>

/** Un cierre que todavía no llegó al servidor. */
struct Pendiente {
  int64_t  sesionId;
  uint32_t ml;
  uint32_t pulsos;
};

/** Cuántos cierres pendientes entran antes de dejar de autorizar.
 *  32 tiradas sin red es muchísimo: si se llega ahí, hay un problema de fondo
 *  y lo correcto es frenar, no seguir acumulando. */
static const uint32_t COLA_CAPACIDAD = 32;

void     colaIniciar();
bool     colaEncolar(const Pendiente &p);   // false si está llena
bool     colaVerPrimero(Pendiente &p);      // false si está vacía
void     colaSacarPrimero();                // solo tras confirmar el servidor
uint32_t colaCantidad();
bool     colaLlena();
