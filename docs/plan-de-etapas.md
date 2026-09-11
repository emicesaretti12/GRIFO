# Plan de etapas

Regla de oro: **no se avanza a la etapa siguiente hasta que la anterior funcione
en la placa física.** Cada etapa prueba una sola pieza de hardware.

El orden está armado según lo que hay disponible hoy, no según la lógica del
sistema. Por eso el relé va cuarto y no segundo.

| # | Etapa | Hardware que necesita | Estado |
|---|---|---|---|
| 1 | Blink | solo cable USB | ✅ **aceptada** |
| 2 | Lector RFID solo | ✅ | ✅ **aceptada** |
| 3 | Caudalímetro solo | ✅ | ✅ **aceptada** |
| 4 | Relé solo | ✅ | 🔵 **en curso** |
| 5 | Los tres juntos, sin red | — | pendiente |
| 6 | Supabase + cola offline | — | pendiente |
| 7 | Calibración con agua | probeta, agua | pendiente |
| 8 | Pantalla | ❓ display sin definir | pendiente |

---

## Etapa 1 — Blink
**Necesita:** solo el cable USB.
**Objetivo:** confirmar toolchain, driver CP2102 y que podemos flashear.
**Se acepta cuando:** se ve el LED parpadear y sale algo por Serial a 115200.
**Detalle:** [`etapa-01-blink.md`](etapa-01-blink.md)

✅ **ACEPTADA.** LED azul (GPIO2) parpadeando y banner por Serial a 115200,
verificado en la placa. Lo que dejó de aprendizaje: esta placa no tolera el
flasheo a 460800 — ver `upload_speed` en `platformio.ini`.

## Etapa 2 — Lector RFID solo
**Necesita:** módulo MFRC522, tarjetas y 7 cables dupont.
**Objetivo:** leer el UID de una tarjeta y mostrarlo por Serial, y detectar
también cuándo la retiran — que es lo que en el sistema final liquida la sesión.
Incluye el chequeo de versión del chip para descartar un módulo muerto de
fábrica, bastante común en los MFRC522 baratos.
**Se acepta cuando:** la versión da `0x91` o `0x92`, apoyando una tarjeta se ve
el UID en hexa, retirándola se ve `RETIRADA`, y la misma tarjeta da siempre el
mismo UID.
**Detalle:** [`etapa-02-rfid.md`](etapa-02-rfid.md)

✅ **ACEPTADA.** Tarjeta `61FB7A54` y llavero `E46D94E5`, los dos MIFARE 1KB,
leídos y retirados repetidamente en la placa. Lo que dejó de aprendizaje: este
ESP32 **no se puede clavar en el protoboard** (sus pines vienen cortos y no
hacen contacto), así que el banco de pruebas va con las dos plaquitas sueltas y
dos cables macho-hembra por conexión.

## Etapa 3 — Caudalímetro solo
**Necesita:** el caudalímetro y una resistencia de 10k. Antes hay que medir con el tester
entre el cable amarillo y el rojo del sensor, desconectado, para ver si trae
pull-up interno.
**Objetivo:** conteo de pulsos con el periférico **PCNT** del ESP32 (no con una
ISR) y filtro de glitch. Imprime pulsos acumulados y pulsos por segundo.
**Se acepta cuando:** soplando el sensor el contador sube, y quieto no sube nada.
Eso último es lo que confirma que el pull-up está bien puesto y que no está
entrando ruido.
**Detalle:** [`etapa-03-caudalimetro.md`](etapa-03-caudalimetro.md)

Medido en el sensor del proyecto: con el amarillo suelto y el sensor alimentado
a 5 V, el amarillo da **1,28 V** — está flotando, **no trae pull-up interno**.
El pull-up lo pone el conversor de niveles, que además impide que la señal
supere los 3,3 V.

✅ **ACEPTADA.** Quieto no cuenta ni un pulso; soplando llegó a 495 pulsos por
segundo sin perder ninguno. Lo que costó: los pinchitos dupont **no hacían
contacto dentro del conector del sensor**, con la turbina girando perfecto. Se
cortó el conector y se soldaron los tres cables.

## Etapa 4 — Relé solo
**Necesita:** el módulo relé (llegó un **SRD-12VDC-SL-C**, de 12V y no de
5V: se alimenta de la fuente de 12V, no del ESP32) y la fuente de 12V.
**Objetivo:** solo GPIO26, un clic por segundo, con el orden de inicialización
correcto. Sin válvula conectada todavía.
**Detalle:** [`etapa-04-rele.md`](etapa-04-rele.md)

⚠️ **Cambió todo el esquema de manejo respecto del plan original.** Medido sobre
el módulo que llegó, el jumper va en **`L`**: en `H` haría falta poner 12 V en el
`IN` para activarlo, cosa que el ESP32 no puede hacer. En `L` el `IN` queda
colgado en **11,3 V** y el relé se activa tirándolo a masa — que es lo que
queremos, porque entonces el reposo es "no hacer nada".

Pero 11,3 V no pueden tocar un pin que tolera 3,3. La solución salió sin comprar
nada: **un canal libre del conversor de niveles** (canal 4) hace de transistor y
de aislación a la vez, y el GPIO26 se maneja en **open-drain**, que elige entre
"a masa" y "desconectado" en vez de entre 0 y 3,3 V.

**Se acepta cuando:** se escucha el clic, y **al resetear la placa el relé NO se
activa durante el arranque**. Ese segundo punto es el que importa de verdad — ver
la trampa del pin flotante en [`pinout-y-trampas.md`](pinout-y-trampas.md).

✅ **ACEPTADA.** Conmuta (`COM`–`NO` pasa de `1` a `0,12`) y hace silencio en los
cuatro resets.

Lo que costó: **un ESP32 quemado.** Un test manual tocó `DC+` (12 V) en vez de
`DC-`; los dos tornillos están a un centímetro. El `3V3` quedó en corto con masa.
De ahí salió [`protocolo-electrico.md`](protocolo-electrico.md) y el autotest de
la línea en el firmware, que contesta por serie lo que antes se averiguaba
tocando cables.

### ⚠️ Pendiente para la etapa 5: el conflicto del riel HV

El relé anduvo recién cuando se **desconectó el riel `HV` del conversor** de los
5 V. Con el riel en 5 V, su pull-up de 10k arrastraba el `IN` de 11,3 V a
**9,9 V**, y esos 2,1 V de diferencia dejaban pasar ~0,45 mA por el
optoacoplador: poco para activar el relé, suficiente para **mantenerlo pegado**
una vez activado. Nunca soltaba.

Pero el caudalímetro (etapa 3) usaba ese mismo riel en 5 V para su pull-up. Los
dos no pueden convivir así. Opciones a evaluar cuando se integren:

1. Dejar el riel `HV` desconectado y que el caudalímetro tome el pull-up del
   **pull-up interno del ESP32** por el lado LV (`PULLUP_INTERNO = true` en la
   etapa 3). Hay que verificar que el sensor siga contando.
2. Alimentar el sensor de caudal a **3,3 V** en vez de 5 V. Si cuenta igual, no
   necesita conversor y el canal 4 queda solo, sin conflicto.
3. Un segundo conversor. Cuesta plata y es la última opción.

**No llevar el riel `HV` a 12 V**: eso mete 12 V sobre la protoboard, al lado de
los cables del ESP32, que es exactamente el riesgo que costó la primera placa.

## Etapa 5 — Los tres juntos, sin red
**Objetivo:** máquina de estados completa con saldo y precio hardcodeados. Sin
WiFi, sin Supabase. Válvula todavía sin conectar, solo el relé haciendo clic.
Estados: `ESPERANDO` → `AUTORIZANDO` → `LISTO` ⇄ `SIRVIENDO` → `LIQUIDANDO` →
`ESPERANDO`, más `RECHAZADO` para saldo insuficiente.
**Se acepta cuando:** se apoya la tarjeta, se aprieta el botón, cuenta pulsos,
corta al llegar al límite, y al retirar la tarjeta imprime el ticket por Serial.
**Detalle:** [`etapa-05-maquina.md`](etapa-05-maquina.md)

✅ **ACEPTADA.** El ciclo completo anduvo y el corte dio exacto:

```
 Servido   : 1111 ml  (500 pulsos)
 Cobrado   : $5000,00
 Saldo     : $0,00
```

500 pulsos sobre un límite de 500, y el cobro igual al saldo al centavo. También
se vieron funcionar el failsafe de "abierta sin pulsos", el rechazo por saldo
insuficiente, y el arranque con la válvula cerrada tras cuatro resets.

### Lo que costó

**1. El caudalímetro anda a 3,3 V.** Era la incógnita que decidía si había que
comprar un transistor para el relé. Anda: contó 500 pulsos soplando. El conversor
de niveles queda para el relé solo y **no hubo que comprar nada**.

**2. Un falso "tarjeta retirada" cada 300 ms**, que liquidaba la sesión sola. La
tarjeta tiene su propia máquina de estados: `WUPA` solo lo contesta una tarjeta
dormida, y al contestarlo queda despierta. Había que volver a dormirla, y
`PICC_HaltA` solo funciona sobre una tarjeta **seleccionada** — faltaba el
`PICC_ReadCardSerial` del medio. Sin él el halt no hacía nada y el chequeo
siguiente no obtenía respuesta.

El mismo bug estaba en el sketch de la etapa 2 desde el principio, y no se notó
porque ahí solo se apoyaba y se sacaba la tarjeta sin dejarla quieta.

**3. El corte llegaba tarde: 515 pulsos sobre 500**, o sea 33 ml regalados. El
`if` del límite estaba después de hablar con el lector, y esa charla por SPI toma
milisegundos que a caudal de servicio son pulsos que ya salieron. Moviéndolo al
principio del loop el exceso pasó de 15 pulsos a cero.

> Es poner el guard al principio del handler. Lo que va después puede tardar; la
> decisión de cortar, no.

### ⚠️ Anotado para la instalación

Durante las pruebas apareció cinco veces en 35 segundos:

```
[tarjeta] se recupero reiniciando el lector
```

El MFRC522 se cuelga cada tanto y el último recurso lo levanta. La sesión se
salva, pero **esa frecuencia es demasiada**. Es ruido en el SPI por la longitud
del recorrido (ESP32 → protoboard → lector). En la canilla el lector va a 20 cm,
con cable corto y directo. **Si sigue apareciendo con cables cortos, hay un
problema de fondo y hay que mirarlo.**

## Etapa 6 — Supabase + cola offline
**Objetivo:** sumar `tareaRed` (core 0, prioridad baja), las dos RPC
(`abrir_sesion` / `cerrar_sesion`) y la persistencia en NVS. Incluye el SQL de
las funciones a crear en Supabase y la config de RLS.
**Se acepta cuando:** funciona con red, y si se corta el WiFi a mitad de una
tirada la válvula cierra igual y la transacción se sincroniza al volver.

🟢 **La mitad servidor ya está hecha, aplicada y verificada en el proyecto real** (se adelantó porque no depende
del hardware): esquema, las dos RPC, RLS y suite de pruebas en `supabase/`.
Ver [`backend-supabase.md`](backend-supabase.md). Falta la parte del firmware:
`tareaRed`, el cliente HTTP y la cola en NVS.

## Etapa 7 — Calibración con agua
**Necesita:** probeta y **agua de la canilla de red**, no un recipiente elevado.
La válvula FPD-270A necesita 0.02 MPa (0.2 bar ≈ 2 m de columna de agua) para
abrir, así que por gravedad desde un bidón no abre. Ver
[`pinout-y-trampas.md`](pinout-y-trampas.md).
**Objetivo:** sketch aparte para medir el factor `pulsos_por_litro`. Se sirve un
litro medido con probeta y se calcula. Se guarda en NVS.
**Se acepta cuando:** sirviendo 500 ml de agua el sistema reporta 500 ml ±2%.

## Etapa 8 — Pantalla
**Objetivo original:** un TFT ILI9341/ST7789 en HSPI, con los stubs `uiXXX()`.

🟢 **Resuelta por otro camino, y ya está hecha.** Cargar el logo de cada cerveza
y un fondo animado interactivo no entra en un TFT de 320×240. En su lugar, cada
canilla tiene una **tablet, celular o monitor mostrando una página web** de este
mismo sistema en modo kiosco, que se vincula por QR con el token del grifo.

Ventaja grande: **no hay firmware nuevo que mantener**, y cambiar un precio o una
foto no implica reflashear nada.

Ver [`pantalla-canilla.md`](pantalla-canilla.md). Lo único que le queda al
firmware es llamar a `reportar_progreso()` cada ~500 ms mientras sirve, para que
el vaso de la pantalla se llene en vivo — y es opcional: si no llega, la pantalla
funciona igual.

El TFT sigue disponible como versión mínima si alguna canilla no justifica una
pantalla; las dos comen del mismo backend.
