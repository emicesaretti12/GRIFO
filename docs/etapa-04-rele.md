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

## La solución: un transistor NPN

El transistor hace de amplificador: el ESP32 le da una señal minúscula a la base
y el transistor conmuta la corriente de verdad.

> Es un adaptador de interfaz. El ESP32 no puede hablar el protocolo que el relé
> escucha; el transistor traduce, sin que ninguno de los dos cambie.

```
   P26 ──[ 1k ]── base
                        NPN (2N2222 / BC547 / S8050)
   colector ── IN del relé
   emisor   ── DC- del relé (que ya es el GND común)
```

| `P26` | Transistor | `IN` | Relé |
|---|---|---|---|
| `HIGH` | conduce | llevado a ~0 V | **activado** |
| `LOW` | cortado | queda suelto | en reposo |

### Por qué esto sí funciona

El transistor **corta de verdad**. Cuando está cortado, el `IN` queda en alta
impedancia —igual que desconectado— y ahí el relé está en reposo, que es
justamente el renglón bueno de la tabla de arriba. El ESP32 nunca tiene que
"poner el `IN` en alto": solo deja de tirarlo abajo.

Y el ESP32 nunca toca el `IN`: lo toca el colector. La placa solo ve su
resistencia de base.

### El firmware no cambia

`NIVEL_ACTIVO` sigue en `HIGH`: señal alta del ESP32 = válvula abierta.

Y se conserva lo que importa: al arrancar, el `P26` flotando queda cerca de 0 V,
el transistor no conduce, el `IN` queda suelto y **el relé en reposo**. Válvula
cerrada sin corriente, sin código, sin nada.

### Lo que hay que comprar

- **Un transistor NPN de uso general**: `2N2222`, `BC547`, `S8050` o `PN2222`.
  Cualquiera sirve, cuestan monedas. Llevá tres o cuatro.
- **Una resistencia de 1k** (marrón · negro · rojo). Entre 330 Ω y 4,7 k anda
  igual.
- Unas **10k** de repuesto, que en este proyecto aparecen seguido.

---

## Cableado

Con el ESP32 **desenchufado** y la fuente de 12V **desenchufada**:

| Módulo relé | → | Adónde |
|---|---|---|
| `DC+` | → | positivo de la fuente de 12V |
| `DC-` | → | negativo de la fuente de 12V **y también al `GND` del ESP32** |
| `IN` | → | `P26` del ESP32 |

Los bornes de salida (los tres tornillos del otro lado, junto al cubo azul)
**quedan vacíos**.

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

[   6000 ms] ACTIVADO  - valvula ABIERTA   (GPIO26 = HIGH)
[   7000 ms] reposo    - valvula cerrada   (GPIO26 = LOW)
[   8000 ms] ACTIVADO  - valvula ABIERTA   (GPIO26 = HIGH)
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
para el optoacoplador. Ver *La solución: un transistor*, más arriba. Antes de
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
