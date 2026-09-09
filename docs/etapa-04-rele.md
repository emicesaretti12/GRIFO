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

### El jumper `H`/`L`: qué hace cada posición

El conector tiene **tres patitas**. El jumper puentea la del medio con una de las
dos puntas, y eso elige por dónde entra la corriente al optoacoplador.

Medido sobre este módulo, con `DC+`/`DC-` a 12 V y el `IN` **sin ningún cable**:

| Jumper | `IN` suelto mide | Se activa cuando el `IN` va a | Sirve |
|---|---|---|---|
| medio + derecha (`H`) | **0 V** | **`DC+`** (12 V) | ✗ |
| medio + izquierda (`L`) | **11,3 V** | **`DC-`** (masa) | ✅ |
| sin jumper | 0 V | nada | ✗ |

**La posición de este proyecto es `L`.**

En `L` el `IN` queda colgado arriba, cerca de los 12 V, y el relé se activa
**tirándolo abajo**. El estado de reposo es "no hacer nada", que es justo lo que
queremos que pase mientras el ESP32 arranca.

En `H` haría falta poner 12 V en el `IN` para activarlo, y eso el ESP32 no lo
puede dar de ninguna manera.

### Lo que esto obliga

En `L`, el `IN` es un cable que está a **11,3 V**. Un pin del ESP32 tolera 3,3.
**No se pueden conectar directo**, ni siquiera con el pin en alta impedancia.

Y tampoco alcanza con "poner el pin en alto": el ESP32 llega a 3,3 V, y con el
otro lado en 12 V quedan varios volts sobre el LED del optoacoplador, que sigue
conduciendo. El relé quedaría trabado en activado.

La corriente que hay que manejar es chica: medida en serie entre `IN` y `DC-`,
**4,9 mA**, que a 12 V corresponde a una resistencia interna de 2,2 k. Lo que
falta no es fuerza, es **aislación**.

De ahí sale la solución de la sección siguiente.

---

## La solución: open-drain + un canal libre del conversor

Dos mediciones sobre el módulo real definen el problema:

| Medición | Valor | Qué implica |
|---|---|---|
| Corriente que absorbe el `IN` (en serie contra `DC-`) | **4,9 mA** | Un GPIO tolera ~20 mA. Entra sobrado. |
| Tensión del `IN` al aire contra `DC-` (jumper en `L`) | **11,3 V** | Muy arriba de 3,3. **No se conecta directo.** |

La primera dice que el ESP32 tiene fuerza de sobra. La segunda dice que no puede
tocar ese cable: un pin en alta impedancia quedaría expuesto a 11 V, muy arriba
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
| `HIGH` (desconectado) | cortado | queda en ~11 V | en reposo |

Los 11 V **nunca llegan al ESP32**: se quedan del lado HV. El ESP32 solo ve su
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

## Antes de tocar nada

Leé **[protocolo-electrico.md](protocolo-electrico.md)**. Son seis reglas y el
checklist en frío. En esta etapa se quemó un ESP32 y esas reglas son la respuesta
a eso.

Las dos que más importan acá:

- **Cable de masa fijo atornillado en `DC-`.** Es la única punta que se usa para
  tocar contra masa. La mano no se acerca a la bornera.
- **El `DC+` tapado con cinta.** No se toca con nada, nunca.

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

## Procedimiento por fases

Cada fase tiene **una sola cosa energizada a la vez**, y termina en un dato
concreto. No se pasa a la siguiente sin ese dato.

El principio: **el ESP32 y los 12 V nunca están los dos vivos mientras haya
manos en el circuito.**

### Fase 0 — en frío

Nada enchufado: sin USB, sin 12 V.

1. Correr el **checklist en frío** del protocolo (continuidad entre rieles).
2. Atornillar el **cable de masa fijo** en `DC-`.
3. **Tapar el `DC+`** con cinta.
4. Jumper del relé en **`L`**.
5. Cablear: `IN` del relé → `C35` (`HV4`). **El `P26` todavía no.**

→ Todo abierto en el checklist. Si algo da unido, no se sigue.

### Fase 1 — solo el relé

Enchufar **los 12 V**. El USB **no**.

1. ¿El relé queda quieto? (sin zumbar ni clickear solo)
2. Con el **cable de masa fijo**, tocar la punta libre contra `B35`.

→ Tiene que **clickear al tocar y volver a clickear al soltar**.

Esto prueba el relé, el jumper y el cable del `IN`, sin que el ESP32 exista
todavía. Si acá no clickea, el problema no es del ESP32 y no tiene sentido
seguir.

### Fase 2 — verificar la barrera

Con los 12 V puestos, enchufar **el USB**. El `P26` sigue **sin conectar**.

Tester en `V⎓` escala `20`. Punta negra en el **cable de masa fijo**, punta roja
en **`G35`**.

| Lectura | |
|---|---|
| **≤ 3,3 V** | ✅ el MOSFET está aislando. Seguir. |
| **más de 3,5** | ❌ parar. El conversor está al revés o el hueco está mal. |

Este es el número que decide si el ESP32 puede tocar ese cable. Con el lado HV en
11 V, acá tiene que haber 3,3.

### Fase 3 — grabar

**Desenchufar los 12 V.** Dejar solo el USB.

```bash
pio run -e etapa4_rele -t upload
```

Con los 12 V puestos el flasheo se corta a la mitad. Van separados.

### Fase 4 — conectar y probar

1. Desenchufar el USB.
2. Conectar **`P26` → `G35`**.
3. Enchufar los **12 V**, después el **USB**.
4. Abrir el monitor: `pio device monitor -b 115200`

**De acá en adelante no se toca nada con las manos.** El sketch maneja el pin y
el autotest informa solo.

---

## Qué tenés que ver

Al arrancar:

```
=============================================
 GRIFO DE CERVEZA - ETAPA 4: RELE
=============================================
Pin de control    : GPIO 26
Modo              : OPEN-DRAIN
...
SILENCIO por 5 segundos.
```

**Durante esos 5 segundos, silencio absoluto.** El sketch no maneja el pin.

Después, el autotest:

```
--- AUTOTEST DE LA LINEA ---
  cable llega al conversor : SI
  el pin la tira abajo     : SI
  => La linea electrica esta bien.
----------------------------
```

El autotest reemplaza los tests con la mano. Contesta la pregunta de si el
problema está del lado del ESP32 o del lado del relé, **sin tocar nada**:

| `conectado` | `tiraAbajo` | Qué significa |
|---|---|---|
| SI | SI | La línea está bien. Si no clickea, es del lado del relé. |
| NO | SI | El cable no llega al conversor, o no está en `P26`. |
| SI | NO | Algo mantiene la línea arriba. Revisar que no toque `3V3`. |

Y después el ciclo:

```
--- Empieza el ciclo. ---

[   6000 ms] ACTIVADO  - valvula ABIERTA   (GPIO26 a masa)
[   7000 ms] reposo    - valvula cerrada   (GPIO26 desconectado)
```

Un clic por segundo, alternando.

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

**Mirá primero el autotest.** Para eso está: te dice de qué lado buscar sin que
tengas que tocar nada.

**Autotest `SI`/`SI` pero no clickea** → la línea del ESP32 está bien. El
problema es del lado del relé:

1. ¿El jumper está en `L`? (medio + izquierda)
2. Con los 12 V puestos y el USB afuera, tocá `B35` con el cable de masa fijo.
   Si ahí clickea, el canal del conversor no está conduciendo.
3. Si tampoco clickea, revisá el cable entre `C35` y el tornillo `IN`, y que el
   tornillo esté apretado sobre el cobre y no sobre el plástico.

**Autotest `NO`/`SI`** → el cable no llega al conversor. O la punta hembra no
está sobre `P26`, o el otro extremo no está en `G35`.

**Clickea durante los 5 segundos de silencio** → algo maneja el GPIO26 antes que
nuestro código. Avisame: es el problema más importante de esta etapa y no se pasa
por alto.

**Queda zumbando o pegado** → el optoacoplador conduce a medias. Medí `G35`
contra el cable de masa fijo: si no alterna entre ~0 y ~3,3, el pin no está
manejando la línea.

---

## Lo que se aprendió acá, a los golpes

- El módulo no se caracteriza leyendo las etiquetas. Se mide.
- El LED de alimentación está siempre prendido y no dice nada.
- La posición útil del jumper es **`L`**, y en `L` el `IN` está a 11 V: **no
  puede tocar el ESP32**.
- Los 3,3 V no apagan este optoacoplador. Hace falta cortar, no bajar.
- **Un procedimiento que pide acertarle con una punta suelta al lado de un borne
  de 12 V es un procedimiento roto.** Costó un ESP32 aprenderlo.
