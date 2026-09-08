// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — ETAPA 3: caudalímetro solo
//
// Prueba UNA cosa: que podamos contar los pulsos del YF-S201C de forma
// confiable. Sin lector, sin relé, sin WiFi.
//
// El conteo va por el periférico PCNT del ESP32, no por una interrupción por
// pulso. La diferencia importa: una ISR por pulso es código nuestro corriendo
// cientos de veces por segundo, que compite con todo lo demás y puede perder
// cuentas si el procesador está ocupado. El PCNT es un contador de hardware:
// cuenta solo, aunque el procesador esté haciendo otra cosa o hablando por
// WiFi. Nosotros solo le preguntamos el número.
//
//   Es la diferencia entre un `setInterval` que incrementa una variable y un
//   `COUNT(*)` en la base. El primero depende de que tu proceso llegue a tiempo.
//
// CABLEADO:
//
//     Caudalímetro     ESP32
//     ──────────────────────
//     rojo   (VCC)  →  5V
//     negro  (GND)  →  GND
//     amarillo      →  GPIO 27
//
//     Y una resistencia de 10k entre el AMARILLO y 3V3.
//     Sin esa resistencia el conteo no sirve — ver abajo.
// ═════════════════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include "driver/pcnt.h"

static const gpio_num_t   PIN_CAUDAL = GPIO_NUM_27;
static const pcnt_unit_t  UNIDAD     = PCNT_UNIT_0;

// El contador del PCNT es de 16 bits con signo: se pasa de rosca a los 32767.
// A caudal máximo del sensor eso son ~70 litros, así que en una tirada no
// pasaría... pero "no pasaría" no es una garantía. Configuramos un límite alto
// bajo, y cada vez que lo toca el hardware se reinicia solo y avisa.
static const int16_t  LIMITE_ALTO = 10000;

// Filtro de glitch, en ciclos del reloj APB (80 MHz). 1023 es el máximo:
// ~12.8 µs. Cualquier pulso más corto que eso se descarta como ruido.
//
// A caudal máximo el sensor da ~225 pulsos por segundo, o sea un pulso cada
// 4,4 ms. 12,8 µs es 300 veces más corto que el pulso real: filtramos ruido sin
// riesgo de comernos una cuenta buena. Es un debounce, igual que el del lector
// de la etapa 2, pero hecho por hardware.
static const uint16_t FILTRO_CICLOS = 1023;

// Factor NOMINAL de la hoja de datos del YF-S201, provisional hasta la etapa 7.
// La calibración real se mide con probeta: dos sensores del mismo modelo pueden
// diferir varios por ciento, y ese porcentaje es plata.
static const float PULSOS_POR_LITRO_NOMINAL = 450.0f;

static volatile uint32_t desbordes = 0;

/** Salta cada LIMITE_ALTO pulsos, no en cada pulso. A caudal máximo eso es una
 *  vez cada 44 segundos: el costo de la interrupción es despreciable y el
 *  conteo queda exacto igual. */
static void IRAM_ATTR alDesbordar(void *) {
  desbordes++;
}

/** Pulsos acumulados desde el arranque.
 *
 *  Se lee el contador de desbordes, después el del hardware, y de nuevo el de
 *  desbordes. Si cambió en el medio, la lectura quedó a caballo de un desborde
 *  y se repite. Sin eso, una vez cada tanto el total daría 10.000 pulsos de
 *  más o de menos — y en este sistema un pulso es cerveza cobrada. */
static uint32_t totalPulsos() {
  uint32_t antes, despues;
  int16_t  actual = 0;
  do {
    antes = desbordes;
    pcnt_get_counter_value(UNIDAD, &actual);
    despues = desbordes;
  } while (antes != despues);
  if (actual < 0) actual = 0;
  return antes * (uint32_t)LIMITE_ALTO + (uint32_t)actual;
}


void setup() {
  Serial.begin(115200);
  delay(300);

  Serial.println();
  Serial.println("=============================================");
  Serial.println(" GRIFO DE CERVEZA - ETAPA 3: CAUDALIMETRO");
  Serial.println("=============================================");

  // El pull-up lo pone la resistencia externa de 10k a 3.3V, NO el interno del
  // ESP32. A propósito: el interno son ~45k, demasiado débil para un cable de
  // un metro en un bar lleno de motores y heladeras. Y además, dejándolo
  // apagado, si te olvidás la resistencia el contador se dispara solo — que es
  // exactamente el síntoma que esta etapa tiene que poder detectar.
  gpio_set_pull_mode(PIN_CAUDAL, GPIO_FLOATING);

  pcnt_config_t cfg = {};
  cfg.pulse_gpio_num = PIN_CAUDAL;
  cfg.ctrl_gpio_num  = PCNT_PIN_NOT_USED;
  cfg.lctrl_mode     = PCNT_MODE_KEEP;
  cfg.hctrl_mode     = PCNT_MODE_KEEP;
  cfg.pos_mode       = PCNT_COUNT_INC;    // cuenta el flanco de subida
  cfg.neg_mode       = PCNT_COUNT_DIS;    // el de bajada no, para no contar doble
  cfg.counter_h_lim  = LIMITE_ALTO;
  cfg.counter_l_lim  = 0;
  cfg.unit           = UNIDAD;
  cfg.channel        = PCNT_CHANNEL_0;
  pcnt_unit_config(&cfg);

  pcnt_set_filter_value(UNIDAD, FILTRO_CICLOS);
  pcnt_filter_enable(UNIDAD);

  pcnt_event_enable(UNIDAD, PCNT_EVT_H_LIM);
  pcnt_isr_service_install(0);
  pcnt_isr_handler_add(UNIDAD, alDesbordar, NULL);

  pcnt_counter_pause(UNIDAD);
  pcnt_counter_clear(UNIDAD);
  pcnt_counter_resume(UNIDAD);

  Serial.printf("Pin de senal      : GPIO %d\n", (int)PIN_CAUDAL);
  Serial.printf("Filtro de glitch  : %u ciclos APB (~%.1f us)\n",
                FILTRO_CICLOS, FILTRO_CICLOS / 80.0);
  Serial.printf("Factor provisional: %.0f pulsos/litro (se calibra en la etapa 7)\n",
                PULSOS_POR_LITRO_NOMINAL);
  Serial.println("---------------------------------------------");
  Serial.println("Con el sensor QUIETO, la columna pulsos NO se");
  Serial.println("tiene que mover. Si sube sola, falta el pull-up.");
  Serial.println("Sopla por la entrada para verla subir.");
  Serial.println("---------------------------------------------");
  Serial.println();
}


void loop() {
  static uint32_t ultimoAviso = 0;
  static uint32_t pulsosPrevios = 0;
  static uint32_t quietoDesde = 0;

  uint32_t ahora = millis();
  if (ahora - ultimoAviso < 1000) return;      // sin delay(): el loop no se bloquea
  uint32_t transcurrido = ahora - ultimoAviso;
  ultimoAviso = ahora;

  uint32_t pulsos = totalPulsos();
  uint32_t nuevos = pulsos - pulsosPrevios;
  pulsosPrevios = pulsos;

  float porSegundo = (nuevos * 1000.0f) / transcurrido;
  float mlTotales  = (pulsos * 1000.0f) / PULSOS_POR_LITRO_NOMINAL;

  if (nuevos == 0) {
    if (quietoDesde == 0) quietoDesde = ahora;
    // Quieto y sin contar es el resultado BUENO. Se avisa cada 5 s para no
    // llenar la consola, pero se avisa: silencio absoluto no distingue "todo
    // bien" de "la placa se colgó".
    if ((ahora - quietoDesde) % 5000 < 1000) {
      Serial.printf("[%7lu ms] quieto      pulsos=%lu\n", ahora, pulsos);
    }
    return;
  }

  quietoDesde = 0;
  Serial.printf("[%7lu ms] pulsos=%-8lu  +%-5lu  %6.1f p/s  ~%.0f ml  ~%.2f L/min\n",
                ahora, pulsos, nuevos, porSegundo, mlTotales,
                (porSegundo * 60.0f) / PULSOS_POR_LITRO_NOMINAL);
}
