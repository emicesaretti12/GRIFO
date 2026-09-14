#pragma once
// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — el portal de configuración
//
// ── El problema del huevo y la gallina ──────────────────────────────────────
// "Quiero configurar el WiFi desde la app" choca con algo que no tiene vuelta:
// **la app viaja por WiFi**. Si la canilla todavía no está conectada, no hay
// forma de mandarle nada.
//
// La salida es que la canilla levante SU PROPIA red. Deja de ser cliente y pasa
// a ser el router: aparece una red "GRIFO-1", te conectás con el celular, se
// abre sola una página, elegís la red del bar y ponés la clave. Se guarda en
// NVS y a partir de ahí se conecta sola para siempre.
//
//   Es el mismo truco del `wizard` de un router nuevo, o del modo recovery de
//   un sistema operativo: cuando la vía normal no está disponible, el aparato
//   levanta una vía mínima que no depende de nada de afuera.
//
// ── Cuándo arranca ──────────────────────────────────────────────────────────
//   · No hay ninguna red guardada (canilla nueva).
//   · Hay una guardada pero no conecta, y no quedaba red anterior a la cual
//     volver.
//   · Alguien mantiene apretado el botón de la canilla mientras arranca.
//
// Esa última es la que salva el día cuando el bar cambió la clave del WiFi y no
// hay una notebook a mano.
//
// ── Lo que el portal NO hace ────────────────────────────────────────────────
// No muestra ni deja cambiar el token de la canilla. El portal es una red
// abierta a cualquiera que esté cerca: lo que se puede hacer desde ahí es lo
// mínimo para que vuelva a haber red, y nada más.
//
//   Es el principio de menor privilegio aplicado a una pantalla de rescate.
// ═════════════════════════════════════════════════════════════════════════════

#include <stdint.h>

/** Levanta el access point y el servidor. `clave` puede ser NULL o corta para
 *  una red abierta, pero conviene ponerle una: mientras el portal está arriba,
 *  cualquiera que se conecte puede cambiarle la red a la canilla. */
void portalArrancar(const char *nombreAp, const char *clave);

bool portalActivo();

/** Atiende una vuelta de peticiones. Se llama seguido desde la tarea de red.
 *  **Nunca desde la tarea de control.** */
void portalAtender();

/** true cuando alguien ya grabó credenciales desde el portal. El que llama
 *  decide qué hacer con eso — normalmente, reiniciar. */
bool portalGuardoWifi();

void portalParar();
