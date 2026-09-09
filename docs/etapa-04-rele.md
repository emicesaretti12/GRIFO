# Etapa 4 — Relé solo

**Necesita:** el módulo relé, la fuente de 12V y tres cables.

**La válvula NO se conecta.** Los bornes de salida del relé quedan al aire. Esta
etapa solo escucha el clic.

---

## Cómo se comporta este módulo (medido, no leído)

El módulo es un **SRD-12VDC-SL-C** con optoacoplador y un jumper marcado `H`/`L`.
Las etiquetas no alcanzan para decidir nada: hubo que medirlo.

### Primero, el LED que confunde

El módulo tiene **dos LEDs**. Uno es de **alimentación** y está prendido siempre
que hay 12 V, pase lo que pase. El otro, **rojo**, es el que indica que el relé
está activado.

Mirar el equivocado cuesta media hora: parece que el relé está trabado en
activado cuando en realidad está en reposo.

**El indicador que no miente es el relé mismo.** Tester en `Ω`, escala `200`,
puntas en los tornillos `COM` y `NO`:

| Lectura | Estado |
|---|---|
| `1` (circuito abierto) | relé **en reposo** |
| `0` (cerrado) | relé **activado** |

Una vez identificado el LED rojo, el clic y el LED rojo alcanzan.

### La tabla de verdad del módulo

En la posición correcta del jumper, con `DC+`/`DC-` a los 12 V:

| `IN` | Relé |
|---|---|
| **suelto**, sin conectar | **en reposo** ✅ |
| a **masa** (`DC-`) | **activado** |
| a **3,3 V** | activado |
| a **5 V** | activado |

Los dos últimos renglones son el problema: con `DC+` en 12 V, poner 3,3 V en el
`IN` **no alcanza para cortar** la corriente del optoacoplador. Quedan 8,7 V
sobre el LED interno y sigue conduciendo. El relé se activa y **no se suelta
nunca**.

Por eso conectar el `P26` directo al `IN` deja el relé trabado en activado,
aunque el pin alterne limpio entre 0 y 3,4 V.

### Cómo identificar la posición correcta del jumper

No por la letra. Así:

1. `DC+` y `DC-` al cargador de 12V. El `IN` **vacío**.
2. Mirar el **LED rojo**.

- **Apagado** → posición correcta. Y tocando `IN` contra `DC-` tiene que clickear.
- **Prendido** → posición equivocada. En la otra posición este módulo pedía
  **12 V** en el `IN` para activarse, que es inútil para una placa de 3,3.

---

## La solución: open-drain + un canal libre del conversor

Dos mediciones sobre el módulo real definen el problema:

| Medición | Valor | Qué implica |
|---|---|---|
| Corriente que absorbe el `IN` (en serie contra `DC-`) | **4,9 mA** | Un GPIO tolera ~20 mA. Entra sobrado. |
| Tensión del `IN` al aire contra `DC-` | **4,88 V** | Más de 3,3. **No se conecta directo.** |

La primera dice que el ESP32 tiene fuerza de sobra. La segunda dice que no puede
tocar ese cable: un pin en alta impedancia quedaría expuesto a casi 5 V, arriba
de su máximo absoluto (3,6 V).

### La parte que no hay que comprar

El **conversor de niveles** que ya está en el protoboard para el caudalímetro
tiene **4 canales** y usa uno solo. Cada canal es un MOSFET, que es exactamente
el transistor que hacía falta.

```
   P26 ── LV4 ─┤MOSFET├─ HV4 ── IN del relé
   GND ─────────────────────────  DC- del relé
```

| `P26` (open-drain) | MOSFET | `IN` | Relé |
|---|---|---|---|
| `LOW` (a masa) | conduce | llevado a ~0 V | **activado** |
| `HIGH` (desconectado) | cortado | queda en 4,88 V | en reposo |

Los 4,88 V **nunca llegan al ESP32**: se quedan del lado HV. El ESP32 solo ve su
propio lado, que está a 3,3 V por la resistencia de pull-up del conversor.

> Es un adaptador de tipos en el borde del sistema. Adentro trabajás con tu tipo;
> el borde traduce. El tipo de afuera no se te mete nunca en la lógica.

### Por qué open-drain y no un `OUTPUT` normal

El módulo no se apaga con 3,3 V: con `DC+` en 12 V quedan varios volts sobre el
LED del optoacoplador y sigue conduciendo. El renglón bueno de la tabla no pide
una tensión, pide **ausencia**.

Open-drain es justo eso: el pin deja de elegir entre 0 V y 3,3 V y elige entre
**"a masa"** y **"desconectado"**.

> En software: un pin común devuelve `false`. En open-drain devuelve `undefined`.
> No es lo mismo decir "no" que no decir nada — y este relé solo descansa cuando
> nadie le dice nada.

Y es el modo que estos conversores esperan: están pensados para I2C, que es
open-drain.

### El arranque sigue siendo seguro

Antes de que corra `setup()`, el `GPIO26` es una entrada: alta impedancia. El
lado LV queda en 3,3 V por su pull-up, el MOSFET no conduce, el `IN` queda
arriba → **relé en reposo, válvula cerrada**.

El estado seguro es el estado por defecto del silicio, no algo que dependa de que
nuestro código llegue a ejecutarse. Un reset a mitad de una pinta cierra la
canilla en vez de abrirla.

Con la placa apagada del todo pasa lo mismo: sin `LV`, el MOSFET está cortado y
el `IN` queda arriba.

### Si algún día no hay conversor libre

Un NPN de bajo lado hace lo mismo por monedas:

```
   P26 ──[ 1k ]── base       NPN (2N2222 / BC547 / S8050)
   colector ── IN del relé
   emisor   ── DC- del relé
```

Mismo firmware, salvo que el nivel se invierte: `HIGH` = activado.

---

## Cableado

Con el ESP32 **desenchufado** y la fuente de 12V **desenchufada**:

| Desde | → | Adónde |
|---|---|---|
| `DC+` del relé | → | positivo de la fuente de 12V |
| `DC-` del relé | → | negativo de la fuente de 12V **y también al `GND` del ESP32** |
| `IN` del relé | → | **`HV4`** del conversor de niveles |
| **`HV4`** del conversor | → | (es el mismo punto de arriba) |
| `P26` del ESP32 | → | **`LV4`** del conversor |

El `IN` **no va al ESP32**. Va al conversor, y el conversor va al ESP32.

Los bornes de salida del relé (los tres tornillos del otro lado, junto al cubo
azul) **quedan vacíos** en esta etapa.

### Cómo quedó en este protoboard

El conversor está pinchado en las filas **30 a 35**, con los pines del lado HV en
la columna `e` y los del lado LV en la columna `f`. El orden de las patitas es:

| Fila | Lado HV (a-e) | Lado LV (f-j) | Uso |
|---|---|---|---|
| 30 | `HV1` | `LV1` | caudalímetro (etapa 3) |
| 31 | `HV2` | `LV2` | libre |
| 32 | `HV` = 5 V | `LV` = 3,3 V | alimentación |
| 33 | `GND` | `GND` | masa común |
| 34 | `HV3` | `LV3` | libre |
| 35 | `HV4` | `LV4` | **relé (esta etapa)** |

Entonces, en concreto: `IN` del relé → `C35`, y `P26` del ESP32 → `G35`.

El `GND` del lado LV puede quedar vacío: en estas plaquitas los dos `GND` son el
mismo nodo. Si el canal no responde, ese es el primer lugar donde mirar.

### El `DC-` va a los dos lados, y no es opcional

El negativo de la fuente de 12V tiene que unirse al `GND` del ESP32.

El voltaje no es un valor absoluto, es una **diferencia**. Cuando el ESP32 pone
3,3 V en el `IN`, quiere decir "3,3 V más que mi GND". Si el relé mide contra
otro GND, ese 3,3 no le dice nada: está comparando contra otra base.

> Es un `git diff` sin decir contra qué commit.

Sin ese cable el circuito no anda, o anda a veces, que es peor.

---

## Flashear

```bash
pio run -e etapa4_rele -t upload
pio device monitor -b 115200
```

---

## Qué tenés que ver

```
=============================================
 GRIFO DE CERVEZA - ETAPA 4: RELE
=============================================
Pin de control    : GPIO 26
Nivel activo      : ALTO (jumper en H)
---------------------------------------------
SILENCIO por 5 segundos.
El rele NO tiene que hacer NINGUN clic ahora.
...
---------------------------------------------
```

**Durante esos 5 segundos, silencio absoluto.** El sketch no toca el pin.

Después:

```
--- Fin del silencio. Empieza el ciclo. ---

[   6000 ms] ACTIVADO  - valvula ABIERTA   (GPIO26 a masa)
[   7000 ms] reposo    - valvula cerrada   (GPIO26 desconectado)
[   8000 ms] ACTIVADO  - valvula ABIERTA   (GPIO26 a masa)
```

Un clic por segundo, alternando. El módulo suele tener un LED que se prende
cuando el relé está activado.

---

## Criterio de aceptación

- ✅ Se escucha el clic, un cambio por segundo.
- ✅ **Al resetear la placa (botón `EN`), el relé NO hace ningún clic durante los
  5 segundos de silencio.**

**El segundo es el que importa de verdad.** El primero solo dice que el relé
funciona. El segundo dice que un corte de luz en el bar no abre las canillas.

Probá el reset **tres o cuatro veces**. Tiene que ser silencio las cuatro.

---

## Si no anda

**No clickea nunca** → es lo que pasó en este proyecto: los 3,3 V no alcanzan
para el optoacoplador. Ver *La solución: open-drain*, más arriba. Antes de
darlo por eso, confirmá con el tester que el `IN` alterna entre 0 y 3,3: si se
queda fijo, el problema es de cableado y no de nivel.

**Clickea pero queda zumbando o pegado** → el optoacoplador está conduciendo a
medias. Mismo caso que el anterior, misma solución.

**Clickea durante los 5 segundos de silencio** → algo está manejando el GPIO26
antes que nuestro código. Avisame: es el problema más importante de esta etapa y
no se pasa por alto.

**Clickea al revés** (activado cuando dice reposo) → el jumper quedó en `L`.
Desenchufá todo antes de moverlo: en `L` el `IN` tiene 12 V y no puede estar
conectado al ESP32.
