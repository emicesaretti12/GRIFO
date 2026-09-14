#include <Arduino.h>
#include <Preferences.h>
#include <string.h>
#include "ajustes.h"

// Namespace propio. La cola de cierres usa el suyo: dos módulos que guardan
// cosas distintas no comparten cajón, así uno no puede pisar al otro por un
// nombre de clave repetido.
static const char *ESPACIO = "grifo-cfg";

// Las claves de NVS tienen un máximo de 15 caracteres. No es una convención
// nuestra: es el límite del formato, y pasarse hace que el guardado falle en
// silencio. Por eso son cortas y feas.
static const char *K_SSID  = "ssid";
static const char *K_PASS  = "pass";
static const char *K_SSID0 = "ssid0";   // la que andaba antes: el respaldo
static const char *K_PASS0 = "pass0";
static const char *K_PRUEBA = "prueba";

static Preferences  nvs;
static bool         abierto = false;
static AjustesWifi  actual  = { "", "" };
static bool         aPrueba = false;

static void copiar(char *destino, size_t largo, const String &origen) {
  snprintf(destino, largo, "%s", origen.c_str());
}

void ajustesIniciar() {
  if (abierto) return;
  abierto = nvs.begin(ESPACIO, false);
  if (!abierto) {
    Serial.println("[ajustes] NO se pudo abrir NVS. Se usa lo de secrets.h y nada se guarda.");
    return;
  }
  copiar(actual.ssid, sizeof(actual.ssid), nvs.getString(K_SSID, ""));
  copiar(actual.pass, sizeof(actual.pass), nvs.getString(K_PASS, ""));
  aPrueba = nvs.getUChar(K_PRUEBA, 0) == 1;
}

void ajustesSembrarWifi(const char *ssid, const char *pass) {
  if (ajustesHayWifi()) return;              // ya hay algo: no se pisa
  if (ssid == NULL || ssid[0] == '\0') return;

  copiar(actual.ssid, sizeof(actual.ssid), String(ssid));
  copiar(actual.pass, sizeof(actual.pass), String(pass ? pass : ""));
  aPrueba = false;                            // viene del firmware: se asume buena

  if (abierto) {
    nvs.putString(K_SSID, actual.ssid);
    nvs.putString(K_PASS, actual.pass);
    nvs.putUChar(K_PRUEBA, 0);
  }
  Serial.printf("[ajustes] WiFi de fabrica tomado del firmware: \"%s\"\n", actual.ssid);
}

bool ajustesHayWifi() { return actual.ssid[0] != '\0'; }

const AjustesWifi &ajustesWifi() { return actual; }

bool ajustesWifiAPrueba() { return aPrueba; }

bool ajustesGuardarWifi(const char *ssid, const char *pass) {
  if (ssid == NULL || ssid[0] == '\0') return false;
  if (!abierto) return false;

  // ── El respaldo solo se toma de una red que YA demostró que anda ──────────
  // Si ya estábamos probando una, la actual es justamente la sospechosa:
  // copiarla arriba del respaldo sería tirar la única red buena que nos queda
  // y reemplazarla por otra sin probar.
  //
  //   Es no pisar el último backup bueno con el estado roto que estás por
  //   arreglar.
  if (!aPrueba && actual.ssid[0] != '\0') {
    nvs.putString(K_SSID0, actual.ssid);
    nvs.putString(K_PASS0, actual.pass);
  }

  copiar(actual.ssid, sizeof(actual.ssid), String(ssid));
  copiar(actual.pass, sizeof(actual.pass), String(pass ? pass : ""));
  aPrueba = true;

  nvs.putString(K_SSID, actual.ssid);
  nvs.putString(K_PASS, actual.pass);
  nvs.putUChar(K_PRUEBA, 1);
  Serial.printf("[ajustes] WiFi nuevo a prueba: \"%s\"\n", actual.ssid);
  return true;
}

void ajustesConfirmarWifi() {
  if (!aPrueba) return;
  aPrueba = false;
  if (abierto) nvs.putUChar(K_PRUEBA, 0);
  Serial.printf("[ajustes] \"%s\" quedo confirmada.\n", actual.ssid);
}

bool ajustesRevertirWifi() {
  if (!abierto) return false;

  String s = nvs.getString(K_SSID0, "");
  if (s.length() == 0) {
    // No hay a dónde volver. Se limpia la marca para no quedar revirtiendo en
    // loop en cada arranque, y que el portal se haga cargo.
    aPrueba = false;
    nvs.putUChar(K_PRUEBA, 0);
    return false;
  }

  String p = nvs.getString(K_PASS0, "");
  copiar(actual.ssid, sizeof(actual.ssid), s);
  copiar(actual.pass, sizeof(actual.pass), p);
  aPrueba = false;

  nvs.putString(K_SSID, actual.ssid);
  nvs.putString(K_PASS, actual.pass);
  nvs.putUChar(K_PRUEBA, 0);
  Serial.printf("[ajustes] Se volvio a la red anterior: \"%s\"\n", actual.ssid);
  return true;
}

void ajustesOlvidarWifi() {
  actual.ssid[0] = '\0';
  actual.pass[0] = '\0';
  aPrueba = false;
  if (!abierto) return;
  nvs.remove(K_SSID);
  nvs.remove(K_PASS);
  nvs.remove(K_SSID0);
  nvs.remove(K_PASS0);
  nvs.putUChar(K_PRUEBA, 0);
  Serial.println("[ajustes] WiFi borrado. Al reiniciar arranca el portal.");
}
