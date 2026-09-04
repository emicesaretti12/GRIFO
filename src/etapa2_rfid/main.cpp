// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — ETAPA 2: lector RFID solo
//
// Prueba UNA cosa: que el MFRC522 esté vivo, bien cableado, y que podamos leer
// el UID de una tarjeta.
//
// Nada de relé, nada de caudalímetro, nada de WiFi. Si esto no anda, no tiene
// sentido seguir: el UID es la llave de todo el sistema.
//
// CABLEADO (¡el módulo va a 3.3V, NUNCA a 5V!):
//
//     MFRC522        ESP32
//     ─────────────────────
//     SDA (SS)  →    GPIO 5
//     SCK       →    GPIO 18
//     MOSI      →    GPIO 23
//     MISO      →    GPIO 19
//     RST       →    GPIO 22
//     3.3V      →    3V3
//     GND       →    GND
//     IRQ       →    (no se conecta)
// ═════════════════════════════════════════════════════════════════════════════

#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>

static const uint8_t PIN_SS  = 5;
static const uint8_t PIN_RST = 22;
static const uint8_t PIN_LED = 2;

MFRC522 lector(PIN_SS, PIN_RST);

// ─────────────────────────────────────────────────────────────────────────────
// Estado
// ─────────────────────────────────────────────────────────────────────────────
// Guardamos el UID de la tarjeta que está apoyada AHORA. Sin esto, el lector
// dispararía una lectura nueva ~20 veces por segundo mientras la tarjeta está
// quieta sobre la antena, y el Serial sería una catarata inútil.
//
// Es lo mismo que un `if (nuevoValor !== valorAnterior)` antes de un setState:
// no reaccionamos al valor, reaccionamos al CAMBIO de valor.
static char uidActual[21] = "";
static uint32_t apoyadaEn = 0;
static uint32_t ultimoChequeo = 0;
static uint32_t lecturas = 0;
static uint8_t  fallosSeguidos = 0;

// Cada cuánto miramos la antena. 100 ms es imperceptible para una persona y
// deja al procesador libre el 99% del tiempo.
static const uint32_t PERIODO_MS = 100;

// Cuántos chequeos fallidos seguidos hacen falta para dar la tarjeta por
// retirada. Con uno solo alcanzaría... si la radio fuera perfecta. No lo es:
// una tarjeta quieta sobre la antena falla un chequeo cada tanto, sobre todo
// si quedó medio corrida.
//
// Es un debounce, el mismo que le ponés a un input de búsqueda para no disparar
// una request por tecla. Y acá no es cosmético: en el sistema final RETIRAR la
// tarjeta liquida la sesión y corta el chorro. Un falso "retirada" a mitad de
// una pinta le corta la cerveza al cliente y le cobra media.
static const uint8_t AUSENTE_TRAS = 3;      // 3 x 100 ms = 300 ms


/** Pasa el UID crudo a hexa en MAYÚSCULA y sin separadores: "A1B2C3D4".
 *  Ese es exactamente el formato que espera `normalizarUid()` en la app y el
 *  que guarda la columna `tarjetas.uid` en Supabase. Que los tres coincidan no
 *  es cosmético: si el firmware manda "a1:b2:c3:d4" y la base tiene "A1B2C3D4",
 *  la tarjeta simplemente "no existe" y nadie entiende por qué. */
static void uidATexto(const MFRC522::Uid &uid, char *salida, size_t largo) {
  size_t i = 0;
  for (byte b = 0; b < uid.size && i + 2 < largo; b++) {
    i += snprintf(salida + i, largo - i, "%02X", uid.uidByte[b]);
  }
  salida[i] = '\0';
}

/** ¿Sigue habiendo una tarjeta sobre la antena?
 *
 *  `PICC_IsNewCardPresent()` solo avisa de tarjetas NUEVAS: una vez leída, la
 *  tarjeta queda en estado HALT y deja de responder aunque siga apoyada. Para
 *  saber si sigue ahí hay que despertarla con WakeupA.
 *
 *  El COLLISION también cuenta como "sí": significa que respondieron varias
 *  tarjetas a la vez. No sabemos cuál es, pero hay algo apoyado. */
static bool hayTarjeta() {
  byte buffer[2];
  byte largo = sizeof(buffer);
  MFRC522::StatusCode estado = lector.PICC_WakeupA(buffer, &largo);
  bool presente = (estado == MFRC522::STATUS_OK || estado == MFRC522::STATUS_COLLISION);
  lector.PICC_HaltA();
  return presente;
}

/** Lee la versión del chip. 0x91 y 0x92 son los MFRC522 buenos.
 *  0x00 y 0xFF significan "no me está contestando nadie": o el cableado está
 *  mal, o el módulo vino muerto de fábrica (pasa bastante en los baratos). */
static byte versionDelChip() {
  return lector.PCD_ReadRegister(MFRC522::VersionReg);
}

static void explicarVersion(byte v) {
  Serial.printf("Version del chip  : 0x%02X  ", v);
  switch (v) {
    case 0x91: Serial.println("(MFRC522 v1.0 — OK)");            break;
    case 0x92: Serial.println("(MFRC522 v2.0 — OK)");            break;
    case 0x88: Serial.println("(clon FM17522 — suele andar)");   break;
    case 0x00:
    case 0xFF:
      Serial.println("(NO RESPONDE)");
      Serial.println();
      Serial.println("  El modulo no esta contestando. Revisa, en este orden:");
      Serial.println("   1. Alimentacion: el pin 3.3V del modulo va al 3V3 del ESP32.");
      Serial.println("      Si lo pusiste en 5V, el modulo puede haberse quemado.");
      Serial.println("   2. GND del modulo al GND del ESP32.");
      Serial.println("   3. SDA->5  SCK->18  MOSI->23  MISO->19  RST->22");
      Serial.println("   4. Que los dupont hagan contacto: tira suave de cada uno.");
      Serial.println("   5. Que las patas esten SOLDADAS al modulo. Apoyadas no alcanza.");
      break;
    default:
      Serial.println("(desconocida — puede ser un clon, seguimos igual)");
      break;
  }
}


void setup() {
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);

  Serial.begin(115200);
  delay(300);                       // le damos tiempo al puerto USB a levantar

  Serial.println();
  Serial.println("=============================================");
  Serial.println(" GRIFO DE CERVEZA - ETAPA 2: LECTOR RFID");
  Serial.println("=============================================");

  SPI.begin();                      // VSPI: SCK=18, MISO=19, MOSI=23
  lector.PCD_Init();
  delay(50);                        // el MFRC522 tarda un toque en arrancar

  byte v = versionDelChip();
  explicarVersion(v);

  // Ganancia de la antena al máximo. De fábrica viene a la mitad, y con las
  // tarjetas finas de PVC eso se nota: hay que apoyarlas casi tocando. No es
  // trampa ni fuerza nada, es el registro que el fabricante deja configurable.
  lector.PCD_SetAntennaGain(MFRC522::RxGain_max);
  lector.PCD_AntennaOn();

  Serial.println("---------------------------------------------");
  Serial.println("Apoya una tarjeta sobre el modulo.");
  Serial.println("---------------------------------------------");
  Serial.println();
}


void loop() {
  uint32_t ahora = millis();

  // Sin delay(): el loop no se bloquea nunca. Es la misma disciplina que va a
  // regir la maquina de estados de la etapa 5, donde un delay() con la valvula
  // abierta significa cerveza en el piso.
  if (ahora - ultimoChequeo < PERIODO_MS) return;
  ultimoChequeo = ahora;

  bool habiaTarjeta = (uidActual[0] != '\0');

  if (!habiaTarjeta) {
    // ── No había nada: buscamos una tarjeta nueva ──────────────────────────
    if (!lector.PICC_IsNewCardPresent()) return;
    if (!lector.PICC_ReadCardSerial())   return;

    uidATexto(lector.uid, uidActual, sizeof(uidActual));
    apoyadaEn = ahora;
    lecturas++;
    fallosSeguidos = 0;

    MFRC522::PICC_Type tipo = lector.PICC_GetType(lector.uid.sak);

    digitalWrite(PIN_LED, HIGH);    // destello: se leyo algo
    Serial.printf("[%7lu ms] TARJETA  UID=%s  (%d bytes)  tipo=",
                  ahora, uidActual, lector.uid.size);
    // PICC_GetTypeName devuelve un puntero a texto en flash, no un char*
    // comun: va con Serial.print, que sabe leerlo, y no con printf("%s").
    Serial.print(MFRC522::PICC_GetTypeName(tipo));
    Serial.printf("   #%lu\n", lecturas);

    lector.PICC_HaltA();
    return;
  }

  // ── Ya había una tarjeta: la única pregunta es si la retiraron ───────────
  // Esto importa mas de lo que parece. En el sistema final, RETIRAR la tarjeta
  // es lo que liquida la sesion y cobra. Si el lector no distingue "apoyada"
  // de "retirada", no hay forma de cerrar una cuenta.
  if (hayTarjeta()) { fallosSeguidos = 0; return; }
  if (++fallosSeguidos < AUSENTE_TRAS) return;

  fallosSeguidos = 0;
  digitalWrite(PIN_LED, LOW);
  // En decimas de segundo, con enteros. Imprimir un float en un
  // microcontrolador se paga en memoria, y acá no compra nada.
  uint32_t decimas = (ahora - apoyadaEn) / 100;
  Serial.printf("[%7lu ms] RETIRADA UID=%s  estuvo %lu.%lu s\n",
                ahora, uidActual, decimas / 10, decimas % 10);
  Serial.println();
  uidActual[0] = '\0';
}
