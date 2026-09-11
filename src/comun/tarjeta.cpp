#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>
#include "tarjeta.h"

static const uint8_t PIN_SS  = 5;
static const uint8_t PIN_RST = 22;

static MFRC522 lector(PIN_SS, PIN_RST);

static const uint32_t PERIODO_MS = 100;

// ── Por qué hace falta un debounce de RETIRADA ──────────────────────────────
// El MFRC522 falla una lectura cada tanto aunque la tarjeta esté ahí: basta una
// mano que se mueve o un instante de ruido. Sin filtro, ese fallo aislado se
// leería como "el cliente retiró la tarjeta".
//
// Y retirar la tarjeta es lo que **liquida la sesión y cobra**. Un falso
// "retirada" a mitad de una pinta le corta la cerveza al cliente y le cobra
// media.
//
//   Es un reintento antes de dar la conexión por caída. Un timeout de 300 ms
//   para un evento que factura.
// Subido de 3 a 5 después de ver falsos negativos en la etapa 5. El costo de
// esperar de más son 200 ms para liquidar; el costo de equivocarse es cortarle
// la cerveza a un cliente a mitad de la pinta y cobrarle media.
//
//   Cuando los dos errores no cuestan lo mismo, el umbral no va en el medio.
static const uint8_t AUSENTE_TRAS = 5;         // 5 × 100 ms = 500 ms

static char     uidActual[21] = "";
static uint32_t apoyadaEn = 0;
static uint8_t  fallosSeguidos = 0;
static uint32_t ultimoChequeo = 0;

/** El UID como texto en mayúsculas sin separadores: "61FB7A54".
 *  Mismo formato que imprime la etapa 2 y que guarda `tarjetas.uid` en
 *  Supabase. Que los tres coincidan no es casualidad: es lo que permite pegar
 *  un UID del monitor directo en una consulta. */
static void uidATexto(const MFRC522::Uid &uid, char *salida, size_t largo) {
  size_t i = 0;
  for (byte b = 0; b < uid.size && i + 2 < largo; b++) {
    i += snprintf(salida + i, largo - i, "%02X", uid.uidByte[b]);
  }
  salida[i] = '\0';
}

/** ¿Sigue apoyada la misma tarjeta?
 *
 *  ── El detalle que hace que esto funcione ─────────────────────────────────
 *
 *  Una tarjeta MIFARE tiene su propia máquina de estados, y `WUPA` (despertar)
 *  **solo lo contesta si está dormida**. Al contestarlo queda despierta.
 *
 *  Entonces hay que volver a dormirla antes del próximo chequeo, o el siguiente
 *  `WUPA` no obtiene respuesta y el firmware cree que la retiraron.
 *
 *  Y dormirla tiene su propio requisito: `PICC_HaltA` solo funciona sobre una
 *  tarjeta **seleccionada**. Después del `WUPA` está despierta pero todavía no
 *  seleccionada, así que hay que completar la selección con `PICC_ReadCardSerial`
 *  antes del `HaltA`.
 *
 *  Sin ese paso del medio, el `HaltA` no hace nada, la tarjeta queda despierta,
 *  y a los ~300 ms el sistema liquida una sesión que nadie cerró.
 *
 *    Es mandarle al otro sistema el evento correcto desde el estado equivocado.
 *    No te da error: te ignora.
 */
static bool sigueAhi() {
  byte buffer[2];
  byte largo = sizeof(buffer);
  MFRC522::StatusCode estado = lector.PICC_WakeupA(buffer, &largo);
  bool presente = (estado == MFRC522::STATUS_OK ||
                   estado == MFRC522::STATUS_COLLISION);

  if (presente) {
    lector.PICC_ReadCardSerial();   // completa el select, para que el halt valga
    lector.PICC_HaltA();            // la duerme de nuevo para el próximo chequeo
  }
  return presente;
}

bool tarjetaIniciar() {
  SPI.begin();
  lector.PCD_Init();
  delay(50);                                   // el MFRC522 tarda un toque en arrancar
  lector.PCD_SetAntennaGain(MFRC522::RxGain_max);

  byte version = lector.PCD_ReadRegister(MFRC522::VersionReg);
  return (version == 0x91 || version == 0x92);
}

void tarjetaActualizar(uint32_t ahora) {
  if (ahora - ultimoChequeo < PERIODO_MS) return;
  ultimoChequeo = ahora;

  if (uidActual[0] == '\0') {
    // No hay ninguna: buscamos una nueva.
    if (!lector.PICC_IsNewCardPresent()) return;
    if (!lector.PICC_ReadCardSerial())   return;
    uidATexto(lector.uid, uidActual, sizeof(uidActual));
    fallosSeguidos = 0;
    apoyadaEn = ahora;
    lector.PICC_HaltA();
    return;
  }

  // Ya hay una: solo nos interesa si se fue, con el debounce de arriba.
  if (sigueAhi()) { fallosSeguidos = 0; return; }
  if (++fallosSeguidos < AUSENTE_TRAS) return;

  // Cuánto duró la lectura. Si acá aparecen tiempos de medio segundo con la
  // tarjeta quieta sobre el lector, el chequeo de presencia está fallando y hay
  // que mirarlo: una sesión no se liquida sola.
  uint32_t decimas = (ahora - apoyadaEn) / 100;
  Serial.printf("[tarjeta] %s retirada tras %lu.%lu s\n",
                uidActual, (unsigned long)(decimas / 10),
                (unsigned long)(decimas % 10));

  fallosSeguidos = 0;
  uidActual[0] = '\0';
}

bool        tarjetaPresente() { return uidActual[0] != '\0'; }
const char *tarjetaUid()      { return uidActual; }
