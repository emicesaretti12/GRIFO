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
//     jumper       →   la posición en la que, con IN al aire y 12V puesto,
//                      el LED rojo queda APAGADO (medido en esta etapa)
//
//     Los bornes de salida del relé quedan al aire. Sin válvula.
// ═════════════════════════════════════════════════════════════════════════════

#include <Arduino.h>

static const int PIN_RELE = 26;

// ── Cómo se maneja este relé: OPEN-DRAIN ────────────────────────────────────
//
// Este módulo no entiende "3.3 V" como apagado. Medido sobre la placa real:
//
//     IN al aire        → relé en REPOSO      ✅
//     IN a masa (DC-)   → relé ACTIVADO
//     IN a 3.3 V        → relé ACTIVADO       ✗
//     IN a 5 V          → relé ACTIVADO       ✗
//
// El motivo es que del otro lado del optoacoplador hay 12 V. Poner 3.3 V en el
// IN deja igual 8.7 V sobre el LED interno: sigue conduciendo. Un pin normal
// del ESP32, que solo sabe hacer 0 V / 3.3 V, dejaría el relé pegado para
// siempre.
//
// La solución no cuesta nada porque el ESP32 ya la tiene: **open-drain**.
// En ese modo el pin deja de elegir entre dos tensiones y elige entre
// "a masa" y "desconectado". Que es exactamente la tabla de arriba.
//
//     digitalWrite(LOW)   → pin a masa       → relé ACTIVADO
//     digitalWrite(HIGH)  → pin desconectado → relé en REPOSO
//
// Es lo mismo que haría un transistor NPN de bajo lado, pero hecho adentro del
// chip. La corriente medida por el IN es de 4.9 mA; un GPIO del ESP32 tolera
// unos 20 mA, así que absorbe esa corriente sin problema.
//
// Analogía: un pin común devuelve `false`. Open-drain devuelve `undefined`.
// Este relé solo descansa cuando nadie le dice nada.
//
// PRECONDICIÓN VERIFICADA CON EL TESTER: con IN desconectado y 12 V puestos,
// la tensión entre IN y DC- tiene que ser MENOR a 3.3 V. Si fuera 12 V, el pin
// en alta impedancia estaría igual expuesto a 12 V y se quema. No conectar sin
// medir eso primero.
static const int RELE_ACTIVADO = LOW;    // pin a masa
static const int RELE_REPOSO   = HIGH;   // pin desconectado (alta impedancia)

// Ventana de silencio al arrancar. Durante estos segundos el sketch no toca
// nada, para que se pueda resetear la placa y escuchar si el relé hace clic
// solo. Ese es el criterio de aceptación de esta etapa.
static const uint32_t SILENCIO_MS = 5000;

static const uint32_t PERIODO_MS = 1000;


void setup() {
  // ── El orden de estas tres líneas no es decorativo ────────────────────────
  // digitalWrite ANTES de pinMode carga el valor en el latch de salida. Cuando
  // pinMode habilita el pin, ya sale manejando el valor correcto.
  //
  // Al revés (pinMode primero) hay una ventana de microsegundos en la que el
  // pin ya está habilitado pero todavía tiene el valor por defecto —que es
  // LOW, o sea RELE_ACTIVADO— y el relé alcanza a hacer clic. Es una race
  // condition: el orden de dos líneas cambia el resultado.
  //
  // Acá sí importa de verdad, porque en open-drain el estado peligroso ES el
  // valor por defecto.
  digitalWrite(PIN_RELE, RELE_REPOSO);
  pinMode(PIN_RELE, OUTPUT_OPEN_DRAIN);
  digitalWrite(PIN_RELE, RELE_REPOSO);

  // Nota sobre el arranque de la placa: antes de que corra esta línea, el
  // GPIO26 es una entrada, o sea alta impedancia, o sea IN al aire, o sea relé
  // en reposo. El estado seguro es el estado por defecto del silicio, no algo
  // que dependa de que nuestro código llegue a ejecutarse. Eso es lo que hace
  // que un reset a mitad de una pinta no abra la canilla.

  Serial.begin(115200);
  delay(300);

  Serial.println();
  Serial.println("=============================================");
  Serial.println(" GRIFO DE CERVEZA - ETAPA 4: RELE");
  Serial.println("=============================================");
  Serial.printf("Pin de control    : GPIO %d\n", PIN_RELE);
  Serial.println("Modo              : OPEN-DRAIN");
  Serial.println("  LOW  = pin a masa       -> relé ACTIVADO");
  Serial.println("  HIGH = pin desconectado -> relé en reposo");
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
  digitalWrite(PIN_RELE, activo ? RELE_ACTIVADO : RELE_REPOSO);

  Serial.printf("[%7lu ms] %s   (GPIO%d %s)\n",
                ahora,
                activo ? "ACTIVADO  - valvula ABIERTA" : "reposo    - valvula cerrada",
                PIN_RELE,
                activo ? "a masa" : "desconectado");
}
