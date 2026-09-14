#pragma once
// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — la configuración que sobrevive al apagón y NO vive en el código
//
// El WiFi estaba en `secrets.h`, o sea: adentro del binario. Cambiar de red
// significaba abrir la notebook, editar un archivo, compilar y flashear. En el
// bar eso no existe: la canilla va a estar atornillada abajo de una barra y el
// WiFi lo va a cambiar alguien que no programa.
//
//   Es sacar la config del bundle y ponerla en variables de entorno. Mismo
//   motivo: lo que cambia por instalación no puede estar compilado adentro.
//
// ── Por qué hay DOS pares de credenciales ───────────────────────────────────
// Si guardás una red nueva y le erraste una letra a la clave, la canilla queda
// sin red y sin forma de arreglarla salvo yendo hasta ahí con un celular.
//
// Por eso la red nueva entra **a prueba**: se guarda la anterior al lado. Si la
// nueva no conecta, el firmware vuelve solo a la que andaba.
//
//   Es un deploy con rollback automático. Nadie manda a producción algo que no
//   sabe deshacer, y "cambiar el WiFi de un aparato al que no llegás" es
//   exactamente eso.
// ═════════════════════════════════════════════════════════════════════════════

#include <stdint.h>

struct AjustesWifi {
  char ssid[33];   // 32 + terminador, que es el máximo que permite 802.11
  char pass[65];   // 64 + terminador
};

/** Abre el almacenamiento. Va una sola vez, en el setup. */
void ajustesIniciar();

/** Si nunca se configuró nada, deja estas credenciales como las de fábrica.
 *  Sirve para que el `secrets.h` que ya está funcionando siga funcionando: la
 *  primera vez se copian a NVS y de ahí en adelante mandan las de NVS. */
void ajustesSembrarWifi(const char *ssid, const char *pass);

bool               ajustesHayWifi();
const AjustesWifi &ajustesWifi();

/** Guarda credenciales nuevas **a prueba**: la que estaba se conserva como
 *  respaldo. Hasta que alguien llame a `ajustesConfirmarWifi()`, un arranque
 *  que no logre conectar va a revertir. */
bool ajustesGuardarWifi(const char *ssid, const char *pass);

/** true si las credenciales actuales todavía no demostraron que andan. */
bool ajustesWifiAPrueba();

/** La red nueva conectó: se acepta y se deja de tener red de respaldo. */
void ajustesConfirmarWifi();

/** Vuelve a la red anterior. Devuelve false si no había ninguna a la que
 *  volver (típico de la primera configuración). */
bool ajustesRevertirWifi();

/** Borra el WiFi guardado. La próxima vez arranca el portal. */
void ajustesOlvidarWifi();


// ── La marca de agua de las órdenes ─────────────────────────────────────────
// Hasta qué número de orden llegó esta canilla. Viaja en cada latido, y el
// servidor solo le entrega órdenes con un número mayor.
//
// Vive en NVS y no en RAM por un motivo puntual: la orden más útil es
// "reiniciate". Si la marca se perdiera en el reinicio, el servidor volvería a
// entregar la misma orden en el latido siguiente, y la canilla se reiniciaría
// para siempre.
//
//   Es el offset del consumidor commiteado antes de procesar. Sin eso, un
//   mensaje que mata al worker se reintenta eternamente: la cola de veneno.
int64_t ajustesUltimaOrden();
void    ajustesGuardarUltimaOrden(int64_t id);
