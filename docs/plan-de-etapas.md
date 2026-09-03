# Plan de etapas

Regla de oro: **no se avanza a la etapa siguiente hasta que la anterior funcione
en la placa física.** Cada etapa prueba una sola pieza de hardware.

El orden está armado según lo que hay disponible hoy, no según la lógica del
sistema. Por eso el relé va cuarto y no segundo.

| # | Etapa | Hardware que necesita | Estado |
|---|---|---|---|
| 1 | Blink | solo cable USB | ✅ **aceptada** |
| 2 | Lector RFID solo | ⏳ cables dupont | 🔵 próxima |
| 3 | Caudalímetro solo | ⏳ cables dupont | pendiente |
| 4 | Relé solo | ⏳ módulo relé | pendiente |
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
**Necesita:** cables dupont (⏳ no llegaron).
**Objetivo:** leer el UID de una tarjeta y mostrarlo por Serial. Incluye el
chequeo de versión del chip (`PCD_DumpVersionToSerial`) para descartar un módulo
muerto de fábrica, que es bastante común en los MFRC522 baratos.
**Se acepta cuando:** la versión da `0x91` o `0x92`, y apoyando una tarjeta se ve
el UID en hexa.

## Etapa 3 — Caudalímetro solo
**Necesita:** cables dupont (⏳ no llegaron). Antes hay que medir con el tester
entre el cable amarillo y el rojo del sensor, desconectado, para ver si trae
pull-up interno.
**Objetivo:** conteo de pulsos con el periférico **PCNT** del ESP32 (no con una
ISR) y filtro de glitch. Imprime pulsos acumulados y pulsos por segundo.
**Se acepta cuando:** soplando el sensor el contador sube, y quieto no sube nada.
Eso último es lo que confirma que el pull-up está bien puesto y que no está
entrando ruido.

## Etapa 4 — Relé solo
**Necesita:** módulo relé 1 canal 5V activo en LOW (⏳ no llegó).
**Objetivo:** solo GPIO26, un clic por segundo, con el orden de inicialización
correcto. Sin válvula conectada todavía.
**Se acepta cuando:** se escucha el clic, y **al resetear la placa el relé NO se
activa durante el arranque**. Ese segundo punto es el que importa de verdad — ver
la trampa del pin flotante en [`pinout-y-trampas.md`](pinout-y-trampas.md).

## Etapa 5 — Los tres juntos, sin red
**Objetivo:** máquina de estados completa con saldo y precio hardcodeados. Sin
WiFi, sin Supabase. Válvula todavía sin conectar, solo el relé haciendo clic.
Estados: `ESPERANDO` → `AUTORIZANDO` → `LISTO` ⇄ `SIRVIENDO` → `LIQUIDANDO` →
`ESPERANDO`, más `RECHAZADO` para saldo insuficiente.
**Se acepta cuando:** se apoya la tarjeta, se aprieta el botón, cuenta pulsos,
corta al llegar al límite, y al retirar la tarjeta imprime el ticket por Serial.

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
