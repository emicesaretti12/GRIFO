#pragma once
// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — todo lo que habla con la red
//
// **Nada de esto se llama desde la tarea de control.** Una petición HTTPS puede
// tardar segundos, y la tarea que maneja la válvula no puede quedarse esperando
// ni un momento: mientras espera, no cuenta pulsos ni corta el chorro.
//
// La separación es física: esta unidad corre en la tarea de red, en el otro
// núcleo. Se comunican por colas.
// ═════════════════════════════════════════════════════════════════════════════

#include <stdint.h>

struct RespuestaAbrir {
  bool     ok;
  char     motivo[32];          // cuando ok = false
  int64_t  sesionId;
  uint32_t mlMaximos;
  uint32_t pulsosPorLitroMili;  // 452.700 viaja como 452700
  uint32_t precioLitroCentavos;
  uint32_t saldoCentavos;
};

void redIniciar();
bool redConectada();

/** Reconecta si hace falta. Se llama desde la tarea de red, no del control. */
void redMantener();

/** POST /rpc/abrir_sesion. Bloquea hasta la respuesta o el timeout. */
bool redAbrirSesion(const char *uid, RespuestaAbrir &r);

/** POST /rpc/cerrar_sesion. Devuelve true solo si el servidor confirmó, que es
 *  la única condición para sacar el cierre de la cola.
 *
 *  Es idempotente del lado del servidor: reintentar un cierre que ya se aplicó
 *  devuelve `repetida: true` y no cobra de nuevo. Por eso podemos reintentar
 *  sin miedo. */
bool redCerrarSesion(int64_t sesionId, uint32_t ml, uint32_t pulsos);
