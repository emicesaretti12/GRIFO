// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — ETAPA 4: relé solo
//
// Prueba UNA cosa: que podemos abrir y cerrar el relé desde el ESP32, y que
// **al arrancar la placa el relé NO se activa**.
//
// La válvula NO se conecta todavía. Solo se escucha el clic.
//
// El segundo punto es el que importa. Si el relé se activa durante el arranque,
// cada reset de la placa —y cada bajón de tensión del bar— abre la canilla.
//
// CABLEADO:
//
//     Módulo relé      Adónde
//     ──────────────────────────────────────────────
//     DC+          →   positivo de la fuente de 12V
//     DC-          →   negativo de la fuente de 12V
//                      Y TAMBIÉN al GND del ESP32
//     IN           →   GPIO 26
//     jumper       →   posición H  (ver abajo)
//
//     Los bornes de salida del relé quedan al aire. Sin válvula.
// ═════════════════════════════════════════════════════════════════════════════

#include <Arduino.h>

static const int PIN_RELE = 26;

// ── Con qué nivel se activa este relé ───────────────────────────────────────
// El módulo trae un jumper H/L que elige si se dispara con la señal en alto o
// en bajo. Este proyecto usa **H (activo en alto)**, y no es indiferente:
//
//   · En posición L, el pin IN queda conectado por una resistencia a DC+, que
//     acá son 12 V. Un pin del ESP32 tolera 3.3 V. No se hace.
//
//   · En posición H, IN solo entrega corriente hacia el optoacoplador y nunca
//     ve más que lo que le pone el ESP32.
//
// Y trae un segundo beneficio, más importante todavía: **el estado peligroso
// deja de ser el estado por defecto**. Entre que la placa arranca y que nuestro
// código configura el pin, el GPIO26 está flotando, y un pin flotante tiende a
// quedar cerca de 0 V. Con activo en alto, "cerca de 0 V" significa relé en
// reposo, válvula CERRADA.
//
// Si con la señal en alto el relé no llega a activarse —3.3 V puede quedar
// corto para el optoacoplador de un módulo de 12 V— se prueba en L, pero
// entonces hay que interponer un transistor: el IN no puede tocar el ESP32
// directo. Eso se decide en esta etapa, midiendo.
static const int NIVEL_ACTIVO = HIGH;
static const int NIVEL_REPOSO = (NIVEL_ACTIVO == HIGH) ? LOW : HIGH;

// Ventana de silencio al arrancar. Durante estos segundos el sketch no toca
// nada, para que se pueda resetear la placa y escuchar si el relé hace clic
// solo. Ese es el criterio de aceptación de esta etapa.
static const uint32_t SILENCIO_MS = 5000;

static const uint32_t PERIODO_MS = 1000;


void setup() {
  // ── El orden de estas tres líneas no es decorativo ────────────────────────
  // digitalWrite ANTES de pinMode carga el valor en el latch de salida. Cuando
  // pinMode convierte el pin en salida, ya sale manejando el valor correcto.
  //
  // Al revés (pinMode primero) hay una ventana de microsegundos en la que el
  // pin ya es salida pero todavía tiene el valor por defecto —que es LOW— y el
  // relé alcanza a moverse. Es una race condition: el orden de dos líneas
  // cambia el resultado.
  //
  // Con NIVEL_ACTIVO en HIGH ese LOW por defecto es inofensivo, pero el orden
  // se respeta igual: si alguna vez hay que pasar a activo en bajo, esto ya
  // está bien escrito y no hay que acordarse.
  digitalWrite(PIN_RELE, NIVEL_REPOSO);
  pinMode(PIN_RELE, OUTPUT);
  digitalWrite(PIN_RELE, NIVEL_REPOSO);

  Serial.begin(115200);
  delay(300);

  Serial.println();
  Serial.println("=============================================");
  Serial.println(" GRIFO DE CERVEZA - ETAPA 4: RELE");
  Serial.println("=============================================");
  Serial.printf("Pin de control    : GPIO %d\n", PIN_RELE);
  Serial.printf("Nivel activo      : %s (jumper en %s)\n",
                NIVEL_ACTIVO == HIGH ? "ALTO" : "BAJO",
                NIVEL_ACTIVO == HIGH ? "H" : "L");
  Serial.println("---------------------------------------------");
  Serial.printf("SILENCIO por %lu segundos.\n", SILENCIO_MS / 1000);
  Serial.println("El rele NO tiene que hacer NINGUN clic ahora.");
  Serial.println("Si lo hace, se activa solo al arrancar: eso es");
  Serial.println("lo que abriria la canilla en cada corte de luz.");
  Serial.println("---------------------------------------------");
  Serial.println();
}


void loop() {
  static uint32_t ultimoCambio = 0;
  static bool     activo = false;
  static bool     arrancado = false;

  uint32_t ahora = millis();

  if (!arrancado) {
    if (ahora < SILENCIO_MS) return;
    arrancado = true;
    ultimoCambio = ahora;
    Serial.println("--- Fin del silencio. Empieza el ciclo. ---");
    Serial.println();
    return;
  }

  if (ahora - ultimoCambio < PERIODO_MS) return;   // sin delay(): no se bloquea
  ultimoCambio = ahora;

  activo = !activo;
  digitalWrite(PIN_RELE, activo ? NIVEL_ACTIVO : NIVEL_REPOSO);

  Serial.printf("[%7lu ms] %s   (GPIO%d = %s)\n",
                ahora,
                activo ? "ACTIVADO  - valvula ABIERTA" : "reposo    - valvula cerrada",
                PIN_RELE,
                (activo ? NIVEL_ACTIVO : NIVEL_REPOSO) == HIGH ? "HIGH" : "LOW");
}
