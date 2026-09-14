// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — ETAPA 6: Supabase + cola offline
//
// La etapa 5 con los saldos de verdad. El sistema ya es el del bar.
//
// **La válvula sigue sin conectarse.** Solo el relé haciendo clic.
//
// ── DOS TAREAS EN DOS NÚCLEOS, Y NO ES UN CAPRICHO ──────────────────────────
//
// Una petición HTTPS puede tardar segundos: resolver DNS, negociar TLS, esperar
// al servidor. Si eso pasara en el mismo lugar que la máquina de estados, la
// válvula quedaría abierta sin que nadie cuente pulsos ni mire el límite
// durante todo ese rato.
//
//   tareaControl  núcleo 1, prioridad alta  → tarjeta, pulsos, válvula
//   tareaRed      núcleo 0, prioridad baja  → WiFi, HTTPS, vaciar la cola
//
// **`tareaControl` nunca llama a la red.** Ni una vez. Se hablan por colas.
//
//   Es sacar el trabajo lento del request y mandarlo a un worker. La diferencia
//   es que acá "el request" es lo que corta el chorro de cerveza.
//
// ── QUÉ PASA SI SE CAE EL WIFI ──────────────────────────────────────────────
//
//   · A mitad de una tirada  → **no pasa nada.** El límite ya está en pulsos,
//     adentro del ESP32, y el corte es una comparación de enteros. La red no
//     participa.
//   · Al cerrar la sesión    → el cierre se escribe en la flash y se reintenta
//     hasta que entre. El cliente se va, el próximo puede servir, y la venta no
//     se pierde.
//   · Al abrir una sesión    → ahí sí hace falta red: el saldo vive en Supabase
//     y no lo podemos adivinar. Sin red, la canilla no autoriza. Es lo correcto:
//     preferimos no servir antes que servir sin saber si hay con qué pagar.
//
// ── CABLEADO ────────────────────────────────────────────────────────────────
// El mismo de la etapa 5. Ver docs/cableado-completo.md.
// ═════════════════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include <string.h>
#include <esp_task_wdt.h>
#include "../comun/dinero.h"
#include "../comun/valvula.h"
#include "../comun/caudal.h"
#include "../comun/tarjeta.h"
#include "cola.h"
#include "red.h"
#include "secrets.h"

static const uint32_t MAX_APERTURA_MS   = 90000;
static const uint32_t SIN_PULSOS_MS     = 3000;
static const uint32_t TIMEOUT_AUTORIZAR = 10000;

// ── Watchdog ────────────────────────────────────────────────────────────────
// Un perro guardián: si una tarea deja de avisar que está viva durante este
// tiempo, el chip se reinicia solo.
//
// Sin esto, una tarea trabada deja la canilla muerta hasta que alguien nota que
// no funciona y va a desenchufarla. En un bar eso puede ser toda una noche.
//
//   Es el proceso que se reinicia solo cuando deja de responder al health
//   check. No arregla la causa, pero evita que una falla dure horas.
//
// Y el reinicio es seguro por construcción: al arrancar, el GPIO del relé es
// una entrada en alta impedancia, o sea válvula cerrada. Un watchdog que
// reiniciara con la canilla abierta sería peor que no tenerlo.
//
// 30 s es holgado a propósito: una petición HTTPS puede tardar 8 s, y la tarea
// de red puede encadenar dos en una vuelta. El watchdog tiene que disparar por
// algo trabado de verdad, no por una red lenta.
static const uint32_t WATCHDOG_S = 30;

// Cada cuánto la canilla le avisa al servidor que está viva.
static const uint32_t LATIDO_MS = 60000;

static const int PIN_BOTON = 14;
static const int PIN_LED   = 2;
// ── El antirrebote del botón es ASIMÉTRICO, y no es un capricho ─────────────
// Los dos errores no cuestan lo mismo.
//
// Tardar 30 ms de más en ABRIR no lo nota nadie. Cerrar por error mientras sale
// cerveza le corta el chorro al cliente en la mitad del vaso, y desde afuera se
// ve exactamente como un sistema que se cuelga.
//
// Así que apretar se confirma rápido y soltar se confirma lento: un cuarto de
// segundo de contacto perdido —un cable que vibra, ruido del relé conmutando,
// el SPI del lector reiniciándose al lado— no alcanza para cortar.
//
//   Es el mismo criterio que el debounce de retirada de la tarjeta: cuando los
//   dos errores no cuestan lo mismo, el umbral no va en el medio.
static const uint32_t REBOTE_APRETAR_MS = 30;
static const uint32_t REBOTE_SOLTAR_MS  = 250;

// ── Los dos canales entre las tareas ────────────────────────────────────────
static QueueHandle_t colaPedidoAbrir;     // control → red:  un UID
static QueueHandle_t colaRespuestaAbrir;  // red → control:  el resultado

// Lleva la hora en que se pidió. Sin eso, un pedido que quedó encolado porque
// no había WiFi se manda igual cuando el WiFi vuelve, medio minuto después, y
// abre una sesión para una tarjeta que ya no está.
struct PedidoAbrir { char uid[21]; uint32_t pedidoEn; };

// ── El progreso para la pantalla del cliente ────────────────────────────────
// Va por una cola de UN elemento con `xQueueOverwrite`: si la tarea de red no
// llegó a mandar el anterior, se pisa con el nuevo.
//
// Es lo correcto acá. El progreso es una foto del momento, no un evento que
// haya que conservar: mandar uno viejo porque quedó encolado mostraría el vaso
// más vacío de lo que está.
//
//   Es un `debounce` con el último valor, no una cola de trabajos.
struct Progreso { int64_t sesionId; uint32_t ml; uint32_t pulsos; };
static QueueHandle_t colaProgreso;

// Cada cuánto se refresca el vaso de la pantalla. Más seguido no se nota a
// simple vista y le roba tiempo a la red; más espaciado se ve a los saltos.
static const uint32_t PROGRESO_MS = 1000;


// ═════════════════════════════════════════════════════════════════════════════
// TAREA DE RED — núcleo 0
// ═════════════════════════════════════════════════════════════════════════════
static void tareaRed(void *) {
  esp_task_wdt_add(NULL);
  redIniciar();

  // ── Pagar el handshake TLS ACA, antes de que haya alguien esperando ───────
  // Esto es lo que rompía el arranque. La conexión segura tarda dos o tres
  // segundos en abrirse, y la primera petición que salía era la del primer
  // cliente que apoyaba la tarjeta: la pagaba él, parado frente a la canilla,
  // con el lector perdiéndole la tarjeta mientras tanto.
  //
  //   El costo de arranque no desaparece porque lo ignores. Solo elegís quién
  //   lo paga: el sistema al levantarse, o el primer usuario del día.
  uint32_t esperandoDesde = millis();
  while (!redConectada() && millis() - esperandoDesde < 20000) {
    esp_task_wdt_reset();
    redMantener();
    vTaskDelay(pdMS_TO_TICKS(200));
  }
  redMantener();
  esp_task_wdt_reset();
  redCalentar(colaCantidad());

  // Ya se mandó uno recién; el próximo va dentro de un minuto y no ahora mismo.
  uint32_t ultimoLatido = millis();

  for (;;) {
    esp_task_wdt_reset();
    redMantener();

    // ── El orden de acá abajo ES la política del sistema ──────────────────
    //
    // Todo lo que sigue comparte una sola conexión y un solo hilo, así que lo
    // que va primero puede hacer esperar a lo que va después. El orden no es
    // estético: decide qué se sacrifica cuando la red anda mal.
    //
    //   1. AUTORIZAR  — hay un cliente parado con la tarjeta en la mano.
    //   2. COBRAR     — es plata ya servida.
    //   3. LATIDO     — barato, y es lo que avisa si esta canilla se cayó.
    //   4. PROGRESO   — un adorno.
    //
    // La primera versión tenía el progreso arriba de todo. Con la pantalla
    // refrescando cada 700 ms, un solo pedido colgado dejaba esperando detrás a
    // la autorización del cliente siguiente y a los cobros.
    //
    //   Es poner el envío del mail de cortesía adelante del cobro de la tarjeta
    //   en la misma cola. Funciona hasta el día que el servidor de mail tarda.
    bool hiceAlgoCaro = false;

    // 1) Un cliente esperando que le autoricen la tarjeta.
    //
    // Solo se saca de la cola si hay WiFi. Sacarlo sin red era contestar
    // "rechazada" en 100 ms cuando la verdad es "todavía no me conecté" —
    // pasaba en cada arranque con una tarjeta ya apoyada. Dejándolo en la cola,
    // se atiende apenas hay red, y si nadie esperó tanto, se vence solo.
    PedidoAbrir pedido;
    if (redConectada() && xQueueReceive(colaPedidoAbrir, &pedido, 0) == pdTRUE) {
      if (millis() - pedido.pedidoEn > TIMEOUT_AUTORIZAR) {
        // El de control ya se cansó de esperar. Abrirle la sesión ahora sería
        // dejar una sesión abierta para una tarjeta que no está.
        Serial.println("[red] pedido vencido, se descarta sin abrir sesion");
      } else {
        RespuestaAbrir r;
        redAbrirSesion(pedido.uid, r);
        xQueueSend(colaRespuestaAbrir, &r, 0);
      }
      hiceAlgoCaro = true;
    }

    // 2) Los cierres, de a uno y en orden.
    //
    // De a uno a propósito: si el servidor rechaza el primero, no queremos
    // seguir mandando los demás a ciegas. Y en orden, porque así se cerraron.
    Pendiente p;
    if (colaVerPrimero(p)) {
      Serial.printf("[red] entregando cierre sesion=%lld ml=%lu (quedan %lu)\n",
                    (long long)p.sesionId, (unsigned long)p.ml,
                    (unsigned long)colaCantidad());
      if (redCerrarSesion(p.sesionId, p.ml, p.pulsos)) {
        colaSacarPrimero();
        Serial.println("[red] cierre confirmado");
      } else {
        vTaskDelay(pdMS_TO_TICKS(3000));   // no martillar al servidor
      }
      hiceAlgoCaro = true;
    }

    // 3) El latido, una vez por minuto.
    uint32_t ahora = millis();
    if (redConectada() && !hiceAlgoCaro &&
        (ultimoLatido == 0 || ahora - ultimoLatido >= LATIDO_MS)) {
      ultimoLatido = ahora;
      redLatido(colaCantidad());
      hiceAlgoCaro = true;
    }

    // 4) El progreso de la pantalla. Último, y solo si no hubo nada importante
    //    en esta vuelta: que el vaso se dibuje tarde no le cuesta nada a nadie.
    Progreso prog;
    if (!hiceAlgoCaro && xQueueReceive(colaProgreso, &prog, 0) == pdTRUE) {
      redReportarProgreso(prog.sesionId, prog.ml, prog.pulsos);
    }

    vTaskDelay(pdMS_TO_TICKS(200));
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// TAREA DE CONTROL — núcleo 1
// ═════════════════════════════════════════════════════════════════════════════
enum Estado { ESPERANDO, AUTORIZANDO, LISTO, SIRVIENDO, LIQUIDANDO, RECHAZADO };

static Estado   estado = ESPERANDO;
static char     uidSesion[21] = "";
static int64_t  sesionId = 0;
static uint32_t pulsosMax = 0;
static uint32_t pulsosPorLitroMili = 452700;
static uint32_t precioLitroCentavos = 0;
static uint32_t saldoCentavos = 0;
static uint32_t pulsosBase = 0;
static uint32_t pulsosServidos = 0;
static uint32_t pulsosPrevios = 0;
static uint32_t ultimoPulsoMs = 0;
static uint32_t ultimoInforme = 0;
static uint32_t pidioAutorizarEn = 0;

// ── Por qué AUTORIZANDO tolera que la tarjeta desaparezca un momento ────────
// El lector pierde la tarjeta cada tanto aunque esté apoyada. Cortar la
// autorización al primer parpadeo obligaba a apoyarla de nuevo, y como la
// respuesta tarda, no llegaba nunca: la tarjeta "se iba" antes de que el
// servidor contestara.
//
// Acá el riesgo de esperar de más es cero: la válvula está cerrada y no hay
// plata en juego todavía. En SIRVIENDO es al revés, y por eso allá el criterio
// es el opuesto.
//
//   El mismo evento no vale lo mismo en dos estados distintos. El umbral va
//   donde está el costo, no donde queda prolijo.
static const uint32_t GRACIA_AUSENCIA_MS = 3000;
static uint32_t ausenteDesde = 0;

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

static bool botonApretado() {
  static bool     estable = false;
  static bool     ultimaLectura = false;
  static uint32_t cambioEn = 0;

  bool lectura = (digitalRead(PIN_BOTON) == LOW);
  uint32_t ahora = millis();

  if (lectura != ultimaLectura) { ultimaLectura = lectura; cambioEn = ahora; return estable; }

  uint32_t umbral = lectura ? REBOTE_APRETAR_MS : REBOTE_SOLTAR_MS;
  if (ahora - cambioEn >= umbral) estable = lectura;
  return estable;
}

/** Encola el cierre en la flash. Si esto falla, se perdió una venta, y hay que
 *  gritarlo: es el único camino por el que la plata se puede ir sin dejar
 *  rastro. */
static void encolarCierre(int64_t id, uint32_t ml, uint32_t pulsos) {
  Pendiente p = { id, ml, pulsos };
  if (colaEncolar(p)) return;
  Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  Serial.printf("!! NO SE PUDO GUARDAR EL CIERRE sesion=%lld\n", (long long)id);
  Serial.printf("!! ml=%lu pulsos=%lu -- ANOTALO A MANO\n",
                (unsigned long)ml, (unsigned long)pulsos);
  Serial.println("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
}

static void imprimirTicket(uint32_t ml, uint32_t pulsos) {
  // El cobro de verdad lo hace el servidor; esto es una estimación local para
  // que el cliente vea algo al retirar la tarjeta. Puede diferir por centavos
  // del ticket definitivo, y eso está bien: la fuente de verdad es la base.
  Centavos estimado = (Centavos)(((uint64_t)ml * precioLitroCentavos + 999) / 1000);
  char s[24];
  formatearPesos(estimado, s, sizeof(s));

  Serial.println();
  Serial.println("================ TICKET ================");
  Serial.printf(" Tarjeta   : %s\n", uidSesion);
  Serial.printf(" Servido   : %lu ml  (%lu pulsos)\n",
                (unsigned long)ml, (unsigned long)pulsos);
  Serial.printf(" Estimado  : %s   (lo definitivo lo calcula Supabase)\n", s);
  if (pulsosMax > 0 && pulsos > pulsosMax) {
    Serial.printf(" !! EXCESO : %lu pulsos de mas sobre %lu autorizados\n",
                  (unsigned long)(pulsos - pulsosMax), (unsigned long)pulsosMax);
    Serial.println("              El servidor recorta el cobro al saldo, asi");
    Serial.println("              que esa diferencia la regala el bar.");
  }
  if (!redConectada()) {
    Serial.println(" Sin red   : el cobro quedo en cola, se envia solo");
  }
  Serial.println("========================================");
  Serial.println();
}

static void tareaControl(void *) {
  esp_task_wdt_add(NULL);

  for (;;) {
    esp_task_wdt_reset();
    uint32_t ahora = millis();

    // ── EL CORTE POR LÍMITE VA PRIMERO ──────────────────────────────────────
    // Antes que el lector, antes que cualquier otra cosa. Hablar con el
    // MFRC522 por SPI toma varios milisegundos, y a caudal de servicio cada
    // milisegundo son pulsos que ya salieron por el pico.
    if (estado == SIRVIENDO) {
      pulsosServidos = caudalPulsos() - pulsosBase;
      if (pulsosServidos >= pulsosMax) {
        valvulaCerrar();
        Serial.println(">> Limite de saldo alcanzado. Corta.");
        irA(LISTO);
      }
    }

    tarjetaActualizar(ahora);

    // ── EL INVARIANTE ─────────────────────────────────────────────────────
    // Si no estamos sirviendo, la válvula se cierra. Cada vuelta, sin
    // excepciones, antes de cualquier otra lógica.
    if (estado != SIRVIENDO) valvulaCerrar();

    digitalWrite(PIN_LED, tarjetaPresente() ? HIGH : LOW);

    // ── Respuestas que llegan tarde ────────────────────────────────────────
    // Si el cliente retiró la tarjeta mientras autorizábamos, la respuesta
    // llega igual y del otro lado quedó una sesión abierta. Se cierra en cero.
    //
    // Sin esto, esa tarjeta queda "en sesión" hasta que el barrido de
    // abandonadas la limpie, y mientras tanto el cliente no puede servirse en
    // otra canilla.
    if (estado != AUTORIZANDO) {
      RespuestaAbrir tardia;
      while (xQueueReceive(colaRespuestaAbrir, &tardia, 0) == pdTRUE) {
        if (tardia.ok) {
          Serial.println("[control] respuesta tardia: cerrando la sesion en cero");
          encolarCierre(tardia.sesionId, 0, 0);
        }
      }
    }

    switch (estado) {

      case ESPERANDO: {
        if (!tarjetaPresente()) break;
        strncpy(uidSesion, tarjetaUid(), sizeof(uidSesion) - 1);
        uidSesion[sizeof(uidSesion) - 1] = '\0';

        if (colaLlena()) {
          // No autorizamos si no podríamos anotar el cierre. Es preferible que
          // la canilla no sirva a que sirva sin poder cobrar.
          Serial.println("Cola de cierres llena: no se autoriza nada hasta vaciarla.");
          irA(RECHAZADO);
          break;
        }

        PedidoAbrir p;
        strncpy(p.uid, uidSesion, sizeof(p.uid));
        p.pedidoEn = ahora;
        xQueueSend(colaPedidoAbrir, &p, 0);
        pidioAutorizarEn = ahora;
        ausenteDesde = 0;
        irA(AUTORIZANDO);
        break;
      }

      case AUTORIZANDO: {
        RespuestaAbrir r;
        if (xQueueReceive(colaRespuestaAbrir, &r, 0) == pdTRUE) {
          if (!r.ok) {
            Serial.printf("Rechazada: %s\n", r.motivo);
            irA(RECHAZADO);
            break;
          }
          sesionId            = r.sesionId;
          pulsosPorLitroMili  = r.pulsosPorLitroMili;
          precioLitroCentavos = r.precioLitroCentavos;
          saldoCentavos       = r.saldoCentavos;

          // El límite se convierte a PULSOS acá y no se vuelve a tocar. De acá
          // en adelante el corte no consulta nada: compara dos enteros.
          pulsosMax      = pulsosDeMl(r.mlMaximos, pulsosPorLitroMili);
          pulsosBase     = caudalPulsos();
          pulsosServidos = 0;
          pulsosPrevios  = 0;

          char s[24];
          formatearPesos(saldoCentavos, s, sizeof(s));
          Serial.printf("Tarjeta %s | saldo %s | hasta %lu ml (%lu pulsos)\n",
                        uidSesion, s, (unsigned long)r.mlMaximos,
                        (unsigned long)pulsosMax);
          Serial.println("Apreta el boton para servir.");
          irA(LISTO);
          break;
        }

        if (!tarjetaPresente()) {
          if (ausenteDesde == 0) ausenteDesde = ahora;
          if (ahora - ausenteDesde >= GRACIA_AUSENCIA_MS) {
            Serial.println("Se retiro la tarjeta antes de autorizar.");
            irA(ESPERANDO);
            break;
          }
        } else if (strcmp(tarjetaUid(), uidSesion) != 0) {
          // Volvió, pero es OTRA tarjeta. La respuesta que venga es para la
          // anterior: se sale y que la nueva pida lo suyo desde cero.
          Serial.println("Cambio la tarjeta durante la autorizacion.");
          irA(ESPERANDO);
          break;
        } else {
          ausenteDesde = 0;
        }

        if (ahora - pidioAutorizarEn > TIMEOUT_AUTORIZAR) {
          if (!redConectada()) Serial.println("Sin WiFi. La canilla no puede autorizar.");
          else                 Serial.println("Sin respuesta del servidor. Revisa el WiFi.");
          irA(RECHAZADO);
        }
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
        if (pulsos != pulsosPrevios) { pulsosPrevios = pulsos; ultimoPulsoMs = ahora; }

        // El corte local ya se evaluó arriba, al principio de la vuelta.
        // Todo corte se explica. La primera versión salía de SIRVIENDO sin
        // decir por qué en dos de los casos, y averiguarlo costó tres rondas de
        // pruebas mirando el reloj del log.
        //
        //   Un estado que cambia sin dejar dicho el motivo es un estado que hay
        //   que reproducir para entender.
        if (!botonApretado()) {
          valvulaCerrar();
          Serial.println(">> Solto el boton. Corta.");
          irA(LISTO);
          break;
        }
        if (!tarjetaPresente()) {
          valvulaCerrar();
          Serial.println(">> Retiro la tarjeta mientras servia. Cierra y cobra.");
          irA(LIQUIDANDO);
          break;
        }

        if (ahora - valvulaAbiertaDesde() > MAX_APERTURA_MS) {
          valvulaCerrar();
          Serial.println("!! FAILSAFE: 90 s abierta. Corta.");
          irA(LISTO);
          break;
        }
        if (ahora - ultimoPulsoMs > SIN_PULSOS_MS) {
          valvulaCerrar();
          Serial.println("!! FAILSAFE: abierta sin pulsos. Corta.");
          irA(LISTO);
          break;
        }

        if (ahora - ultimoInforme >= PROGRESO_MS) {
          ultimoInforme = ahora;
          uint32_t ml = mlDePulsos(pulsos, pulsosPorLitroMili);

          Serial.printf("   sirviendo... %lu ml  (%lu/%lu pulsos)\n",
                        (unsigned long)ml, (unsigned long)pulsos,
                        (unsigned long)pulsosMax);

          // Se deja la foto y se sigue. No se espera respuesta ni se reintenta:
          // la tarea de control no se detiene por un adorno.
          Progreso p = { sesionId, ml, pulsos };
          xQueueOverwrite(colaProgreso, &p);
        }
        break;
      }

      case LIQUIDANDO: {
        uint32_t ml = mlDePulsos(pulsosServidos, pulsosPorLitroMili);

        // Primero la flash, después el ticket. Si se corta la luz justo acá, lo
        // que tiene que haber sobrevivido es el cobro, no el papelito.
        encolarCierre(sesionId, ml, pulsosServidos);
        imprimirTicket(ml, pulsosServidos);

        uidSesion[0]   = '\0';
        sesionId       = 0;
        pulsosServidos = 0;
        pulsosMax      = 0;
        irA(ESPERANDO);
        break;
      }

      case RECHAZADO: {
        if (!tarjetaPresente()) { uidSesion[0] = '\0'; irA(ESPERANDO); }
        break;
      }
    }

    vTaskDelay(pdMS_TO_TICKS(5));
  }
}


void setup() {
  // Antes que nada. Si algo de lo que viene después se cuelga, la canilla ya
  // quedó cerrada.
  valvulaIniciar();

  Serial.begin(115200);
  delay(300);

  pinMode(PIN_BOTON, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  Serial.println();
  Serial.println("=============================================");
  Serial.println(" GRIFO DE CERVEZA - ETAPA 6: SUPABASE + COLA");
  Serial.println("=============================================");
  Serial.printf("Canilla           : %d\n", GRIFO_ID);

  colaIniciar();
  uint32_t pendientes = colaCantidad();
  if (pendientes > 0) {
    Serial.printf("Cierres pendientes: %lu (de antes del reset)\n",
                  (unsigned long)pendientes);
    Serial.println("Se van a entregar solos en cuanto haya red.");
  } else {
    Serial.println("Cierres pendientes: ninguno");
  }

  caudalIniciar(true);
  if (!tarjetaIniciar()) {
    Serial.println("!! El lector RFID no contesta. Revisar SPI y que este a 3.3V.");
  }

  // El watchdog se configura ANTES de crear las tareas, porque cada una se
  // anota sola al arrancar.
  // Se mira el resultado, no se supone. El nucleo de Arduino ya inicializa el
  // watchdog al arrancar, y volver a inicializarlo devuelve un error que es
  // facil ignorar: ahi el timeout queda en el del sistema, no en el nuestro, y
  // el banner diria 30 s mientras el chip usa otro.
  //
  //   Pedir la configuracion y no chequear el resultado es como leer el log que
  //   uno mismo escribio en vez del que escribio el sistema.
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t cfgWdt = {
    .timeout_ms     = WATCHDOG_S * 1000,
    .idle_core_mask = 0,
    .trigger_panic  = true,
  };
  esp_err_t rWdt = esp_task_wdt_init(&cfgWdt);
#else
  esp_err_t rWdt = esp_task_wdt_init(WATCHDOG_S, true);
#endif
  if (rWdt == ESP_OK) {
    Serial.printf("Watchdog          : %lu s\n", (unsigned long)WATCHDOG_S);
  } else {
    Serial.println("Watchdog          : ya venia configurado por el sistema");
    Serial.println("                    (el timeout es el del nucleo, no el nuestro)");
  }

  colaPedidoAbrir    = xQueueCreate(2, sizeof(PedidoAbrir));
  colaRespuestaAbrir = xQueueCreate(2, sizeof(RespuestaAbrir));
  colaProgreso       = xQueueCreate(1, sizeof(Progreso));

  // Núcleos distintos y prioridades distintas. El control gana siempre.
  xTaskCreatePinnedToCore(tareaRed,     "red",     8192, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(tareaControl, "control", 8192, NULL, 3, NULL, 1);

  Serial.println("---------------------------------------------");
  Serial.println();
}

void loop() {
  // Vacío a propósito: todo corre en las dos tareas. `loop()` es la tarea
  // Arduino por defecto y no tiene nada que hacer acá.
  vTaskDelay(pdMS_TO_TICKS(1000));
}
