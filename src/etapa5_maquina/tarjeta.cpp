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
static const uint8_t AUSENTE_TRAS = 3;         // 3 × 100 ms = 300 ms

static char     uidActual[21] = "";
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
 *  `PICC_WakeupA` despierta una tarjeta ya seleccionada, que es lo que hace
 *  falta acá: no queremos leerla de nuevo, queremos saber si todavía está. */
static bool sigueAhi() {
  byte buffer[2];
  byte largo = sizeof(buffer);
  MFRC522::StatusCode estado = lector.PICC_WakeupA(buffer, &largo);
  bool presente = (estado == MFRC522::STATUS_OK ||
                   estado == MFRC522::STATUS_COLLISION);
  lector.PICC_HaltA();
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
    lector.PICC_HaltA();
    return;
  }

  // Ya hay una: solo nos interesa si se fue, con el debounce de arriba.
  if (sigueAhi()) { fallosSeguidos = 0; return; }
  if (++fallosSeguidos < AUSENTE_TRAS) return;

  fallosSeguidos = 0;
  uidActual[0] = '\0';
}

bool        tarjetaPresente() { return uidActual[0] != '\0'; }
const char *tarjetaUid()      { return uidActual; }
