# Etapa 2 — Lector RFID solo

**Necesita:** ESP32 + cable USB + módulo MFRC522 + tarjetas + 7 cables dupont
hembra-hembra.

**No conectes nada más.** Ni el relé, ni el caudalímetro, ni la fuente de 12V.
Esta etapa prueba una sola cosa.

---

## ⚠️ Lo único que puede romper algo

**El MFRC522 va a 3.3V. Con 5V se quema.**

El módulo tiene un pin marcado `3.3V` y el ESP32 tiene uno marcado `3V3`. Esos
dos van juntos. El ESP32 también tiene un pin `VIN` o `5V` — **ese no se toca en
esta etapa.**

Antes de enchufar el USB, mirá el cable de alimentación y confirmá que sale del
pin `3.3V` del módulo y llega al `3V3` de la placa. Es el único error de esta
etapa que no se arregla con software.

---

## Cómo se leen los pines de ESTA placa

La placa del proyecto es una **NodeMCU ESP-32S v1.1**, de 38 pines, con
micro-USB. Dos particularidades que conviene tener anotadas:

1. **Los nombres de los pines están impresos del lado de ABAJO**, no del lado
   del módulo metálico.
2. **El prefijo es `P`, no `D` ni `GPIO`.** El pin que en el código se llama
   `GPIO5` acá dice **`P5`**.

Las dos filas, tal como están impresas:

```
fila A:  3V3  EN  SVP  SVN  P34 P35 P32 P33 P25 P26 P27 P14 P12 GND P13 SD2 SD3 GND 5V
fila B:  CLK  SD0 SD1  P15  P2  P0  P4  P16 P17 P5  P18 P19 GND P21 RX  TX  P22 P23 GND
```

**Los cinco pines de datos del lector caen todos en la fila B.** El único que
cruza a la fila A es la alimentación.

### La orientación, verificada en la placa real

Con los **rótulos hacia arriba** y el **USB apuntando hacia abajo**:

|  | Pegado al USB | En la punta opuesta |
|---|---|---|
| Columna izquierda (fila B) | `CLK` | `GND` |
| Columna derecha (fila A) | `5V` ⚠️ | `3V3` ✅ |

Los dos pines de alimentación caen en **puntas opuestas de la misma columna**, y
el peligroso es el que está pegado al USB. Es la mejor casualidad de esta placa:
no hay que contar nada para no equivocarse en el único error caro.

Ojo con la cara: **mirando los rótulos, la fila B queda a la izquierda; dando
vuelta la placa queda a la derecha.** Es un espejo, como cualquier objeto.

### Contando desde el USB

**Fila B**, contando desde el extremo del USB:

| Pos | Pin | ¿Lo usamos? |
|---|---|---|
| 1 | `CLK` | — |
| 2 | `SD0` | — |
| 3 | `SD1` | — |
| 4 | `P15` | — |
| 5 | `P2` | — |
| 6 | `P0` | — |
| 7 | `P4` | — |
| 8 | `P16` | — |
| 9 | `P17` | — |
| **10** | **`P5`** | ✅ SDA |
| **11** | **`P18`** | ✅ SCK |
| **12** | **`P19`** | ✅ MISO |
| **13** | **`GND`** | ✅ el GND del lector |
| 14 | `P21` | — |
| 15 | `RX` | — |
| 16 | `TX` | — |
| **17** | **`P22`** | ✅ RST |
| **18** | **`P23`** | ✅ MOSI |
| 19 | `GND` | — |

Dos cosas que hacen esto mucho menos propenso a error de lo que parece:

- **Las posiciones 10 a 13 son cuatro pines consecutivos** — `P5 P18 P19 GND` —
  y ahí van cuatro de los siete cables.
- **`P22` y `P23` son vecinos**, y quedan a 3 y 2 pines del extremo opuesto al
  USB. Contados desde esa punta son mucho más fáciles de encontrar que desde el
  USB.

Aun así, la forma segura de identificar un pin es **leer el rótulo**, no contar
19 pines. Conviene marcar los siete con cinta mirando los rótulos, y recién
después dar vuelta la placa para conectar.

---

## Por qué el protoboard entra ya en esta etapa

Las dos plaquitas terminan en **pines machos**. Unir macho con macho pide un
cable **hembra-hembra**, y los que hay en el proyecto son macho-macho y
macho-hembra. Así que el protoboard no entra acá como "bus compartido" —para eso
recién hace falta en la etapa 5, cuando cuatro componentes necesiten GND— sino
como **adaptador de género**.

El montaje que resuelve eso con lo que hay:

1. Los **8 pines del lector** se clavan en el protoboard, en 8 números
   consecutivos de una misma letra. Los rótulos del lector quedan **hacia
   arriba y legibles**, que es justo lo que se necesita.
2. Cada cable **macho-hembra** va con el **macho al agujero de al lado** (misma
   línea de 5, o sea el mismo número) y la **hembra directo al pin del ESP32**.

El ESP32 queda suelto, sin clavar en el protoboard. A propósito: sus rótulos
están en la cara de abajo, y enchufado al protoboard quedarían tapados.

---

## Cableado

Con el ESP32 **desenchufado**, 7 cables:

| MFRC522 | → | ESP32 | Cómo encontrarlo |
|---|---|---|---|
| `3.3V` | → | `3V3` ⚠️ | fila A, la punta más lejos del USB |
| `SDA` | → | `P5` | fila B, posición 10 |
| `SCK` | → | `P18` | fila B, posición 11 |
| `MISO` | → | `P19` | fila B, posición 12 |
| `GND` | → | `GND` | fila B, posición 13 |
| `RST` | → | `P22` | fila B, posición 17 |
| `MOSI` | → | `P23` | fila B, posición 18 |
| `IRQ` | → | *(nada)* | queda al aire |

El pin `IRQ` queda al aire a propósito: sirve para que el módulo avise por
interrupción, y no lo usamos.

### Hay que soldarle la tira de pines al lector

El MFRC522 viene con los 8 contactos como **agujeros pelados** y la tira de
pines suelta en la bolsita — vienen dos, una recta y una en L. Va la **recta**:
apoya el plástico contra la plaqueta y se queda quieta sola mientras soldás, que
con la de 90° hay que sostenerla.

Apoyar los pines en los agujeros sin soldar **no funciona de forma confiable**:
anda un rato, después no, y te vuelve loco buscando un bug de software que no
existe. Son 8 puntos de soldadura, diez minutos.

---

## Flashear

```bash
pio run -e etapa2_rfid -t upload
pio device monitor -b 115200
```

La primera vez va a bajar la librería `MFRC522` (son unos segundos, no los
cientos de MB del toolchain de la etapa 1).

---

## Qué tenés que ver

Al arrancar:

```
=============================================
 GRIFO DE CERVEZA - ETAPA 2: LECTOR RFID
=============================================
Version del chip  : 0x92  (MFRC522 v2.0 — OK)
---------------------------------------------
Apoya una tarjeta sobre el modulo.
---------------------------------------------
```

La versión tiene que dar **`0x91`** o **`0x92`**. Si da `0x00` o `0xFF`, el
módulo no está contestando: el propio programa te imprime la lista de qué
revisar, en orden.

Apoyando y retirando una tarjeta:

```
[  12400 ms] TARJETA  UID=A1B2C3D4  (4 bytes)  tipo=MIFARE 1KB   #1
[  15100 ms] RETIRADA UID=A1B2C3D4  estuvo 2.7 s
```

El LED azul de la placa queda **prendido mientras la tarjeta está apoyada** y se
apaga al retirarla. Sirve para ver qué está pasando sin mirar la pantalla.

---

## Criterio de aceptación

- ✅ La versión del chip da `0x91` o `0x92`.
- ✅ Apoyando una tarjeta sale su UID.
- ✅ Retirándola sale `RETIRADA` con el tiempo que estuvo.
- ✅ La misma tarjeta da **siempre el mismo UID**.
- ✅ Dos tarjetas distintas dan UIDs distintos.

Ese anteúltimo punto es el que importa de verdad: el UID es la llave primaria de
todo el sistema. Si una tarjeta cambia de UID entre lecturas, no hay cuenta que
cierre.

**Anotá el UID de una de tus tarjetas.** Lo vamos a usar para darla de alta en
Supabase y probar el circuito completo.

---

## Por qué el sketch hace lo que hace

### Solo avisa cuando algo CAMBIA

El lector puede leer la tarjeta ~10 veces por segundo. Si imprimiéramos cada
lectura, una tarjeta apoyada 3 segundos llenaría la consola de 30 líneas
idénticas. El sketch guarda el UID actual y solo habla cuando aparece uno nuevo
o desaparece el que había.

Es exactamente un `if (nuevo !== anterior)` antes de un `setState`: no
reaccionamos al valor, reaccionamos al **cambio** de valor.

### Detectar que la retiraron cuesta más que detectarla

`PICC_IsNewCardPresent()` solo avisa de tarjetas **nuevas**. Una vez leída, la
tarjeta queda en estado `HALT` y deja de contestar aunque siga apoyada. Para
saber si sigue ahí hay que despertarla a propósito con `WakeupA`.

Esto importa: en el sistema final **retirar la tarjeta es lo que liquida la
sesión y cobra**. Un lector que no distingue "apoyada" de "retirada" no puede
cerrar una cuenta.

### El debounce de 300 ms

Una tarjeta quieta sobre la antena falla un chequeo cada tanto — es radio, no un
cable. Por eso hacen falta **3 chequeos fallidos seguidos** para darla por
retirada.

Es el mismo debounce que le ponés a un input de búsqueda para no disparar una
request por tecla. Solo que acá no es cosmético: un falso "retirada" a mitad de
una pinta le corta la cerveza al cliente y le cobra media.

### El formato del UID

Se imprime en hexadecimal, **mayúsculas, sin separadores**: `A1B2C3D4`. Es
exactamente el formato que usa `normalizarUid()` en la app y el que guarda la
columna `tarjetas.uid` en Supabase.

Que los tres coincidan no es cosmético: si el firmware manda `a1:b2:c3:d4` y la
base tiene `A1B2C3D4`, la tarjeta "no existe" y nadie entiende por qué.

### Sin `delay()`

El loop chequea `millis()` y sale. Es la misma disciplina que va a regir la
máquina de estados de la etapa 5, donde un `delay()` con la válvula abierta
significa cerveza en el piso.

---

## Si no anda

**Versión `0x00` o `0xFF`** → el módulo no contesta. Por orden de probabilidad:
alimentación en el pin equivocado, GND sin conectar, pines sin soldar, un dupont
flojo, o el módulo vino muerto (pasa, son baratos).

**Versión OK pero no lee ninguna tarjeta** → probá apoyarla plana y centrada
sobre la bobina (el rectángulo grande impreso), no en el borde. El sketch ya
sube la ganancia de la antena al máximo.

**Lee y a los pocos segundos deja de leer** → casi siempre es un dupont flojo o
pines sin soldar.

**Sale basura en el monitor** → velocidad equivocada, tiene que ser 115200.
