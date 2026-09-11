#include <Arduino.h>
#include "valvula.h"

// GPIO26 maneja el `IN` del módulo relé **a través del canal 4 del conversor de
// niveles**, no directo: en la posición `L` del jumper ese `IN` está a 11,3 V y
// un pin del ESP32 tolera 3,3. El MOSFET del conversor aísla.
static const int PIN_RELE = 26;

// ── Open-drain, no un OUTPUT normal ─────────────────────────────────────────
// Este módulo no se apaga con 3,3 V: con `DC+` en 12 V quedan varios volts
// sobre el LED del optoacoplador y sigue conduciendo. El estado de reposo no
// pide una tensión, pide **ausencia**.
//
// Open-drain es eso: el pin elige entre "a masa" y "desconectado".
//
//   Un pin común devuelve `false`. En open-drain devuelve `undefined`.
//   Este relé solo descansa cuando nadie le dice nada.
static const int PIN_A_MASA       = LOW;    // válvula ABIERTA
static const int PIN_DESCONECTADO = HIGH;   // válvula CERRADA

static bool     abierta = false;
static uint32_t desde   = 0;

void valvulaIniciar() {
  // `digitalWrite` ANTES de `pinMode` carga el valor en el latch de salida, así
  // el pin ya nace manejando el valor correcto.
  //
  // Al revés hay una ventana de microsegundos en la que el pin ya está
  // habilitado pero conserva el valor por defecto —que es LOW, o sea ABIERTA— y
  // la válvula alcanza a soltar cerveza. El orden de dos líneas es la
  // diferencia.
  digitalWrite(PIN_RELE, PIN_DESCONECTADO);
  pinMode(PIN_RELE, OUTPUT_OPEN_DRAIN);
  digitalWrite(PIN_RELE, PIN_DESCONECTADO);

  // Antes de que corra esta función el GPIO26 es una entrada: alta impedancia,
  // o sea `IN` suelto, o sea válvula cerrada. El estado seguro es el que trae
  // el silicio, no algo que dependa de que nuestro código llegue a ejecutarse.
  abierta = false;
  desde   = 0;
}

void valvulaAbrir() {
  if (abierta) return;               // idempotente: abrir dos veces no reinicia el reloj
  digitalWrite(PIN_RELE, PIN_A_MASA);
  abierta = true;
  desde   = millis();
}

void valvulaCerrar() {
  // Idempotente a propósito, y sin el `if` de arriba: cerrar se llama en CADA
  // vuelta del loop desde el estado seguro. Tiene que ser barato y tiene que
  // escribir el pin siempre, aunque creamos que ya está cerrada. Si una
  // variable quedó desincronizada del hardware, esta línea lo corrige.
  digitalWrite(PIN_RELE, PIN_DESCONECTADO);
  abierta = false;
  desde   = 0;
}

bool     valvulaAbierta()      { return abierta; }
uint32_t valvulaAbiertaDesde() { return desde;   }
