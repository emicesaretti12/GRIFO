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

/** true si hay alguna red guardada a la cual intentarle. */
bool redHayWifiGuardado();

/** Se llama una sola vez en el arranque, cuando ya se le dio tiempo al WiFi.
 *  Devuelve true si conectó. Si no conectó, esta misma llamada decide:
 *
 *    · la red era nueva y a prueba  -> vuelve a la anterior y REINICIA la placa
 *    · no hay red a la cual volver  -> levanta el portal de configuración
 *
 *  La espera la hace el que llama, que es quien tiene que alimentar el
 *  watchdog mientras tanto. */
bool redResolverArranque();

/** true mientras la canilla esté haciendo de router con su propio portal.
 *  Mientras tanto no hay internet y no se puede autorizar a nadie. */
bool redEnPortal();

/** Atiende una vuelta del portal. Va en el bucle de la tarea de red.
 *  Si alguien guardó credenciales, esta función **reinicia la placa**: es la
 *  única forma limpia de levantar la pila de WiFi como cliente. */
void redAtenderPortal();

/** Levanta el portal a pedido — el botón apretado durante el arranque. */
void redAbrirPortal();

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

/** POST /rpc/canilla_latido. Le avisa al servidor que esta canilla está viva,
 *  con cuántos cierres tiene sin entregar y cómo anda la señal.
 *
 *  Un sistema que dura años no es uno que no falla: es uno donde **se ve que
 *  falló**, temprano y sin que nadie tenga que ir a mirar. Sin esto, una
 *  canilla colgada o sin red pasa desapercibida hasta que un cliente reclama. */
bool redLatido(uint32_t cierresPendientes);

/** Abre la conexión segura **antes** de que nadie la necesite.
 *
 *  El handshake TLS cuesta dos o tres segundos y hay que pagarlo una vez. La
 *  pregunta no es si se paga, es **quién espera mientras**: si la primera
 *  petición es la de un cliente con la tarjeta apoyada, la paga él, parado
 *  frente a la canilla, creyendo que no funciona.
 *
 *  Acá se paga en el arranque, mientras todavía se está imprimiendo el banner y
 *  no hay nadie esperando nada.
 *
 *    Es precalentar el pool de conexiones al levantar el servidor en vez de
 *    que el primer request del día se coma la latencia. */
bool redCalentar(uint32_t cierresPendientes);

/** POST /rpc/reportar_progreso. Es lo que hace que el vaso de la pantalla de la
 *  canilla se llene **en vivo** mientras sale la cerveza.
 *
 *  Es puramente estético y no participa de la plata: si no llega, el cobro sale
 *  igual. Por eso se manda sin reintentos y sin bloquear nada — un adorno que
 *  frenara una venta sería un mal negocio. */
bool redReportarProgreso(int64_t sesionId, uint32_t ml, uint32_t pulsos);
