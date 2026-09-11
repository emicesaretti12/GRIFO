// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — ETAPA 5: los tres juntos, sin red
//
// Primera etapa en la que el sistema **hace lo que tiene que hacer**: lee la
// tarjeta, autoriza, sirve mientras se aprieta el botón, corta al llegar al
// límite, y cobra al retirar la tarjeta.
//
// Sin WiFi y sin Supabase. Los saldos están hardcodeados acá abajo y viven en
// RAM: se reinician con la placa. Eso llega en la etapa 6.
//
// **La válvula NO se conecta todavía.** Solo el relé haciendo clic. La cerveza
// de verdad recién en la etapa 7, después de calibrar.
//
// ── CABLEADO ────────────────────────────────────────────────────────────────
//
//     Lector MFRC522 (alimentación 3.3V, nunca 5V)
//       SDA/SS → GPIO 5      SCK  → GPIO 18
//       MOSI   → GPIO 23     MISO → GPIO 19     RST → GPIO 22
//
//     Caudalímetro — alimentado a 3.3V, NO a 5V
//       rojo → 3V3    negro → GND    amarillo → GPIO 27 directo
//
//       A 3.3V su señal no puede superar los 3.3V, así que no necesita
//       conversor. Eso libera el conversor para el relé solo, y evita que los
//       11 V del relé se filtren al canal del sensor por el riel HV compartido.
//       Ver docs/cableado-completo.md.
//
//     Relé
//       IN → canal 4 del conversor (HV4);  LV4 → GPIO 26
//       DC+/DC- a la fuente de 12V, y el DC- también al GND del ESP32
//
//     Botón
//       una pata → GPIO 14      la otra → GND
//       Si no hay botón: un cable macho-macho de GPIO14 a GND hace lo mismo.
//       Tocar = apretar, soltar = soltar. Un botón no es otra cosa.
//
// ── EL INVARIANTE DE SEGURIDAD ──────────────────────────────────────────────
//
// En CADA vuelta del loop, si el estado no es SIRVIENDO, la válvula se cierra.
// No "se verifica que esté cerrada": se cierra.
//
// No alcanza con cerrarla en las transiciones. Una transición que nos olvidamos
// de cubrir, un `return` temprano, un estado nuevo agregado dentro de seis
// meses: cualquiera de esas deja la canilla abierta. La verificación de cada
// vuelta no depende de que el resto del código esté completo.
//
//   Es la diferencia entre validar en cada endpoint y validar en el middleware.
//   El middleware sigue andando cuando alguien agrega un endpoint y se olvida.
// ═════════════════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include <string.h>
#include "../comun/dinero.h"
#include "../comun/valvula.h"
#include "../comun/caudal.h"
#include "../comun/tarjeta.h"

// ── Reglas de negocio, hardcodeadas en esta etapa ───────────────────────────

// Precio por litro de esta canilla. En la etapa 6 sale de `canillas.precio` en
// Supabase — el precio es **por canilla**, no global: una IPA no vale lo mismo
// que una rubia.
static const uint32_t PRECIO_CENTAVOS_POR_LITRO = 450000;   // $4.500 el litro

// Factor NOMINAL de la hoja de datos, provisional hasta la etapa 7. La
// calibración real se mide con probeta y agua de canilla: dos sensores del
// mismo modelo difieren varios por ciento, y ese porcentaje es plata.
static const uint32_t PULSOS_POR_LITRO = 450;

// Saldos de prueba. Los UID son los de las dos tarjetas leídas en la etapa 2.
// Cualquier otra tarjeta queda en 0 y se rechaza, que es el comportamiento
// correcto: una tarjeta desconocida no sirve cerveza.
struct Cuenta { const char *uid; Centavos saldo; };
static Cuenta cuentas[] = {
  { "61FB7A54", 500000 },    // $5.000
  { "E46D94E5",  20000 },    // $200 — poco a propósito, para ver el corte
};
static const size_t CANTIDAD_CUENTAS = sizeof(cuentas) / sizeof(cuentas[0]);

// ── Failsafes ───────────────────────────────────────────────────────────────
// Los dos existen para el mismo escenario: algo se rompe y la válvula queda
// abierta. Ninguno depende de que la lógica de arriba sea correcta.

// Una pinta son ~20 segundos. 90 significa que algo está mal.
static const uint32_t MAX_APERTURA_MS = 90000;

// Válvula abierta y el caudalímetro no cuenta nada: o se vació el barril, o el
// sensor se murió, o la válvula no abrió. En los tres casos hay que cerrar: si
// el sensor está mudo, no tenemos forma de cobrar lo que salga.
static const uint32_t SIN_PULSOS_MS = 3000;

static const int PIN_BOTON = 14;
static const int PIN_LED   = 2;
static const uint32_t REBOTE_BOTON_MS = 30;


// ── La máquina de estados ───────────────────────────────────────────────────
enum Estado {
  ESPERANDO,     // sin tarjeta
  AUTORIZANDO,   // tarjeta apoyada, calculando cuánto puede tomar
  LISTO,         // autorizado, esperando el botón. Válvula cerrada.
  SIRVIENDO,     // botón apretado. Válvula abierta. Único estado que sirve.
  LIQUIDANDO,    // tarjeta retirada, hay que cobrar
  RECHAZADO      // saldo insuficiente o tarjeta desconocida
};

static Estado   estado = ESPERANDO;

static char     uidSesion[21] = "";
static Centavos saldoSesion   = 0;
static uint32_t pulsosMax     = 0;   // cuánto autoriza el saldo
static uint32_t pulsosBase    = 0;   // el contador global al abrir la sesión
static uint32_t pulsosServidos = 0;  // los de ESTA sesión

static uint32_t ultimoPulsoMs   = 0;
static uint32_t ultimoInforme   = 0;
static uint32_t pulsosPrevios   = 0;


static const char *nombreEstado(Estado e) {
  switch (e) {
    case ESPERANDO:   return "ESPERANDO";
    case AUTORIZANDO: return "AUTORIZANDO";
    case LISTO:       return "LISTO";
    case SIRVIENDO:   return "SIRVIENDO";
    case LIQUIDANDO:  return "LIQUIDANDO";
    case RECHAZADO:   return "RECHAZADO";
  }
  return "?";
}

static void irA(Estado nuevo) {
  if (nuevo == estado) return;
  Serial.printf("[%7lu ms] %s -> %s\n",
                (unsigned long)millis(), nombreEstado(estado), nombreEstado(nuevo));
  estado = nuevo;
}

/** Busca la cuenta de un UID. Devuelve NULL si la tarjeta es desconocida.
 *  En la etapa 6 esto es una RPC a Supabase con su cola offline en NVS. */
static Cuenta *buscarCuenta(const char *uid) {
  for (size_t i = 0; i < CANTIDAD_CUENTAS; i++) {
    if (strcmp(cuentas[i].uid, uid) == 0) return &cuentas[i];
  }
  return NULL;
}

/** Botón con antirrebote. Un contacto mecánico no pasa de abierto a cerrado de
 *  una: rebota varias veces en unos milisegundos. Sin filtro, una sola apretada
 *  se leería como varias.
 *
 *  `INPUT_PULLUP` deja el pin en alto cuando el botón está suelto, así que
 *  apretado es **LOW**. La lógica queda invertida respecto de lo que uno
 *  esperaría, y es lo normal en botones: el pull-up es lo que evita que el pin
 *  quede flotando cuando nadie lo toca. */
static bool botonApretado() {
  static bool     estable = false;
  static bool     ultimaLectura = false;
  static uint32_t cambioEn = 0;

  bool lectura = (digitalRead(PIN_BOTON) == LOW);
  uint32_t ahora = millis();

  if (lectura != ultimaLectura) {
    ultimaLectura = lectura;
    cambioEn = ahora;
    return estable;
  }
  if (ahora - cambioEn >= REBOTE_BOTON_MS) estable = lectura;
  return estable;
}

static void imprimirTicket(const char *uid, uint32_t pulsos,
                           Centavos cobrado, Centavos saldoNuevo) {
  char sCobrado[24], sSaldo[24];
  formatearPesos(cobrado, sCobrado, sizeof(sCobrado));
  formatearPesos(saldoNuevo, sSaldo, sizeof(sSaldo));

  Serial.println();
  Serial.println("================ TICKET ================");
  Serial.printf(" Tarjeta   : %s\n", uid);
  Serial.printf(" Servido   : %lu ml  (%lu pulsos)\n",
                (unsigned long)mlDeLosPulsos(pulsos, PULSOS_POR_LITRO),
                (unsigned long)pulsos);
  Serial.printf(" Cobrado   : %s\n", sCobrado);
  Serial.printf(" Saldo     : %s\n", sSaldo);
  Serial.println("========================================");
  Serial.println();
}


void setup() {
  // Primero la válvula, antes que cualquier otra cosa. Si algo de lo que viene
  // después falla y se cuelga, la canilla ya quedó cerrada.
  valvulaIniciar();

  Serial.begin(115200);
  delay(300);

  pinMode(PIN_BOTON, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  Serial.println();
  Serial.println("=============================================");
  Serial.println(" GRIFO DE CERVEZA - ETAPA 5: MAQUINA DE ESTADOS");
  Serial.println("=============================================");

  // El caudalímetro ya no pasa por el conversor: se alimenta a 3.3V y va directo
  // al GPIO27, así que el pull-up lo pone el ESP32. Si quieto cuenta pulsos, el
  // pull-up interno (~45k) es muy débil para este cable y hay que poner uno
  // externo.
  caudalIniciar(true);

  if (!tarjetaIniciar()) {
    Serial.println("!! El lector RFID no contesta. Revisar cableado SPI y");
    Serial.println("!! que este alimentado con 3.3V (con 5V se quema).");
  }

  char sPrecio[24];
  formatearPesos(PRECIO_CENTAVOS_POR_LITRO, sPrecio, sizeof(sPrecio));
  Serial.printf("Precio por litro  : %s\n", sPrecio);
  Serial.printf("Pulsos por litro  : %lu (nominal, se calibra en la etapa 7)\n",
                (unsigned long)PULSOS_POR_LITRO);
  Serial.println("Pull-up caudal    : INTERNO (~45k)");
  Serial.println("---------------------------------------------");
  Serial.println("Tarjetas cargadas:");
  for (size_t i = 0; i < CANTIDAD_CUENTAS; i++) {
    char s[24];
    formatearPesos(cuentas[i].saldo, s, sizeof(s));
    Serial.printf("  %s  %s\n", cuentas[i].uid, s);
  }
  Serial.println("---------------------------------------------");
  Serial.println("1) Apoya la tarjeta");
  Serial.println("2) Aprieta el boton (o toca GPIO14 contra GND)");
  Serial.println("3) Retira la tarjeta para cobrar");
  Serial.println("---------------------------------------------");
  Serial.println();
}


void loop() {
  uint32_t ahora = millis();

  tarjetaActualizar(ahora);

  // ── EL INVARIANTE ─────────────────────────────────────────────────────────
  // Si no estamos sirviendo, la válvula se cierra. En cada vuelta, sin
  // excepciones, antes de cualquier otra lógica.
  if (estado != SIRVIENDO) valvulaCerrar();

  digitalWrite(PIN_LED, tarjetaPresente() ? HIGH : LOW);

  switch (estado) {

    case ESPERANDO: {
      if (!tarjetaPresente()) break;
      strncpy(uidSesion, tarjetaUid(), sizeof(uidSesion) - 1);
      uidSesion[sizeof(uidSesion) - 1] = '\0';
      irA(AUTORIZANDO);
      break;
    }

    case AUTORIZANDO: {
      Cuenta *cuenta = buscarCuenta(uidSesion);
      if (cuenta == NULL) {
        Serial.printf("Tarjeta %s desconocida.\n", uidSesion);
        irA(RECHAZADO);
        break;
      }

      saldoSesion = cuenta->saldo;
      pulsosMax   = pulsosQuePagaElSaldo(saldoSesion,
                                         PRECIO_CENTAVOS_POR_LITRO,
                                         PULSOS_POR_LITRO);
      if (pulsosMax == 0) {
        char s[24];
        formatearPesos(saldoSesion, s, sizeof(s));
        Serial.printf("Saldo insuficiente: %s\n", s);
        irA(RECHAZADO);
        break;
      }

      // La base se toma del contador global ACÁ, no en cero. El PCNT cuenta
      // desde que arrancó la placa y nunca se reinicia: los pulsos de esta
      // sesión son la diferencia. Reiniciar el contador en cada sesión abriría
      // una ventana en la que un pulso se pierde entre el clear y el resume.
      pulsosBase     = caudalPulsos();
      pulsosServidos = 0;
      pulsosPrevios  = 0;

      char sSaldo[24];
      formatearPesos(saldoSesion, sSaldo, sizeof(sSaldo));
      Serial.printf("Tarjeta %s | saldo %s | autorizado hasta %lu ml\n",
                    uidSesion, sSaldo,
                    (unsigned long)mlDeLosPulsos(pulsosMax, PULSOS_POR_LITRO));
      Serial.println("Apreta el boton para servir.");
      irA(LISTO);
      break;
    }

    case LISTO: {
      if (!tarjetaPresente()) { irA(LIQUIDANDO); break; }

      if (botonApretado() && pulsosServidos < pulsosMax) {
        valvulaAbrir();
        ultimoPulsoMs = ahora;
        ultimoInforme = ahora;
        irA(SIRVIENDO);
      }
      break;
    }

    case SIRVIENDO: {
      uint32_t pulsos = caudalPulsos() - pulsosBase;
      pulsosServidos = pulsos;

      if (pulsos != pulsosPrevios) {
        pulsosPrevios = pulsos;
        ultimoPulsoMs = ahora;
      }

      // 1) El corte por saldo. Comparación de enteros, acá adentro, sin
      //    preguntarle a nadie. Aunque el WiFi esté caído y Supabase no exista,
      //    este `if` corta igual. Es la razón por la que el límite se calcula en
      //    pulsos al autorizar y no se consulta durante la tirada.
      if (pulsos >= pulsosMax) {
        valvulaCerrar();
        Serial.println(">> Limite de saldo alcanzado. Corta.");
        irA(LISTO);
        break;
      }

      // 2) Soltó el botón.
      if (!botonApretado()) {
        valvulaCerrar();
        irA(LISTO);
        break;
      }

      // 3) Retiró la tarjeta con el botón apretado. Cierra y cobra.
      if (!tarjetaPresente()) {
        valvulaCerrar();
        irA(LIQUIDANDO);
        break;
      }

      // 4) Failsafe de tiempo.
      if (ahora - valvulaAbiertaDesde() > MAX_APERTURA_MS) {
        valvulaCerrar();
        Serial.println("!! FAILSAFE: 90 s abierta. Corta.");
        irA(LISTO);
        break;
      }

      // 5) Failsafe de caudal mudo.
      if (ahora - ultimoPulsoMs > SIN_PULSOS_MS) {
        valvulaCerrar();
        Serial.println("!! FAILSAFE: abierta sin pulsos. Barril vacio, sensor");
        Serial.println("!! muerto o valvula trabada. Corta.");
        irA(LISTO);
        break;
      }

      if (ahora - ultimoInforme >= 500) {
        ultimoInforme = ahora;
        char s[24];
        formatearPesos(precioDeLosPulsos(pulsos, PRECIO_CENTAVOS_POR_LITRO,
                                         PULSOS_POR_LITRO), s, sizeof(s));
        Serial.printf("   sirviendo... %lu ml  %s  (%lu/%lu pulsos)\n",
                      (unsigned long)mlDeLosPulsos(pulsos, PULSOS_POR_LITRO), s,
                      (unsigned long)pulsos, (unsigned long)pulsosMax);
      }
      break;
    }

    case LIQUIDANDO: {
      Centavos cobrado = precioDeLosPulsos(pulsosServidos,
                                           PRECIO_CENTAVOS_POR_LITRO,
                                           PULSOS_POR_LITRO);

      Cuenta *cuenta = buscarCuenta(uidSesion);
      if (cuenta != NULL) {
        // No puede quedar negativo: `pulsosQuePagaElSaldo` truncó hacia abajo
        // justamente para dejar margen a este redondeo hacia arriba. El `if` es
        // un cinturón además de los tirantes.
        cuenta->saldo = (cobrado >= cuenta->saldo) ? 0 : cuenta->saldo - cobrado;
        imprimirTicket(uidSesion, pulsosServidos, cobrado, cuenta->saldo);
      }

      uidSesion[0]   = '\0';
      pulsosServidos = 0;
      pulsosMax      = 0;
      irA(ESPERANDO);
      break;
    }

    case RECHAZADO: {
      // Se queda acá hasta que retiren la tarjeta. Sin esto volvería a
      // AUTORIZANDO cien veces por segundo y llenaría la consola con el mismo
      // rechazo.
      if (!tarjetaPresente()) {
        uidSesion[0] = '\0';
        irA(ESPERANDO);
      }
      break;
    }
  }
}
