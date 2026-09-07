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

## El protoboard entra ya en esta etapa, como adaptador de género

Las dos plaquitas terminan en **pines machos**. Unir macho con macho pide un
cable **hembra-hembra**, y los que hay en el proyecto son macho-macho y
macho-hembra. Así que el protoboard no entra acá como "bus compartido" —para eso
recién hace falta en la etapa 5, cuando cuatro componentes necesiten GND— sino
para convertir un macho en agujeros hembra.

Se probaron tres montajes antes de dar con el que funciona. Vale la pena dejar
por qué fallaron los otros dos:

**Clavar el ESP32 en el protoboard: no anda con esta placa.** Sus pines vienen
soldados de fábrica con el plástico abajo y quedan demasiado cortos: la placa no
se hunde más y no llega a tocar los contactos internos. El síntoma es
inconfundible —midiendo 3V3 contra GND daba 0, y apretando la placa con el dedo
subía a 0,5 V y volvía a caer— y es contacto intermitente, no un problema de
software. Además, aunque entrara, sus rótulos están en la cara de abajo y
quedarían tapados.

**Clavar el lector: depende de cómo se soldó la tira.** Si los pines quedaron
del lado de los rótulos, clavarlo apoya la cara rotulada contra el protoboard y
se pierde de vista qué pin es cuál, que era justamente la ventaja.

**Lo que sí funciona: nada clavado.** Las dos plaquitas quedan sueltas y el
protoboard hace solo de punto de encuentro. Cada conexión usa **dos** cables
macho-hembra:

```
[pin del ESP32] ←capuchón─cable─pinchito→ ┐
                                          ├─ misma fila del protoboard
[pin del lector] ←capuchón─cable─pinchito→ ┘
```

Los capuchones abrazan los pines (que son machos) y los pinchitos entran en los
agujeros (que son hembras). Todo encaja, nada depende de que una placa entre a
presión, y **los rótulos de las dos plaquitas quedan a la vista**.

Cuesta 14 cables en vez de 7. Para un banco de pruebas que se desarma el mismo
día, es un precio barato a cambio de que no haya nada que pueda quedar flojo.

---

## Cableado

Con el ESP32 **desenchufado**, siete filas del protoboard, dos cables cada una:

| Fila | ESP32 | Lector |
|---|---|---|
| 1 | `P5` | `SDA` |
| 2 | `P18` | `SCK` |
| 3 | `P19` | `MISO` |
| 4 | `GND` | `GND` |
| 5 | `P22` | `RST` |
| 6 | `P23` | `MOSI` |
| 7 | `3V3` ⚠️ | `3.3V` |
| — | — | `IRQ` queda al aire |

**Una sola conexión por fila.** Dos conexiones distintas en la misma fila unen
dos pines del ESP32 entre sí.

El pin `IRQ` queda al aire a propósito: sirve para que el módulo avise por
interrupción, y no lo usamos.

### Verificar el 3.3V con el tester antes de conectarlo

Es el único error de esta etapa que rompe algo, y se descarta en dos minutos con
el multímetro. Con el ESP32 suelto:

1. Capuchón de un cable en el pin `3V3`, capuchón de otro en cualquier `GND`
   (los tres `GND` de la placa están unidos entre sí).
2. Perilla del tester en **`20`**, en la zona de **voltaje continuo** (`V⎓`).
   Nunca en la zona `A`: ahí se mide corriente y se conecta distinto.
3. Enchufar el USB y tocar con las puntas el metal de los dos pinchitos.

Tiene que dar **~3,3 V**. En la placa del proyecto dio **3,32 V**. Si diera
cerca de 5, es el otro pin y no hay que conectar el lector.

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

## Resultado ✅ ACEPTADA

Verificado en la placa, con el montaje de dos cables por conexión:

```
[ 140139 ms] TARJETA  UID=61FB7A54  (4 bytes)  tipo=MIFARE 1KB   #1
[ 140739 ms] RETIRADA UID=61FB7A54  estuvo 0.6 s

[ 146339 ms] TARJETA  UID=61FB7A54  (4 bytes)  tipo=MIFARE 1KB   #2
[ 149739 ms] RETIRADA UID=61FB7A54  estuvo 3.4 s

[ 254139 ms] TARJETA  UID=E46D94E5  (4 bytes)  tipo=MIFARE 1KB   #3
[ 257939 ms] RETIRADA UID=E46D94E5  estuvo 3.8 s
```

Los tres criterios que importaban:

- **La misma tarjeta dio el mismo UID las dos veces.** Es el punto central: el
  UID es la clave primaria de todo el sistema. Si bailara, no hay cuenta que
  cierre.
- **Dos objetos distintos dieron UIDs distintos.**
- **Detecta apoyar y retirar**, con el tiempo que estuvo. Retirar la tarjeta es
  lo que en el sistema final liquida la sesión y cobra.

### UIDs reales del proyecto

| Objeto | UID | Tipo |
|---|---|---|
| Tarjeta | `61FB7A54` | MIFARE 1KB, 4 bytes |
| Llavero | `E46D94E5` | MIFARE 1KB, 4 bytes |

Sirven para dar de alta tarjetas de prueba en Supabase sin inventar UIDs.

### Lo que quedó confirmado además

- **La placa no se resetea.** Los timestamps corren por los 140 y 254 segundos
  sin volver a cero. La basura que aparece al abrir el monitor es el mensaje del
  bootloader a 74880 baud, no un boot loop.
- **No hace falta leer la versión del chip si el lector lee.** Un módulo muerto
  no puede devolver un UID. El chequeo de versión sirve para diagnosticar cuando
  NO anda, no para confirmar que anda.

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
