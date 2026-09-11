#include <Arduino.h>
#include "driver/pcnt.h"
#include "caudal.h"

static const gpio_num_t  PIN_CAUDAL = GPIO_NUM_27;
static const pcnt_unit_t UNIDAD     = PCNT_UNIT_0;

// El contador del PCNT es de 16 bits con signo: se pasa de rosca a los 32767.
// Ponemos un límite bajo, y cada vez que lo toca el hardware se reinicia solo y
// nos avisa por interrupción. A caudal máximo eso pasa una vez cada 44 segundos.
static const int16_t  LIMITE_ALTO   = 10000;

// Filtro de glitch en ciclos del reloj APB (80 MHz). 1023 es el máximo: ~12,8 µs.
// El pulso real más corto del sensor dura 4,4 ms, o sea 300 veces más. Filtramos
// ruido sin riesgo de comernos una cuenta buena. Es un debounce por hardware.
static const uint16_t FILTRO_CICLOS = 1023;

static volatile uint32_t desbordes = 0;

static void IRAM_ATTR alDesbordar(void *) { desbordes++; }

void caudalIniciar(bool pullupInterno) {
  // ── De dónde sale el pull-up ──────────────────────────────────────────────
  // El sensor es colector abierto: solo sabe llevar el cable a masa o soltarlo.
  // Cuando lo suelta, algo tiene que fijarlo en alto o queda flotando y el
  // contador cuenta ruido.
  //
  // En la etapa 3 el pull-up lo ponía el conversor de niveles, con su riel HV a
  // 5 V. Pero en la etapa 4 hubo que **desconectar ese riel**: su pull-up de 10k
  // arrastraba el `IN` del relé lo suficiente como para dejarlo pegado. Los dos
  // usos del riel no conviven.
  //
  // Así que acá se prueba la salida 1 de las anotadas en el plan: el pull-up lo
  // pone el ESP32, del lado de 3,3 V, y el riel HV queda desconectado.
  //
  // Los 45k del interno son más débiles que los 10k del conversor, y eso importa
  // con un cable largo cerca de heladeras y motores. Si en la canilla cuenta de
  // más, el pull-up tiene que volver a ser externo y hay que resolver el riel de
  // otra forma. Acá el criterio es el mismo de siempre: **quieto no cuenta ni un
  // pulso.**
  gpio_set_pull_mode(PIN_CAUDAL,
                     pullupInterno ? GPIO_PULLUP_ONLY : GPIO_FLOATING);

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
}

uint32_t caudalPulsos() {
  // Se lee el contador de desbordes, después el del hardware, y de nuevo el de
  // desbordes. Si cambió en el medio, la lectura quedó a caballo de un desborde
  // y se repite.
  //
  // Sin esto, una vez cada tanto el total daría 10.000 pulsos de más o de menos.
  // En este sistema un pulso es cerveza cobrada.
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
