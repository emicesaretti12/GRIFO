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
#include "../nube/cola.h"
#include "../nube/red.h"
#include "../nube/ajustes.h"
#include "../nube/secrets.h"

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
// Sin canal de push, el intervalo del latido ES la latencia de una orden: si
// preguntamos cada minuto, "reiniciate" puede tardar un minuto en llegar.
// Treinta segundos es el punto donde la espera todavía se tolera parado frente
// a la canilla y el tráfico sigue siendo nada (2.880 pedidos por día).
//
//   Es elegir el intervalo del polling por la latencia que querés, no por lo
//   que parece prolijo.
static const uint32_t LATIDO_MS = 30000;

// Lo pone el setup leyendo el botón, lo consume la tarea de red. Una sola
// escritura antes de que arranquen las tareas, así que no necesita candado.
static bool pidieronPortal = false;

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
// ── Con botón o sin botón ───────────────────────────────────────────────────
// `true`  — la válvula abre sola mientras la tarjeta esté apoyada, y cierra al
//           retirarla. Un solo gesto: apoyar y sacar.
// `false` — hay que mantener el botón apretado para que salga. La tarjeta
//           autoriza, el botón sirve.
//
// Lo que se gana sin botón es que no hay nada que aprender: el cliente apoya la
// tarjeta y sale cerveza.
//
// Lo que se pierde es el segundo consentimiento. Con botón, para que salga
// líquido hacen falta **dos** acciones deliberadas; sin botón, una tarjeta
// apoyada de casualidad —o apoyada y olvidada— abre la canilla igual.
//
// El único freno que queda entonces es el límite de saldo y los 90 s de
// apertura máxima. Eso es una decisión de negocio, no técnica, y por eso queda
// acá arriba en una sola línea en vez de repartida por la máquina de estados.
//
//   Es el `confirm()` antes de la acción destructiva. Sacarlo hace la interfaz
//   más rápida, y también más fácil de disparar sin querer.
static const bool ABRIR_CON_LA_TARJETA = true;

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

// ── Las órdenes bajan por acá, y no se aplican donde llegan ─────────────────
// La tarea de red recibe la orden pero NO la ejecuta. La deja acá, y la tarea
// de control la levanta solo cuando está en ESPERANDO.
//
// Es la regla que importa: "reiniciate" en medio de un servicio corta la
// cerveza y pierde la venta, porque el cierre recién se guarda al liquidar.
// Una orden nunca puede interrumpir algo que ya está cobrando.
//
//   Es aplicar la migración entre requests y no arriba de uno a medio
//   ejecutar. El momento correcto no es "cuando llega": es "cuando no hay
//   nada en vuelo".
static QueueHandle_t colaOrden;

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
  if (pidieronPortal) {
    redAbrirPortal();
  } else {
    uint32_t esperandoDesde = millis();
    while (!redConectada() && redHayWifiGuardado() &&
           millis() - esperandoDesde < 20000) {
      esp_task_wdt_reset();
      redMantener();
      vTaskDelay(pdMS_TO_TICKS(200));
    }
    redMantener();
    esp_task_wdt_reset();

    // Si no conectó, acá adentro se decide: volver a la red anterior (y
    // reiniciar) o levantar el portal.
    if (redResolverArranque()) redCalentar(colaCantidad());
  }

  // Ya se mandó uno recién; el próximo va dentro de un minuto y no ahora mismo.
  uint32_t ultimoLatido = millis();

  for (;;) {
    esp_task_wdt_reset();

    // ── Con el portal arriba no hay internet, y no hay nada que mandar ───────
    // La canilla es su propio router: no es cliente de ninguna red. Intentar
    // autorizar o cobrar en ese estado solo gastaría tiempo para fallar.
    //
    // La tarea de control sigue corriendo igual en el otro núcleo, y la válvula
    // sigue cerrándose en cada vuelta. El portal no relaja ninguna seguridad.
    if (redEnPortal()) {
      redAtenderPortal();
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

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
      Orden orden;
      if (redLatido(colaCantidad(), orden) && orden.id > 0) {
        // No se aplica acá. La tarea de red no toca la canilla: deja la orden
        // donde el control la va a levantar cuando esté en un momento seguro.
        xQueueOverwrite(colaOrden, &orden);
      }
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


/** Ejecuta una orden que bajó del servidor. Se llama SOLO desde ESPERANDO. */
static void aplicarOrden(const Orden &o) {
  Serial.printf("\n>> ORDEN #%lld: %s\n", (long long)o.id, o.tipo);

  // ── La marca se anota ANTES de ejecutar, y esto no es negociable ──────────
  // Las tres órdenes terminan en un reinicio. Si la marca se anotara después,
  // no llegaría a anotarse nunca: la placa se reinicia, el latido siguiente
  // pide órdenes desde el mismo número, el servidor devuelve la misma, y la
  // canilla se reinicia otra vez. Para siempre.
  //
  //   Es commitear el offset antes de procesar. Al revés, un mensaje que mata
  //   al worker se reintenta eternamente: la cola de veneno.
  //
  // El precio de hacerlo así es que una orden podría darse por hecha sin
  // haberse ejecutado. Para estas tres el precio es barato: se vuelve a mandar
  // desde la app. Un reinicio en bucle, en cambio, no se arregla solo.
  ajustesGuardarUltimaOrden(o.id);

  if (strcmp(o.tipo, "wifi") == 0) {
    if (!ajustesGuardarWifi(o.ssid, o.pass)) {
      Serial.println("   no se pudo guardar. Se ignora la orden.");
      return;
    }
    Serial.printf("   red nueva a prueba: \"%s\"\n", o.ssid);
    Serial.println("   Si no conecta, vuelve sola a la anterior.");
  } else if (strcmp(o.tipo, "olvidar_wifi") == 0) {
    ajustesOlvidarWifi();
    Serial.println("   al reiniciar va a levantar el portal.");
  } else if (strcmp(o.tipo, "reiniciar") != 0) {
    Serial.println("   tipo desconocido (firmware viejo?). Se ignora.");
    return;
  }

  Serial.println(">> Reiniciando...");
  Serial.flush();
  valvulaCerrar();      // por las dudas, aunque en ESPERANDO ya esté cerrada
  delay(300);
  ESP.restart();
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
// ── El checkpoint que sobrevive al reinicio ─────────────────────────────────
// Sin el diodo de la válvula, cada cierre puede meter un pico que resetea la
// placa. Evitarlo es hardware. Lo que sí se puede hacer por software es que ese
// reinicio **no cueste plata**.
//
// Estas variables viven en la RTC RAM: una memoria que NO se borra al
// reiniciarse el chip, pero sí al cortarse la alimentación. Un reset por el
// pico de la bobina es exactamente el primer caso — la placa arranca de nuevo,
// no se apaga.
//
// Mientras sirve, acá queda anotado cuánto lleva servido. Si se reinicia a
// mitad, el arranque encuentra la venta a medias y la encola para cobrar antes
// de hacer cualquier otra cosa.
//
//   Es el checkpoint del job largo. No evita que el worker se muera; evita que
//   se pierda lo que ya había hecho.
//
// Y es gratis: es RAM, no flash. Escribirla en cada vuelta no la desgasta. Un
// checkpoint en NVS a un escritura por segundo quemaría el sector en una
// semana de bar.
//
// `RTC_NOINIT_ATTR` significa que nadie las inicializa al arrancar: en un
// encendido en frío traen basura. Por eso hace falta la firma.
#define FIRMA_VENTA 0x47524946u   // "GRIF"

RTC_NOINIT_ATTR static uint32_t rtcFirma;
RTC_NOINIT_ATTR static int64_t  rtcSesion;
RTC_NOINIT_ATTR static uint32_t rtcPulsos;
RTC_NOINIT_ATTR static uint32_t rtcPplMili;

/** Deja anotada la venta en curso. Se llama seguido y no cuesta nada. */
static void anotarVenta(int64_t id, uint32_t pulsos, uint32_t pplMili) {
  rtcFirma   = FIRMA_VENTA;
  rtcSesion  = id;
  rtcPulsos  = pulsos;
  rtcPplMili = pplMili;
}

/** La venta terminó bien: ya no hay nada que recuperar. */
static void olvidarVenta() { rtcFirma = 0; }

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
        // Acá y en ningún otro lado: sin tarjeta, sin sesión y con la válvula
        // cerrada es el único momento en que reiniciar no le cuesta nada a
        // nadie.
        Orden orden;
        if (xQueueReceive(colaOrden, &orden, 0) == pdTRUE) {
          aplicarOrden(orden);
          break;
        }

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
          anotarVenta(sesionId, 0, pulsosPorLitroMili);

          if (ABRIR_CON_LA_TARJETA) {
            Serial.println("Sirviendo. Retira la tarjeta para cortar.");
            valvulaAbrir();
            ultimoPulsoMs = ahora;
            ultimoInforme = ahora;
            irA(SIRVIENDO);
          } else {
            Serial.println("Apreta el boton para servir.");
            irA(LISTO);
          }
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
          if (redEnPortal())        Serial.println("Portal de configuracion abierto: no se vende hasta reiniciar.");
          else if (!redConectada())  Serial.println("Sin WiFi. La canilla no puede autorizar.");
          else                 Serial.println("Sin respuesta del servidor. Revisa el WiFi.");
          irA(RECHAZADO);
        }
        break;
      }

      case LISTO: {
        if (!tarjetaPresente()) { irA(LIQUIDANDO); break; }

        // Sin botón, a LISTO solo se llega después de un corte: el límite, los
        // 90 s, o la falta de pulsos. En ninguno de esos casos conviene volver
        // a abrir sola.
        //
        // Si volviera a abrir al instante, un barril vacío daría un ciclo de
        // abrir-cerrar sin fin, y los 90 s de apertura máxima dejarían de ser
        // un tope: serían el período de un oscilador.
        //
        // Así que se queda cerrada y espera. Para seguir, el cliente retira la
        // tarjeta y la vuelve a apoyar — un gesto deliberado, igual que el
        // primero.
        //
        //   Es no reintentar solo después de que saltó el disyuntor. Alguien
        //   tiene que mirar qué pasó antes de volver a dar corriente.
        if (ABRIR_CON_LA_TARJETA) break;

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
          // Se anota en cuanto cambia, no cada tanto: lo que importa es que el
          // último valor guardado sea el último medido. Si el pico llega justo
          // acá, lo peor que se pierde es un pulso.
          anotarVenta(sesionId, pulsos, pulsosPorLitroMili);
        }

        // El corte local ya se evaluó arriba, al principio de la vuelta.
        // Todo corte se explica. La primera versión salía de SIRVIENDO sin
        // decir por qué en dos de los casos, y averiguarlo costó tres rondas de
        // pruebas mirando el reloj del log.
        //
        //   Un estado que cambia sin dejar dicho el motivo es un estado que hay
        //   que reproducir para entender.
        if (!ABRIR_CON_LA_TARJETA && !botonApretado()) {
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
          if (ABRIR_CON_LA_TARJETA) Serial.println("   Retira y volve a apoyar la tarjeta para seguir.");
          irA(LISTO);
          break;
        }
        if (ahora - ultimoPulsoMs > SIN_PULSOS_MS) {
          valvulaCerrar();
          Serial.println("!! FAILSAFE: abierta sin pulsos. Corta.");
          if (ABRIR_CON_LA_TARJETA) Serial.println("   No llego liquido. Revisa el barril o la manguera.");
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
        olvidarVenta();      // ya está a salvo en la cola: no hay qué recuperar
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

  // ── El botón apretado durante el arranque pide el portal ──────────────────
  // Es la única entrada física que tiene la canilla, así que hace de "modo
  // recovery". El día que el bar cambie la clave del WiFi, esto es lo que evita
  // tener que ir con una notebook a reflashear.
  //
  // Tres segundos a propósito: lo suficiente para que no pase por accidente al
  // enchufar, y el LED parpadea mientras tanto para que se vea que cuenta.
  //
  //   Es el arranque en modo seguro. Una combinación incómoda a propósito, que
  //   está siempre disponible aunque todo lo demás falle.
  pidieronPortal = false;
  if (digitalRead(PIN_BOTON) == LOW) {
    Serial.println("Boton apretado. Solta antes de 3 s para arrancar normal...");
    uint32_t desde = millis();
    while (digitalRead(PIN_BOTON) == LOW && millis() - desde < 3000) {
      digitalWrite(PIN_LED, ((millis() - desde) / 150) % 2);
      delay(20);
    }
    digitalWrite(PIN_LED, LOW);

    // ── Y ahora hay que esperar a que lo SUELTE ───────────────────────────
    // Un botón apretado al arrancar no prueba que haya alguien: el "botón" de
    // este banco de pruebas es un cable metido en un hueco, y si quedó puesto
    // la placa lee "apretado" para siempre.
    //
    // Eso armaba un bucle: la válvula al cerrar reseteaba la placa, la placa
    // arrancaba con el cable puesto, entraba al portal, y en el portal no se
    // vende. Cada reinicio la hundía más.
    //
    // Lo que distingue a una persona de un contacto trabado no es que apriete:
    // es que **suelta**. Así que el portal se confirma recién cuando suelta.
    //
    //   Es exigir el flanco y no el nivel. Un nivel puede quedar clavado por
    //   una falla; una transición hay que producirla.
    if (digitalRead(PIN_BOTON) == LOW) {
      Serial.println("Solta el boton para entrar al portal...");
      uint32_t espera = millis();
      while (digitalRead(PIN_BOTON) == LOW && millis() - espera < 10000) {
        delay(20);
      }
      if (digitalRead(PIN_BOTON) == LOW) {
        Serial.println("!! El boton quedo apretado solo. Se ignora y arranca normal.");
        Serial.println("!! Si es el cable de pruebas, sacalo del hueco J51.");
      } else {
        pidieronPortal = true;
        Serial.println(">> PORTAL DE CONFIGURACION pedido a mano.");
      }
    }
  }

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

  // ── Rescatar una venta que quedó a mitad ─────────────────────────────────
  // Va DESPUÉS de colaIniciar y ANTES de todo lo demás: si la placa se reinició
  // sirviendo, lo primero que tiene que pasar es que esa cerveza quede
  // registrada. Todo lo otro puede esperar.
  if (rtcFirma == FIRMA_VENTA && rtcSesion > 0) {
    uint32_t ml = mlDePulsos(rtcPulsos, rtcPplMili);
    Serial.println();
    Serial.println("!! Se reinicio con una venta a medias. Rescatando:");
    Serial.printf("!!   sesion %lld -- %lu ml (%lu pulsos)\n",
                  (long long)rtcSesion, (unsigned long)ml,
                  (unsigned long)rtcPulsos);
    encolarCierre(rtcSesion, ml, rtcPulsos);
    olvidarVenta();
    Serial.println("!! Queda en la cola. Se cobra en cuanto haya red.");
    Serial.println();
  } else {
    // Basura de un encendido en frio, o nada pendiente. En los dos casos, a
    // cero: no queremos rescatar una venta inventada por la memoria sucia.
    olvidarVenta();
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

  // Longitud 1 y se pisa: si llegaron dos órdenes antes de poder aplicar
  // ninguna, la que vale es la última. El servidor igual vuelve a mandar lo que
  // quede pendiente, porque la marca de agua no avanzó.
  colaOrden          = xQueueCreate(1, sizeof(Orden));

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
