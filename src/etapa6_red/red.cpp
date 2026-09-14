#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "red.h"
#include "secrets.h"

// Si el secrets.h es de antes de que existiera este campo, no rompe: se asume
// un valor. Agregar una configuración obligatoria a un archivo que ya está en
// la máquina de otro es una forma barata de romperle la compilación.
#ifndef FIRMWARE_VERSION
  #define FIRMWARE_VERSION "etapa6"
#endif

// Dos plazos distintos, porque no todo vale lo mismo.
//
// Un cobro merece esperar: es plata. Un refresco de la pantalla no — si tarda
// más de dos segundos ya perdió sentido, y mientras tanto está ocupando la
// única conexión que hay.
//
//   Es poner un timeout más corto en la llamada opcional que en la crítica.
static const uint32_t TIMEOUT_MS      = 6000;   // autorizar y cobrar
static const uint32_t TIMEOUT_ADORNO  = 2500;   // latido y progreso
static const uint32_t REINTENTO_WIFI_MS = 5000;

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

void redIniciar() {
  Serial.printf("[red] Conectando a \"%s\"...\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

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

bool redConectada() { return WiFi.status() == WL_CONNECTED; }

void redMantener() {
  static uint32_t ultimoIntento = 0;
  static bool     anunciado = false;

  // ── Avisar los cambios de estado, no el estado ──────────────────────────
  // Imprimir "conectado" en cada vuelta llenaría la consola y escondería lo
  // que importa. Se avisa cuando CAMBIA, que es cuando hay algo que saber.
  //
  //   Es loguear las transiciones, no el polling.
  if (redConectada()) {
    if (!anunciado) {
      Serial.printf("[red] WiFi conectado. IP %s  (senal %d dBm)\n",
                    WiFi.localIP().toString().c_str(), (int)WiFi.RSSI());
      anunciado = true;
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
  Serial.println("[red] reintentando conectar...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

/** Hace el POST y deja el cuerpo de la respuesta en `salida`.
 *  Devuelve el código HTTP, o un negativo si ni siquiera se pudo enviar. */
static int postRpc(const char *funcion, const String &cuerpo, String &salida,
                   uint32_t plazo = TIMEOUT_MS) {
  if (!redConectada()) return -1;

  if (!httpConfigurado) {
    http.setReuse(true);          // no cerrar el TCP al terminar cada pedido
    httpConfigurado = true;
  }

  String url = String(SUPABASE_URL) + "/rest/v1/rpc/" + funcion;
  if (!http.begin(cliente, url)) return -2;

  http.setTimeout(plazo);
  http.setConnectTimeout(plazo);
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
    snprintf(r.motivo, sizeof(r.motivo), "http_%d", codigo);
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
