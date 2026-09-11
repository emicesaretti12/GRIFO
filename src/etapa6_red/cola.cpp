#include <Arduino.h>
#include <Preferences.h>
#include "cola.h"

// NVS es un almacén clave-valor en la flash del ESP32, con desgaste repartido.
// Sobrevive al reset y al corte de luz, que es justamente lo que necesitamos.
static Preferences nvs;

// ── Por qué hay un candado acá adentro ──────────────────────────────────────
// Dos tareas tocan esta cola: la de control escribe el cierre apenas termina la
// tirada, y la de red saca el primero cuando el servidor confirma. Corren en
// núcleos distintos y de verdad en paralelo.
//
// El candado va **adentro del módulo**, no en quien lo usa. Si estuviera
// afuera, cada lugar que llama tendría que acordarse de tomarlo, y alcanza con
// que uno se olvide.
//
//   Es poner la transacción adentro del repositorio en vez de confiar en que
//   cada handler la abra.
static SemaphoreHandle_t candado = NULL;

struct Candado {
  Candado()  { if (candado) xSemaphoreTake(candado, portMAX_DELAY); }
  ~Candado() { if (candado) xSemaphoreGive(candado); }
};

// Índices monótonos: `ini` es el próximo a entregar, `fin` el próximo a
// escribir. No se reinician nunca; el hueco real sale de un módulo.
//
// Guardarlos así en vez de guardar "cantidad" evita el caso feo: si el corte de
// luz pasa entre escribir el dato y actualizar el índice, la peor consecuencia
// es reenviar un cierre que ya se entregó. Y eso es inofensivo, porque
// `cerrar_sesion` es idempotente del lado del servidor: la segunda vez devuelve
// `repetida: true` y no vuelve a cobrar.
//
//   El diseño elige el error que se puede tolerar. Entregar dos veces se
//   arregla con idempotencia; perder una entrega no se arregla con nada.
static uint32_t ini = 0;
static uint32_t fin = 0;

static void claveDe(uint32_t indice, char *salida, size_t largo) {
  snprintf(salida, largo, "q%lu", (unsigned long)(indice % COLA_CAPACIDAD));
}

void colaIniciar() {
  if (!candado) candado = xSemaphoreCreateMutex();
  Candado c;
  nvs.begin("grifo", false);
  ini = nvs.getUInt("ini", 0);
  fin = nvs.getUInt("fin", 0);
  if (fin < ini) { ini = 0; fin = 0; }    // por las dudas: NVS corrupta
}

static uint32_t cantidadSinCandado() { return fin - ini; }

uint32_t colaCantidad() { Candado c; return cantidadSinCandado(); }
bool     colaLlena()    { Candado c; return cantidadSinCandado() >= COLA_CAPACIDAD; }

bool colaEncolar(const Pendiente &p) {
  Candado c;
  if (cantidadSinCandado() >= COLA_CAPACIDAD) return false;

  char clave[8];
  claveDe(fin, clave, sizeof(clave));

  // El dato ANTES que el índice. Si se corta la luz en el medio, el dato quedó
  // escrito pero invisible: se pierde una entrega, no se corrompe la cola.
  // Al revés —índice primero— se leería basura como si fuera una venta.
  if (nvs.putBytes(clave, &p, sizeof(p)) != sizeof(p)) return false;

  fin++;
  nvs.putUInt("fin", fin);
  return true;
}

bool colaVerPrimero(Pendiente &p) {
  Candado c;
  if (cantidadSinCandado() == 0) return false;
  char clave[8];
  claveDe(ini, clave, sizeof(clave));
  return nvs.getBytes(clave, &p, sizeof(p)) == sizeof(p);
}

void colaSacarPrimero() {
  Candado c;
  if (cantidadSinCandado() == 0) return;
  ini++;
  nvs.putUInt("ini", ini);
  // El blob no se borra: lo pisa el próximo que caiga en ese hueco. Borrarlo
  // sería una escritura más a la flash sin ningún beneficio.
}
