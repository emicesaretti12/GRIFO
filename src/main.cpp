// Grifo de cerveza automatizado — ESP32
// Etapa 1: Blink
//
// Objetivo: confirmar que el toolchain compila, que el driver CP2102 anda
// y que podemos flashear la placa. No toca ningún periférico del proyecto
// todavía (ni RFID, ni caudalímetro, ni relé).
//
// LED_BUILTIN en el NodeMCU ESP-WROOM-32S (38 pines) es el GPIO2, el mismo
// pin que el brief reserva para "LED estado". Lo usamos tal cual acá.

#include <Arduino.h>

static const uint8_t PIN_LED = 2;
static const uint32_t INTERVALO_MS = 500;

void setup() {
  Serial.begin(115200);
  delay(200); // le da tiempo al monitor serial a engancharse tras el reset
  Serial.println();
  Serial.println("=== Grifo cerveza — Etapa 1: Blink ===");
  Serial.println("Si ves esto y el LED parpadea, el toolchain y el flasheo andan.");

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);
}

void loop() {
  static bool encendido = false;
  static uint32_t ultimoCambio = 0;

  uint32_t ahora = millis();
  if (ahora - ultimoCambio >= INTERVALO_MS) {
    ultimoCambio = ahora;
    encendido = !encendido;
    digitalWrite(PIN_LED, encendido ? HIGH : LOW);
    Serial.printf("[%lu ms] LED %s\n", (unsigned long)ahora, encendido ? "ON" : "OFF");
  }
}
