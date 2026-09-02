# Etapa 1 — Blink

**Necesita:** solo el cable USB. Nada de protoboard, nada de dupont, nada de
fuentes. No conectes ningún módulo todavía.

## Qué prueba

1. Que el toolchain compila.
2. Que el driver CP2102 anda y la PC ve el puerto serie.
3. Que podemos escribir el flash de la placa.
4. Que la placa arranca y corre nuestro código.

Nada más. Si algo de esto falla, mejor descubrirlo ahora con un LED que en la
etapa 5 con cinco módulos conectados.

## Cableado

```
ESP32  ──[ cable USB ]──  PC
```

Eso es todo. En serio.

## Sobre los LEDs de la placa

La placa tiene **dos** LEDs y confundirlos es normal:

| LED | Color | Qué significa |
|---|---|---|
| **PWR / ON** | rojo, fijo | La placa tiene alimentación. Prende solo con enchufar el USB. **El firmware no lo controla.** |
| **LED de usuario** | azul, chiquito | Está en el GPIO2. Este es el que tiene que **parpadear** con nuestro código. |

Que prenda el rojo fijo apenas enchufás es lo esperado y no confirma nada más
que "llega corriente". El que confirma la etapa es el azul parpadeando.

## Cómo flashear

```bash
pio run -e etapa1_blink -t upload
pio device monitor -b 115200
```

O en VSCode: botón **→** (Upload) y después **🔌** (Serial Monitor) en la barra
de estado de abajo. Ver el [README](../README.md) para el paso a paso completo.

## Qué tenés que ver

El LED azul chiquito parpadeando 1 vez por segundo (500 ms prendido, 500 ms
apagado), y en el monitor serial a **115200 baud**:

```
=============================================
 GRIFO DE CERVEZA — ETAPA 1: BLINK
=============================================
---------------------------------------------
Revision del chip : 1
CPU               : 240 MHz
Flash             : 4194304 bytes
Heap libre        : 298765 bytes
MAC (eFuse)       : 3C61052E1F4C
---------------------------------------------
Si ves esto y el LED chiquito parpadea, la etapa 1 esta OK.

[  500 ms] LED ON
[ 1000 ms] LED OFF
[ 1500 ms] LED ON
```

Los valores exactos de revisión, flash, heap y MAC van a ser distintos en tu
placa — eso está bien. Lo que importa es que **salgan**, no cuánto valen.

## Criterio de aceptación

- ✅ El LED azul parpadea.
- ✅ Sale el texto por Serial a 115200.

Si ves basura tipo `␀␀ÿýÿ` en vez de texto legible, el monitor está a otra
velocidad. Tiene que ser **115200**.

Cuando esto ande, avisá y pasamos a la etapa 2 (lector RFID) — que necesita los
cables dupont.

## Si no flashea

Ver [`troubleshooting-flasheo.md`](troubleshooting-flasheo.md).
