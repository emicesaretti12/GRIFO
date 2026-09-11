#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "red.h"
#include "secrets.h"

static const uint32_t TIMEOUT_MS      = 8000;
static const uint32_t REINTENTO_WIFI_MS = 5000;

static WiFiClientSecure cliente;

void redIniciar() {
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
  if (redConectada()) return;
  uint32_t ahora = millis();
  if (ahora - ultimoIntento < REINTENTO_WIFI_MS) return;
  ultimoIntento = ahora;
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

/** Hace el POST y deja el cuerpo de la respuesta en `salida`.
 *  Devuelve el código HTTP, o un negativo si ni siquiera se pudo enviar. */
static int postRpc(const char *funcion, const String &cuerpo, String &salida) {
  if (!redConectada()) return -1;

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/rpc/" + funcion;

  if (!http.begin(cliente, url)) return -2;

  http.setTimeout(TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON);

  int codigo = http.POST(cuerpo);
  if (codigo > 0) salida = http.getString();
  http.end();
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
