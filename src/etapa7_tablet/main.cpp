// ═════════════════════════════════════════════════════════════════════════════
// GRIFO DE CERVEZA — ETAPA 7: LA TARJETA LA LEE LA TABLET
//
// El ESP32 deja de ver al cliente. La tablet lo identifica por NFC, abre la
// sesión en Supabase, y la canilla se entera **sondeando**.
//
// Se caen el lector RFID y el botón. Queda un actuador con un medidor.
//
// ── Lo que NO cambia, y no es negociable ────────────────────────────────────
// El corte lo sigue decidiendo esta placa comparando dos enteros. La sesión
// llega con su límite, se convierte a pulsos una sola vez, y de ahí en adelante
// no se consulta a nadie. Si se cae la red a mitad de un servicio, corta igual.
//
//   Es validar del lado del servidor aunque el formulario ya haya validado. El
//   que ejecuta la acción es el que tiene que poder decir no.
//
// ── Las dos tareas, igual que antes ─────────────────────────────────────────
//   tareaControl  núcleo 1, prioridad alta  → pulsos y válvula. Nunca la red.
//   tareaRed      núcleo 0, prioridad baja  → sondeo, cobros, latido, portal
//
// Ver docs/rediseno-tablet.md
// ═════════════════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include <string.h>
#include <esp_task_wdt.h>
#include "../comun/dinero.h"
#include "../comun/valvula.h"
#include "../comun/caudal.h"
#include "../nube/cola.h"
#include "../nube/red.h"
#include "../nube/ajustes.h"
#include "../nube/secrets.h"

// ── Pines ───────────────────────────────────────────────────────────────────
// El botón ya no sirve para servir. Queda conectado porque al arrancar es lo
// único que puede pedir el portal de WiFi: la canilla no tiene otra entrada
// física.
static const int PIN_BOTON = 14;
static const int PIN_LED   = 2;

// ── Los plazos ──────────────────────────────────────────────────────────────
// Los tres miden lo mismo —"no llegan pulsos"— y significan cosas distintas
// según el momento. Un solo número para los tres sería o demasiado corto para
// llegar caminando al grifo, o demasiado largo para cerrar.
//
//   Es el timeout de conexión contra el de inactividad. Miden distinto y no
//   pueden compartir número.
static const uint32_t ESPERA_PRIMER_PULSO_MS = 30000;  // caminar y abrir el grifo
static const uint32_t FIN_DE_SERVICIO_MS     =  3000;  // dejó de correr: empieza la espera

// ── La espera: por qué la válvula NO se cierra mientras tanto ───────────────
// Hubo una versión que cerraba a los 3 s y después "se asomaba" 200 ms cada
// tanto para ver si el cliente había vuelto a abrir el grifo. No funcionó, y el
// motivo es de fondo: **el asomo se detectaba a sí mismo**. Al abrir, la
// turbina daba un tic aunque el grifo estuviera cerrado, el firmware lo leía
// como "volvió el cliente", y arrancaba un ciclo de abrir-cerrar sin fin.
//
//   El mecanismo que sirve para medir no puede ser el mismo que perturba lo
//   medido. Cuando lo es, lo que leés es tu propia influencia.
//
// Dejando la válvula abierta no hay nada que preguntar: el cliente abre el
// grifo y sale cerveza, los pulsos aparecen solos. Y es seguro por una razón
// concreta: la ÚNICA forma de entrar en la espera es que el grifo esté cerrado,
// y una válvula abierta contra un grifo cerrado no entrega una gota.
//
// ── Y acá va lo que la hace inteligente ─────────────────────────────────────
// Una pausa de cuatro segundos es alguien mirando cómo baja la espuma. Una de
// treinta es alguien que se fue. El problema es que el primer segundo de las
// dos es idéntico.
//
// Lo que las distingue no es la pausa: es lo que hizo ANTES. Un cliente que ya
// paró y volvió dos veces está sirviéndose en tandas, y va a volver otra vez.
// Uno que paró por primera vez, capaz terminó.
//
// Así que la espera crece con cada vuelta: empieza en 7 s y suma 3 por cada
// pausa que el cliente ya demostró que era pausa y no final.
//
//   Es el backoff al revés. En vez de castigar los reintentos, premia al que
//   ya demostró que vuelve. El sistema aprende el ritmo de esta persona, en
//   esta tirada, sin saber nada de ella.
static const uint32_t GRACIA_BASE = 7000;
static const uint32_t GRACIA_PASO = 3000;
static const uint32_t GRACIA_MAX  = 16000;

// Failsafe de apertura: una válvula abierta un minto y medio seguido no es un
// cliente sirviéndose, es algo trabado.
// El tope de apertura ya no mide "cuánto sirvió": con la espera, la válvula
// queda abierta entre tandas y una tirada larga con pausas lo pasaría de largo.
// Mide lo que tiene que medir: que algo quedó trabado abierto.
static const uint32_t MAX_APERTURA_MS = 180000;

// Cada cuánto le pregunta al servidor si tiene alguien esperando. Un segundo,
// no treinta: el cliente ya apoyó la tarjeta y está caminando hacia el grifo.
static const uint32_t SONDEO_SESION_MS = 1000;

static const uint32_t LATIDO_MS   = 30000;
static const uint32_t PROGRESO_MS =  1000;
static const uint32_t WATCHDOG_S  = 30;


// ═════════════════════════════════════════════════════════════════════════════
// LO QUE VIAJA ENTRE LAS DOS TAREAS
// ═════════════════════════════════════════════════════════════════════════════
struct Progreso { int64_t sesionId; uint32_t ml; uint32_t pulsos; };

static QueueHandle_t colaSesion   = NULL;   // red → control: alguien esperando
static QueueHandle_t colaProgreso = NULL;   // control → red: la foto del vaso
static QueueHandle_t colaOrden    = NULL;   // red → control: reiniciar, wifi...

// Lo escribe el control, lo lee la red. Un solo escritor y un solo lector sobre
// un bool alineado: no hace falta candado.
//
// Sin esto la red seguiría sondeando mientras el cliente se sirve — una
// petición por segundo que nadie va a mirar, ocupando la única conexión que hay.
static volatile bool canillaLibre = true;


// ═════════════════════════════════════════════════════════════════════════════
// EL CHECKPOINT QUE SOBREVIVE AL REINICIO
// ═════════════════════════════════════════════════════════════════════════════
// Sin diodo en la válvula, cada cierre puede meter un pico que resetea la
// placa. Evitarlo es hardware. Que no cueste plata, se puede por software.
//
// La RTC RAM no se borra al reiniciarse el chip, solo al cortarse la
// alimentación — y un reset por el pico de la bobina es exactamente el primer
// caso.
//
//   Es el checkpoint del job largo. No evita que el worker se muera; evita que
//   se pierda lo que ya había hecho.
#define FIRMA_VENTA 0x47524946u   // "GRIF"

RTC_NOINIT_ATTR static uint32_t rtcFirma;
RTC_NOINIT_ATTR static int64_t  rtcSesion;
RTC_NOINIT_ATTR static uint32_t rtcPulsos;
RTC_NOINIT_ATTR static uint32_t rtcPplMili;

static void anotarVenta(int64_t id, uint32_t pulsos, uint32_t pplMili) {
  rtcFirma = FIRMA_VENTA; rtcSesion = id; rtcPulsos = pulsos; rtcPplMili = pplMili;
}
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


// ═════════════════════════════════════════════════════════════════════════════
// TAREA DE RED — núcleo 0
// ═════════════════════════════════════════════════════════════════════════════
// ── Dónde está parada la canilla, y qué fue lo último que le pasó ───────────
// Va acá arriba y no junto al resto del control porque **la tarea de red lo
// necesita**: son los dos campos que el latido le manda a la app, y que en el
// bar hacen de monitor serie para quien tiene un celular y nada más.
enum Estado { ESPERANDO, HABILITADO, SIRVIENDO, LIQUIDANDO };

static const char *nombreDe(Estado e) {
  switch (e) {
    case ESPERANDO:  return "ESPERANDO";
    case HABILITADO: return "HABILITADO";
    case SIRVIENDO:  return "SIRVIENDO";
    case LIQUIDANDO: return "LIQUIDANDO";
  }
  return "?";
}

static Estado estado = ESPERANDO;
static char   ultimoEvento[72] = "recien encendida";

static void anotar(const char *e) {
  snprintf(ultimoEvento, sizeof(ultimoEvento), "%s", e);
}

static void aplicarOrden(const Orden &o);   // se ejecuta desde el control

// La pone el setup leyendo el botón, la consume la tarea de red. Una sola
// escritura antes de que arranquen las tareas: no necesita candado.
static bool pidieronPortal = false;

static void tareaRed(void *) {
  esp_task_wdt_add(NULL);
  redIniciar();

  if (pidieronPortal) {
    redAbrirPortal();
  } else {
    uint32_t desde = millis();
    while (!redConectada() && redHayWifiGuardado() && millis() - desde < 20000) {
      esp_task_wdt_reset();
      redMantener();
      vTaskDelay(pdMS_TO_TICKS(200));
    }
    redMantener();
    esp_task_wdt_reset();
    if (redResolverArranque()) redCalentar(colaCantidad());
  }

  uint32_t ultimoLatido = millis();
  uint32_t ultimoSondeo = 0;

  for (;;) {
    esp_task_wdt_reset();

    // Con el portal arriba la canilla es su propio router: no hay internet y no
    // hay nada que mandar. El control sigue corriendo en el otro núcleo y la
    // válvula sigue cerrándose en cada vuelta.
    if (redEnPortal()) {
      redAtenderPortal();
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }

    redMantener();
    uint32_t ahora = millis();
    bool hiceAlgoCaro = false;

    // ── 1) ¿Hay alguien esperando? ────────────────────────────────────────
    // Primero de todo y lo más seguido: es lo único que tiene a una persona
    // parada del otro lado.
    //
    // Solo mientras la canilla está libre. Preguntar mientras alguien se sirve
    // sería una petición por segundo que nadie va a mirar.
    if (canillaLibre && redConectada() && ahora - ultimoSondeo >= SONDEO_SESION_MS) {
      ultimoSondeo = ahora;
      SesionNube s;
      if (redSesionActiva(s) && s.hay) {
        // La marca de agua: si ya liquidamos esa sesión y el cierre todavía no
        // salió de la cola, el servidor la sigue viendo abierta. Sin esto, la
        // válvula se abriría de nuevo para una venta ya cobrada.
        if (s.id > ajustesUltimaSesion()) {
          xQueueOverwrite(colaSesion, &s);
        }
      }
      hiceAlgoCaro = true;
    }

    // ── 2) Los cierres, de a uno y en orden ───────────────────────────────
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

    // ── 3) El latido ──────────────────────────────────────────────────────
    if (redConectada() && !hiceAlgoCaro && ahora - ultimoLatido >= LATIDO_MS) {
      ultimoLatido = ahora;
      Orden orden;
      if (redLatido(colaCantidad(), orden, nombreDe(estado), ultimoEvento) &&
          orden.id > 0) {
        xQueueOverwrite(colaOrden, &orden);
      }
      hiceAlgoCaro = true;
    }

    // ── 4) El progreso de la pantalla, último ─────────────────────────────
    Progreso prog;
    if (!hiceAlgoCaro && xQueueReceive(colaProgreso, &prog, 0) == pdTRUE) {
      redReportarProgreso(prog.sesionId, prog.ml, prog.pulsos);
    }

    vTaskDelay(pdMS_TO_TICKS(50));
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// TAREA DE CONTROL — núcleo 1
// ═════════════════════════════════════════════════════════════════════════════
static int64_t  sesionId = 0;
static char     uidSesion[21] = "";
static char     cliente[41] = "";
static uint32_t pulsosMax = 0;
static uint32_t pulsosPorLitroMili = 452700;
static uint32_t precioLitroCentavos = 0;
static uint32_t saldoCentavos = 0;
static uint32_t pulsosBase = 0;
static uint32_t pulsosServidos = 0;
static uint32_t pulsosPrevios = 0;
static uint32_t ultimoPulsoMs = 0;
static uint32_t ultimoInforme = 0;
static uint32_t habilitadaEn = 0;
static uint8_t  pausasCumplidas = 0;   // cuántas veces paró y volvió
static bool     enEspera = false;      // dejó de correr, pero todavía no terminó

/** Cuánto se le espera a este cliente ahora mismo. Crece con cada pausa que él
 *  mismo demostró que era pausa. */
static uint32_t graciaActual() {
  uint32_t g = GRACIA_BASE + (uint32_t)GRACIA_PASO * pausasCumplidas;
  return g > GRACIA_MAX ? GRACIA_MAX : g;
}

static void irA(Estado nuevo) {
  if (nuevo == estado) return;
  Serial.printf("[%7lu ms] %s -> %s\n", (unsigned long)millis(),
                nombreDe(estado), nombreDe(nuevo));
  estado = nuevo;
  canillaLibre = (nuevo == ESPERANDO);
}

/** Abre sin pisar la hora de apertura. `valvulaAbrir()` reinicia el reloj del
 *  failsafe cada vez que se llama; llamarla en cada vuelta lo volvería inútil. */
static void abrirSiHaceFalta() {
  if (valvulaAbiertaDesde() == 0) valvulaAbrir();
}

static void imprimirTicket(uint32_t ml, uint32_t pulsos) {
  // El cobro de verdad lo hace el servidor; esto es una estimación local. Se
  // calcula desde los **ml** y no desde los pulsos, con la misma cuenta que usa
  // el servidor: pasar la calibración a pulsos por litro enteros perdería el
  // decimal (452.700 -> 452) y el ticket diferiría de la app por más que unos
  // centavos.
  Centavos estimado = (Centavos)(((uint64_t)ml * precioLitroCentavos + 999) / 1000);
  char plata[24];
  formatearPesos(estimado, plata, sizeof(plata));

  Serial.println();
  Serial.println("================ TICKET ================");
  Serial.printf(" Cliente   : %s\n", cliente[0] ? cliente : uidSesion);
  Serial.printf(" Servido   : %lu ml  (%lu pulsos)\n",
                (unsigned long)ml, (unsigned long)pulsos);
  Serial.printf(" Estimado  : %s   (lo definitivo lo calcula Supabase)\n", plata);
  if (pulsosMax > 0 && pulsos > pulsosMax) {
    Serial.printf(" !! EXCESO : %lu pulsos de mas sobre %lu autorizados\n",
                  (unsigned long)(pulsos - pulsosMax), (unsigned long)pulsosMax);
    Serial.println("              El servidor recorta el cobro al saldo.");
  }
  if (!redConectada()) {
    Serial.println(" Sin red   : el cobro quedo en cola, se envia solo");
  }
  Serial.println("========================================");
  Serial.println();
}

static void liquidar(const char *motivo) {
  valvulaCerrar();
  Serial.printf(">> %s\n", motivo);
  anotar(motivo);

  uint32_t ml = mlDePulsos(pulsosServidos, pulsosPorLitroMili);

  // Primero la flash, después el papelito. Si se corta la luz justo acá, lo que
  // tiene que haber sobrevivido es el cobro.
  encolarCierre(sesionId, ml, pulsosServidos);
  olvidarVenta();

  // Y recién ahora se sube la marca de agua: de acá en adelante el servidor
  // puede seguir devolviendo esta sesión —el cierre todavía está en la cola— y
  // la canilla la va a ignorar.
  ajustesGuardarUltimaSesion(sesionId);

  imprimirTicket(ml, pulsosServidos);

  sesionId = 0; uidSesion[0] = '\0'; cliente[0] = '\0';
  pulsosServidos = 0; pulsosMax = 0;
  irA(ESPERANDO);
}

static void tareaControl(void *) {
  esp_task_wdt_add(NULL);

  for (;;) {
    esp_task_wdt_reset();
    uint32_t ahora = millis();

    // ── La regla de oro, antes que cualquier otra cosa ───────────────────
    // La válvula está abierta SOLO en los estados que la necesitan. Cualquier
    // camino nuevo que alguien agregue mañana nace con la válvula cerrada.
    bool debeEstarAbierta = (estado == HABILITADO) || (estado == SIRVIENDO);
    if (!debeEstarAbierta) valvulaCerrar();

    digitalWrite(PIN_LED, (estado == SIRVIENDO || estado == HABILITADO) ? HIGH : LOW);

    // Las órdenes se aplican solo con la canilla libre: reiniciar en medio de
    // un servicio corta la cerveza y pierde la venta.
    if (estado == ESPERANDO) {
      Orden orden;
      if (xQueueReceive(colaOrden, &orden, 0) == pdTRUE) { aplicarOrden(orden); }
    }

    switch (estado) {

      case ESPERANDO: {
        SesionNube s;
        if (xQueueReceive(colaSesion, &s, 0) != pdTRUE) break;
        if (!s.hay || s.id <= ajustesUltimaSesion()) break;

        sesionId            = s.id;
        pulsosPorLitroMili  = s.pulsosPorLitroMili;
        precioLitroCentavos = s.precioLitroCentavos;
        saldoCentavos       = s.saldoCentavos;
        snprintf(uidSesion, sizeof(uidSesion), "%s", s.uid);
        snprintf(cliente,   sizeof(cliente),   "%s", s.cliente);

        // El límite se convierte a PULSOS acá y no se vuelve a tocar. De acá en
        // adelante el corte no consulta nada: compara dos enteros.
        pulsosMax      = pulsosDeMl(s.mlMaximos, pulsosPorLitroMili);
        pulsosBase     = caudalPulsos();
        pulsosServidos = 0;
        pulsosPrevios  = 0;
        pausasCumplidas = 0;
        enEspera        = false;
        anotarVenta(sesionId, 0, pulsosPorLitroMili);

        char plata[24];
        formatearPesos(saldoCentavos, plata, sizeof(plata));
        Serial.println();
        Serial.printf("Hola %s | saldo %s | hasta %lu ml (%lu pulsos)\n",
                      cliente[0] ? cliente : uidSesion, plata,
                      (unsigned long)s.mlMaximos, (unsigned long)pulsosMax);
        Serial.println("Abri el grifo cuando quieras.");
        {
          char e[72];
          snprintf(e, sizeof(e), "Tarjeta de %s, hasta %lu ml",
                   cliente[0] ? cliente : uidSesion, (unsigned long)s.mlMaximos);
          anotar(e);
        }

        habilitadaEn = ahora;
        ultimoInforme = ahora;
        abrirSiHaceFalta();
        irA(HABILITADO);
        break;
      }

      case HABILITADO: {
        uint32_t pulsos = caudalPulsos() - pulsosBase;
        if (pulsos > 0) {
          pulsosServidos = pulsos;
          pulsosPrevios  = pulsos;
          ultimoPulsoMs  = ahora;
          Serial.println(">> Empezo a salir. Sirviendo.");
          anotar("Empezo a salir");
          irA(SIRVIENDO);
          break;
        }
        if (ahora - habilitadaEn > ESPERA_PRIMER_PULSO_MS) {
          liquidar("Nadie abrio el grifo. Cierra sin cobrar.");
        }
        break;
      }

      case SIRVIENDO: {
        uint32_t pulsos = caudalPulsos() - pulsosBase;
        pulsosServidos = pulsos;
        if (pulsos != pulsosPrevios) {
          pulsosPrevios = pulsos;
          ultimoPulsoMs = ahora;
          anotarVenta(sesionId, pulsos, pulsosPorLitroMili);

          // Volvió a correr después de una espera: no era el final, era una
          // pausa. Se le anota a favor y la próxima vez se le espera más.
          if (enEspera) {
            enEspera = false;
            if (pausasCumplidas < 200) pausasCumplidas++;
            Serial.printf(">> Siguio sirviendo. La proxima espera %lu s.\n",
                          (unsigned long)(graciaActual() / 1000));
          }
        }

        if (pulsosMax > 0 && pulsos >= pulsosMax) {
          liquidar("Limite de saldo alcanzado. Corta y cobra.");
          break;
        }
        if (ahora - valvulaAbiertaDesde() > MAX_APERTURA_MS) {
          // El texto sale del propio tope: ahora esta frase viaja a la app
          // como ultimo_evento, y un numero desactualizado ahi miente.
          char m[72];
          snprintf(m, sizeof(m), "FAILSAFE: %lu s abierta seguidas. Corta y cobra.",
                   (unsigned long)(MAX_APERTURA_MS / 1000));
          liquidar(m);
          break;
        }

        // Dejó de correr. La válvula queda ABIERTA: con el grifo cerrado no
        // entrega nada, y si el cliente vuelve a abrirlo los pulsos aparecen
        // solos, sin que el firmware tenga que provocarlos.
        if (!enEspera && ahora - ultimoPulsoMs > FIN_DE_SERVICIO_MS) {
          enEspera = true;
          Serial.printf(">> Dejo de correr. Le espero %lu s por si sigue.\n",
                        (unsigned long)(graciaActual() / 1000));
          anotar("Dejo de correr, esperando por si sigue");
        }

        if (enEspera && ahora - ultimoPulsoMs > graciaActual()) {
          liquidar("Se fue. Cierra y cobra lo servido.");
          break;
        }

        if (ahora - ultimoInforme >= PROGRESO_MS) {
          ultimoInforme = ahora;
          uint32_t ml = mlDePulsos(pulsos, pulsosPorLitroMili);
          Serial.printf("   sirviendo... %lu ml  (%lu/%lu pulsos)\n",
                        (unsigned long)ml, (unsigned long)pulsos,
                        (unsigned long)pulsosMax);
          Progreso p = { sesionId, ml, pulsos };
          xQueueOverwrite(colaProgreso, &p);
        }
        break;
      }

      case LIQUIDANDO:
        // No se usa: `liquidar()` hace todo y vuelve a ESPERANDO. Queda por
        // completitud del enum.
        irA(ESPERANDO);
        break;
    }

    vTaskDelay(pdMS_TO_TICKS(5));
  }
}


// ═════════════════════════════════════════════════════════════════════════════
// ÓRDENES
// ═════════════════════════════════════════════════════════════════════════════
static void aplicarOrden(const Orden &o) {
  Serial.printf("\n>> ORDEN #%lld: %s\n", (long long)o.id, o.tipo);

  // La marca ANTES de ejecutar: las tres órdenes terminan en un reinicio, y si
  // se anotara después nunca llegaría a anotarse. Sería un bucle de reinicios.
  ajustesGuardarUltimaOrden(o.id);

  if (strcmp(o.tipo, "wifi") == 0) {
    if (!ajustesGuardarWifi(o.ssid, o.pass)) {
      Serial.println("   no se pudo guardar. Se ignora la orden.");
      return;
    }
    Serial.printf("   red nueva a prueba: \"%s\"\n", o.ssid);
  } else if (strcmp(o.tipo, "olvidar_wifi") == 0) {
    ajustesOlvidarWifi();
  } else if (strcmp(o.tipo, "reiniciar") != 0) {
    Serial.println("   tipo desconocido (firmware viejo?). Se ignora.");
    return;
  }

  Serial.println(">> Reiniciando...");
  Serial.flush();
  valvulaCerrar();
  delay(300);
  ESP.restart();
}


// ═════════════════════════════════════════════════════════════════════════════
void setup() {
  // Antes que nada: si algo de lo que viene se cuelga, la válvula ya quedó
  // cerrada.
  valvulaIniciar();

  Serial.begin(115200);
  delay(300);

  pinMode(PIN_BOTON, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  // El botón apretado al arrancar pide el portal. Se confirma **al soltarlo**:
  // un contacto trabado no suelta nunca, y una persona sí.
  if (digitalRead(PIN_BOTON) == LOW) {
    Serial.println("Boton apretado. Solta antes de 3 s para arrancar normal...");
    uint32_t desde = millis();
    while (digitalRead(PIN_BOTON) == LOW && millis() - desde < 3000) {
      digitalWrite(PIN_LED, ((millis() - desde) / 150) % 2);
      delay(20);
    }
    digitalWrite(PIN_LED, LOW);
    if (digitalRead(PIN_BOTON) == LOW) {
      Serial.println("Solta el boton para entrar al portal...");
      uint32_t espera = millis();
      while (digitalRead(PIN_BOTON) == LOW && millis() - espera < 10000) delay(20);
      if (digitalRead(PIN_BOTON) == LOW) {
        Serial.println("!! El boton quedo apretado solo. Se ignora y arranca normal.");
      } else {
        pidieronPortal = true;
        Serial.println(">> PORTAL DE CONFIGURACION pedido a mano.");
      }
    }
  }

  Serial.println();
  Serial.println("=============================================");
  Serial.println(" GRIFO - ETAPA 7: LA TARJETA LA LEE LA TABLET");
  Serial.println("=============================================");
  Serial.printf("Canilla           : %d\n", GRIFO_ID);
  Serial.println("Lector RFID       : no se usa");
  Serial.println("Boton             : solo para el portal");

  colaIniciar();
  uint32_t pendientes = colaCantidad();
  if (pendientes > 0) {
    Serial.printf("Cierres pendientes: %lu (de antes del reset)\n",
                  (unsigned long)pendientes);
  } else {
    Serial.println("Cierres pendientes: ninguno");
  }

  ajustesIniciar();

  // Rescatar una venta que quedó a mitad. Va primero que todo lo demás: si la
  // placa se reinició sirviendo, esa cerveza tiene que quedar registrada.
  if (rtcFirma == FIRMA_VENTA && rtcSesion > 0) {
    uint32_t ml = mlDePulsos(rtcPulsos, rtcPplMili);
    Serial.println();
    Serial.println("!! Se reinicio con una venta a medias. Rescatando:");
    Serial.printf("!!   sesion %lld -- %lu ml (%lu pulsos)\n",
                  (long long)rtcSesion, (unsigned long)ml, (unsigned long)rtcPulsos);
    encolarCierre(rtcSesion, ml, rtcPulsos);
    ajustesGuardarUltimaSesion(rtcSesion);
    olvidarVenta();
    Serial.println("!! Queda en la cola. Se cobra en cuanto haya red.");
    Serial.println();
  } else {
    olvidarVenta();
  }

  caudalIniciar(true);

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
  }

  colaSesion   = xQueueCreate(1, sizeof(SesionNube));
  colaProgreso = xQueueCreate(1, sizeof(Progreso));
  colaOrden    = xQueueCreate(1, sizeof(Orden));

  xTaskCreatePinnedToCore(tareaRed,     "red",     8192, NULL, 1, NULL, 0);
  xTaskCreatePinnedToCore(tareaControl, "control", 8192, NULL, 3, NULL, 1);

  Serial.println("---------------------------------------------");
  Serial.println();
}

void loop() { vTaskDelay(pdMS_TO_TICKS(1000)); }
