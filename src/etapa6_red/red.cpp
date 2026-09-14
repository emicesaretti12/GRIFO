#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "red.h"
#include "ajustes.h"
#include "portal.h"
#include "secrets.h"

// Si el secrets.h es de antes de que existiera este campo, no rompe: se asume
// un valor. Agregar una configuración obligatoria a un archivo que ya está en
// la máquina de otro es una forma barata de romperle la compilación.
#ifndef FIRMWARE_VERSION
  #define FIRMWARE_VERSION "etapa6"
#endif

// Clave de la red que levanta la canilla cuando no puede conectarse a ninguna.
// Mínimo 8 caracteres: es lo que exige WPA2. Con menos, la red sale ABIERTA.
#ifndef PORTAL_PASS
  #define PORTAL_PASS "cerveza2024"
#endif

// Dos plazos distintos, porque no todo vale lo mismo.
//
// Un cobro merece esperar: es plata. Un refresco de la pantalla no — si tarda
// más de dos segundos ya perdió sentido, y mientras tanto está ocupando la
// única conexión que hay.
//
//   Es poner un timeout más corto en la llamada opcional que en la crítica.
static const uint32_t TIMEOUT_MS      = 6000;   // esperar la RESPUESTA: autorizar y cobrar
static const uint32_t TIMEOUT_ADORNO  = 2500;   // esperar la RESPUESTA: latido y progreso

// ── Y este es OTRO plazo, el de ESTABLECER la conexión ──────────────────────
// Un handshake TLS en un ESP32 tarda dos o tres segundos: intercambio de
// claves, validación, negociación. Es lento y no hay nada que hacerle.
//
// Aplicarle a eso el plazo corto del adorno fue un error mío: la conexión no
// llegaba a completarse nunca y cada pedido moría con
// `start_ssl_client: -1`.
//
//   Es confundir el timeout de conexión con el de lectura. Son dos cosas
//   distintas y solo una de las dos se puede apurar.
//
// Pero tampoco puede ser enorme. El plazo de conexión tiene que entrar CÓMODO
// adentro del que tiene la máquina de estados para autorizar (10 s): si un
// intento fallido de conectar se come los 10 s solo, el cliente ve
// "sin respuesta" sin que se haya llegado a preguntar nada.
//
//   El timeout de la capa de abajo tiene que ser menor que el de la de arriba.
//   Si es al revés, el de arriba nunca llega a hacer su trabajo.
//
// Con la conexión ya abierta por `redCalentar()`, esto casi nunca se usa.
static const uint32_t TIMEOUT_CONECTAR = 4000;

// Códigos propios, bien lejos de los que usa HTTPClient (que llegan a -11).
static const int SIN_WIFI      = -100;
static const int NO_ARRANCO    = -101;
static const uint32_t REINTENTO_WIFI_MS = 5000;

// Cuánto se le da a una red para demostrar que anda antes de dudar de ella.
// Un ESP32 con buena señal conecta en 3-6 s; 20 s cubre un router lento sin
// dejar la canilla colgada un minuto en cada arranque.
static const uint32_t ESPERA_CONEXION_MS = 20000;

// El portal es una red sin dueño al alcance de cualquiera que pase. Si nadie la
// usó en diez minutos, es que nadie la está esperando: se reinicia y se vuelve
// a intentar con la red guardada, que para entonces quizás ya volvió.
//
//   Es cerrar la puerta de servicio cuando se terminó el turno del técnico.
static const uint32_t PORTAL_MAX_MS = 600000;
static uint32_t portalDesde = 0;

static WiFiClientSecure cliente;

// ── Por qué el HTTPClient es uno solo y vive para siempre ───────────────────
// Cada petición HTTPS nueva paga un handshake TLS: intercambio de claves,
// validación, negociación. En un ESP32 eso son **dos o tres segundos**, y es
// casi todo el tiempo que tarda autorizar una tarjeta.
//
// El cliente se apoya y no pasa nada visible. El cajero lo lee como que no
// funcionó, la retira, y queda una sesión abierta del lado del servidor.
//
// Con `setReuse(true)` y un HTTPClient que no se destruye, la conexión TCP
// queda abierta entre pedidos y el handshake se paga **una sola vez**. Las
// peticiones siguientes bajan a fracciones de segundo.
//
//   Es un pool de conexiones en vez de abrir una por consulta. El mismo motivo,
//   y el mismo tamaño de diferencia.
static HTTPClient http;
static bool       httpConfigurado = false;

/** Le pide al chip que se conecte a la red que hoy está guardada. */
static void arrancarWifi() {
  const AjustesWifi &w = ajustesWifi();
  Serial.printf("[red] Conectando a \"%s\"%s...\n", w.ssid,
                ajustesWifiAPrueba() ? " (a prueba)" : "");
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(w.ssid, w.pass);
}

void redIniciar() {
  ajustesIniciar();

  // ── El `secrets.h` pasa a ser el valor de FÁBRICA, no la verdad ───────────
  // La primera vez se copia a NVS; de ahí en adelante manda lo que hay en NVS.
  // Así el equipo que ya está andando sigue andando sin tocar nada, y el que se
  // reconfigura desde el portal no vuelve a la red vieja al reflashear.
  //
  //   Es un default en el código que la config del entorno pisa.
  ajustesSembrarWifi(WIFI_SSID, WIFI_PASS);

  if (ajustesHayWifi()) arrancarWifi();
  else Serial.println("[red] No hay ninguna red guardada.");

  if (strlen(CERT_RAIZ) > 0) {
    cliente.setCACert(CERT_RAIZ);
  } else {
    // Sin certificado no se valida quién está del otro lado. Anda, y para el
    // banco de pruebas alcanza, pero en el bar alguien en la misma red podría
    // hacerse pasar por Supabase y quedarse con el token de la canilla.
    cliente.setInsecure();
    Serial.println("!! TLS SIN VALIDAR. Pega el certificado raiz en secrets.h");
    Serial.println("!! antes de poner esto en el bar. Ver el comentario ahi.");
  }
  cliente.setTimeout(TIMEOUT_MS / 1000);
}

void redAbrirPortal() {
  char nombre[20];
  snprintf(nombre, sizeof(nombre), "GRIFO-%d", (int)GRIFO_ID);
  portalDesde = millis();
  portalArrancar(nombre, PORTAL_PASS);
}

bool redEnPortal() { return portalActivo(); }

bool redHayWifiGuardado() { return ajustesHayWifi(); }

/** Se llama UNA vez, después de que el arranque le dio su tiempo al WiFi.
 *
 *  La espera en sí la hace el que llama, porque es el dueño del watchdog: un
 *  bucle de veinte segundos acá adentro lo dejaría sin alimentar y la placa se
 *  reiniciaría sola a mitad del arranque.
 *
 *    Es no meter un sleep largo adentro de una función que no controla el
 *    heartbeat del supervisor. */
bool redResolverArranque() {
  if (redConectada()) {
    // Conectó: si estaba a prueba, recién ahora se gana el puesto.
    ajustesConfirmarWifi();
    return true;
  }

  // ── No conectó. Acá se decide, y el orden importa ─────────────────────────
  if (ajustesWifiAPrueba()) {
    // Alguien la configuró recién y no anda. Antes de molestar a nadie, se
    // vuelve sola a la red que sí andaba. Esto es lo que hace que cambiar el
    // WiFi desde la app no pueda dejar la canilla incomunicada.
    Serial.println("[red] La red nueva no conecto. Volviendo a la anterior...");
    if (ajustesRevertirWifi()) {
      Serial.println("[red] Reiniciando para probar la red anterior.");
      delay(400);
      ESP.restart();
    }
  }

  Serial.println("[red] Sin red. Levantando el portal de configuracion.");
  redAbrirPortal();
  return false;
}

void redAtenderPortal() {
  if (!portalActivo()) return;
  portalAtender();

  if (portalGuardoWifi()) {
    Serial.println("[red] Credenciales guardadas. Reiniciando para usarlas.");
    delay(1200);        // que la respuesta llegue al celular antes del reset
    ESP.restart();
  }

  // Si hay una red guardada a la que volver a intentarle, el portal no se queda
  // arriba para siempre.
  if (ajustesHayWifi() && millis() - portalDesde > PORTAL_MAX_MS) {
    Serial.println("[red] Nadie uso el portal. Reintentando la red guardada.");
    delay(200);
    ESP.restart();
  }
}

bool redConectada() { return WiFi.status() == WL_CONNECTED; }

void redMantener() {
  static uint32_t ultimoIntento = 0;
  static bool     anunciado = false;

  // ── Avisar los cambios de estado, no el estado ──────────────────────────
  // Imprimir "conectado" en cada vuelta llenaría la consola y escondería lo
  // que importa. Se avisa cuando CAMBIA, que es cuando hay algo que saber.
  //
  //   Es loguear las transiciones, no el polling.
  if (portalActivo()) return;   // mientras el portal manda, nadie toca el WiFi

  if (redConectada()) {
    if (!anunciado) {
      Serial.printf("[red] WiFi conectado a \"%s\". IP %s  (senal %d dBm)\n",
                    ajustesWifi().ssid, WiFi.localIP().toString().c_str(),
                    (int)WiFi.RSSI());
      anunciado = true;
      ajustesConfirmarWifi();
    }
    return;
  }

  if (anunciado) {
    Serial.println("[red] WiFi CAIDO. La canilla sigue cortando sola;");
    Serial.println("[red] los cierres se guardan y se envian al volver.");
    anunciado = false;
  }

  uint32_t ahora = millis();
  if (ahora - ultimoIntento < REINTENTO_WIFI_MS) return;
  ultimoIntento = ahora;
  if (!ajustesHayWifi()) return;
  Serial.println("[red] reintentando conectar...");
  WiFi.disconnect();
  arrancarWifi();
}

/** Hace el POST y deja el cuerpo de la respuesta en `salida`.
 *  Devuelve el código HTTP, o un negativo si ni siquiera se pudo enviar. */
static int postRpc(const char *funcion, const String &cuerpo, String &salida,
                   uint32_t plazo = TIMEOUT_MS) {
  if (!redConectada()) return SIN_WIFI;

  if (!httpConfigurado) {
    http.setReuse(true);          // no cerrar el TCP al terminar cada pedido
    httpConfigurado = true;
  }

  String url = String(SUPABASE_URL) + "/rest/v1/rpc/" + funcion;
  if (!http.begin(cliente, url)) return NO_ARRANCO;

  http.setTimeout(plazo);                    // cuánto esperar la respuesta
  http.setConnectTimeout(TIMEOUT_CONECTAR);  // cuánto esperar el handshake
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON);

  int codigo = http.POST(cuerpo);
  if (codigo > 0) salida = http.getString();
  http.end();

  // ── La contracara de reusar la conexión ───────────────────────────────────
  // Mantenerla abierta ahorra el handshake, pero el servidor la cierra por su
  // cuenta cuando quiere. Si eso pasa entre dos pedidos, el siguiente sale por
  // un socket que ya no existe y se queda esperando hasta agotar el plazo.
  //
  // Ante cualquier error se tira el socket y el próximo pedido abre uno nuevo.
  // Cuesta un handshake; no hacerlo cuesta que una canilla quede clavada.
  //
  //   Es descartar del pool la conexión que devolvió error en vez de
  //   devolverla y que le toque al que viene.
  if (codigo != 200) cliente.stop();

  return codigo;
}

/** Un código de error crudo no le sirve a nadie parado frente a la canilla.
 *  `http_-1` no dice qué hacer; "sin WiFi" sí. */
static const char *motivoDeCodigo(int codigo) {
  switch (codigo) {
    case SIN_WIFI:   return "sin WiFi";
    case NO_ARRANCO: return "no arranco el pedido";
    case -1:         return "no se pudo conectar";
    case -5:         return "se corto la conexion";
    case -11:        return "el servidor tardo demasiado";
    case 401:
    case 403:        return "token rechazado";
    case 404:        return "falta la funcion en el servidor";
    default:         return NULL;
  }
}

bool redAbrirSesion(const char *uid, RespuestaAbrir &r) {
  memset(&r, 0, sizeof(r));

  JsonDocument pedido;
  pedido["p_uid"]   = uid;
  pedido["p_grifo"] = GRIFO_ID;
  pedido["p_token"] = GRIFO_TOKEN;

  String cuerpo;
  serializeJson(pedido, cuerpo);

  String respuesta;
  int codigo = postRpc("abrir_sesion", cuerpo, respuesta);
  if (codigo != 200) {
    const char *m = motivoDeCodigo(codigo);
    if (m) snprintf(r.motivo, sizeof(r.motivo), "%s", m);
    else   snprintf(r.motivo, sizeof(r.motivo), "el servidor dijo %d", codigo);
    return false;
  }

  JsonDocument doc;
  if (deserializeJson(doc, respuesta)) {
    snprintf(r.motivo, sizeof(r.motivo), "json_invalido");
    return false;
  }

  if (!doc["ok"].as<bool>()) {
    const char *m = doc["motivo"] | "desconocido";
    snprintf(r.motivo, sizeof(r.motivo), "%s", m);
    return false;
  }

  r.ok                  = true;
  r.sesionId            = doc["sesion_id"].as<long long>();
  r.mlMaximos           = doc["ml_maximos"].as<uint32_t>();
  r.precioLitroCentavos = doc["precio_litro_centavos"].as<uint32_t>();
  r.saldoCentavos       = doc["saldo_centavos"].as<uint32_t>();

  // `pulsos_por_litro` es un numeric con tres decimales. Llega como número
  // JSON; lo pasamos a milésimas enteras en cuanto lo tocamos, para que el
  // double no viaje más allá de esta línea. De acá para adentro no hay float.
  double ppl = doc["pulsos_por_litro"].as<double>();
  r.pulsosPorLitroMili = (uint32_t)(ppl * 1000.0 + 0.5);

  return true;
}

bool redCerrarSesion(int64_t sesionId, uint32_t ml, uint32_t pulsos) {
  JsonDocument pedido;
  pedido["p_sesion_id"] = sesionId;
  pedido["p_ml"]        = ml;
  pedido["p_pulsos"]    = pulsos;
  pedido["p_token"]     = GRIFO_TOKEN;

  String cuerpo;
  serializeJson(pedido, cuerpo);

  String respuesta;
  if (postRpc("cerrar_sesion", cuerpo, respuesta) != 200) return false;

  JsonDocument doc;
  if (deserializeJson(doc, respuesta)) return false;

  // Solo un `ok: true` saca el cierre de la cola. Cualquier otra cosa —una
  // respuesta rara, un motivo de error, un cuerpo vacío— deja el pendiente
  // donde está para reintentarlo. Ante la duda, la venta no se descarta.
  if (!doc["ok"].as<bool>()) {
    Serial.printf("   cierre rechazado: %s\n", doc["motivo"] | "?");
    return false;
  }

  if (doc["repetida"].as<bool>()) {
    Serial.println("   (ya estaba cerrada: idempotencia del servidor)");
  }
  return true;
}


bool redLatido(uint32_t cierresPendientes) {
  JsonDocument pedido;
  pedido["p_grifo"]      = GRIFO_ID;
  pedido["p_token"]      = GRIFO_TOKEN;
  pedido["p_firmware"]   = FIRMWARE_VERSION;
  pedido["p_pendientes"] = cierresPendientes;
  pedido["p_senal"]      = (int)WiFi.RSSI();
  pedido["p_ip"]         = WiFi.localIP().toString();

  String cuerpo;
  serializeJson(pedido, cuerpo);

  String respuesta;
  if (postRpc("canilla_latido", cuerpo, respuesta, TIMEOUT_ADORNO) != 200) return false;

  JsonDocument doc;
  if (deserializeJson(doc, respuesta)) return false;
  return doc["ok"].as<bool>();
}


bool redReportarProgreso(int64_t sesionId, uint32_t ml, uint32_t pulsos) {
  JsonDocument pedido;
  pedido["p_sesion_id"] = sesionId;
  pedido["p_ml"]        = ml;
  pedido["p_pulsos"]    = pulsos;
  pedido["p_token"]     = GRIFO_TOKEN;

  String cuerpo;
  serializeJson(pedido, cuerpo);

  String respuesta;
  return postRpc("reportar_progreso", cuerpo, respuesta, TIMEOUT_ADORNO) == 200;
}


bool redCalentar(uint32_t cierresPendientes) {
  if (!redConectada()) return false;

  Serial.println("[red] abriendo la conexion segura (tarda unos segundos)...");
  uint32_t t0 = millis();

  // Se usa el latido porque es la petición más barata que hay y de paso avisa
  // que la canilla arrancó. Lo que importa no es la respuesta: es que el
  // handshake quede hecho y el socket abierto para el que venga después.
  //
  // Con el plazo LARGO a propósito: acá no hay nadie esperando, y abandonar a
  // los 2,5 s dejaría el handshake a medias justo para que lo pague el primer
  // cliente.
  String cuerpo, respuesta;
  {
    JsonDocument pedido;
    pedido["p_grifo"]      = GRIFO_ID;
    pedido["p_token"]      = GRIFO_TOKEN;
    pedido["p_firmware"]   = FIRMWARE_VERSION;
    pedido["p_pendientes"] = cierresPendientes;
    pedido["p_senal"]      = (int)WiFi.RSSI();
    pedido["p_ip"]         = WiFi.localIP().toString();
    serializeJson(pedido, cuerpo);
  }

  int codigo = postRpc("canilla_latido", cuerpo, respuesta, TIMEOUT_MS);
  uint32_t tardo = millis() - t0;

  if (codigo == 200) {
    Serial.printf("[red] conexion lista en %lu ms. La primera tarjeta ya no espera esto.\n",
                  (unsigned long)tardo);
    return true;
  }

  const char *m = motivoDeCodigo(codigo);
  Serial.printf("[red] no se pudo abrir la conexion (%s) tras %lu ms.\n",
                m ? m : "error", (unsigned long)tardo);
  Serial.println("[red] Se reintenta con el proximo latido. La canilla igual corta sola.");
  return false;
}
