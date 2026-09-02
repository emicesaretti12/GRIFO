// ─────────────────────────────────────────────────────────────────────────────
// Grifo de cerveza automatizado — ESP32
// ETAPA 1: Blink + info del chip
//
// Qué prueba esta etapa (y nada más que esto):
//   1. Que el toolchain compila.
//   2. Que el driver CP2102 anda y la PC ve el puerto serie.
//   3. Que podemos escribir el flash de la placa.
//   4. Que la placa arranca y corre nuestro código.
//
// NO toca RFID, ni caudalímetro, ni relé. Eso es de la etapa 2 en adelante.
//
// El LED: en el NodeMCU ESP-WROOM-32S de 38 pines el LED de usuario está en el
// GPIO2 — el mismo pin que el pinout del proyecto reserva para "LED estado".
// Ojo: el LED ROJO fijo de la placa es el de alimentación, ese prende solo con
// enchufar el USB y no lo controla el firmware. El que tiene que parpadear es
// el otro, el chiquito (normalmente azul).
// ─────────────────────────────────────────────────────────────────────────────

#include <Arduino.h>

static const uint8_t PIN_LED = 2;
static const uint32_t INTERVALO_MS = 500;

// Imprime datos del chip. Sirve para confirmar que no solo flasheamos, sino que
// además estamos hablando con un ESP32 de verdad y con el flash que esperamos.
static void imprimirInfoChip() {
  uint64_t mac = ESP.getEfuseMac();

  Serial.println("---------------------------------------------");
  Serial.printf("Revision del chip : %u\n", (unsigned)ESP.getChipRevision());
  Serial.printf("CPU               : %u MHz\n", (unsigned)ESP.getCpuFreqMHz());
  Serial.printf("Flash             : %u bytes\n", (unsigned)ESP.getFlashChipSize());
  Serial.printf("Heap libre        : %u bytes\n", (unsigned)ESP.getFreeHeap());
  // El MAC se imprime en dos mitades para no depender de %llX en printf.
  Serial.printf("MAC (eFuse)       : %04X%08X\n",
                (unsigned)(uint16_t)(mac >> 32), (unsigned)(uint32_t)mac);
  Serial.println("---------------------------------------------");
}

void setup() {
  Serial.begin(115200);

  // Único delay() bloqueante de todo el proyecto, y es a proposito: le da
  // tiempo al monitor serial de la PC a engancharse despues del reset, si no
  // se pierden las primeras lineas. En el loop NUNCA vamos a usar delay().
  delay(300);

  Serial.println();
  Serial.println("=============================================");
  Serial.println(" GRIFO DE CERVEZA — ETAPA 1: BLINK");
  Serial.println("=============================================");
  imprimirInfoChip();
  Serial.println("Si ves esto y el LED chiquito parpadea, la etapa 1 esta OK.");
  Serial.println();

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);
}

void loop() {
  static bool encendido = false;
  static uint32_t ultimoCambio = 0;

  // Patron "non-blocking": en vez de frenar todo con delay(), preguntamos si ya
  // pasó el tiempo. Es lo mismo que un setInterval() de JS contra un sleep()
  // que congela el hilo. Lo usamos desde la etapa 1 porque en la etapa 5 el
  // loop de control tiene que correr cada 20 ms sin trabarse NUNCA: si se
  // bloquea mientras la valvula esta abierta, se sigue sirviendo cerveza.
  uint32_t ahora = millis();
  if (ahora - ultimoCambio >= INTERVALO_MS) {
    ultimoCambio = ahora;
    encendido = !encendido;
    digitalWrite(PIN_LED, encendido ? HIGH : LOW);
    Serial.printf("[%lu ms] LED %s\n", (unsigned long)ahora, encendido ? "ON" : "OFF");
  }
}
