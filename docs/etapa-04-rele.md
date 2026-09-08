# Etapa 4 — Relé solo

**Necesita:** el módulo relé, la fuente de 12V y tres cables.

**La válvula NO se conecta.** Los bornes de salida del relé quedan al aire. Esta
etapa solo escucha el clic.

---

## El cambio de diseño: pasamos a activo en ALTO

El plan original decía **activo en LOW**, porque asumía un módulo relé de 5 V.
El que llegó es un **SRD-12VDC-SL-C**, y con 12 V la cuenta cambia.

Estos módulos traen un jumper **H/L** que elige con qué nivel se disparan. La
diferencia no es de gusto:

**En posición `L`**, el pin `IN` queda conectado por una resistencia a `DC+`,
que acá son **12 voltios**. Un pin del ESP32 tolera 3,3. Conectarlo directo lo
degrada hasta romperlo. Para usar `L` habría que interponer un transistor.

**En posición `H`**, `IN` solo entrega corriente hacia el optoacoplador y nunca
ve más de lo que le pone el ESP32. Seguro.

### Y de yapa desaparece la trampa del pin flotante

El plan original tenía una trampa documentada: entre que la placa arranca y que
el código configura el pin, el GPIO26 está **flotando**, y un pin flotante
tiende a quedar cerca de 0 V. Con activo en LOW, "cerca de 0 V" significaba
**relé activado, válvula abierta**. En cada reset, chorro de cerveza al piso.

Con **activo en ALTO** eso se da vuelta: el estado por defecto pasa a ser el
estado seguro. Sin corriente, sin código corriendo, sin nada: válvula cerrada.

> Es la diferencia entre un flag que se llama `enabled` y uno que se llama
> `disabled`. Con el segundo, el valor por defecto —`false`, `0`, sin
> inicializar— es justo el peligroso. Conviene que el default sea el estado que
> no rompe nada.

**Poné el jumper en `H`** — y verificalo con el tester, no con la vista.

### El módulo viene de fábrica en `L` — hay que verificarlo, no mirarlo

En el módulo de este proyecto el jumper venía puesto en **`L`**, la posición
peligrosa. Y la posición no se puede determinar mirando: el capuchón es
diminuto, tapa dos de tres pines, y las letras están impresas al borde.

**Se mide, y se mide ANTES de conectar el `IN` al ESP32.**

1. Conectar **solo** el cargador de 12V a `DC+` y `DC-`. El `IN` vacío, nada al
   ESP32.
2. Enchufar el 12V.
3. Tester en `20` V continuos: punta negra en el tornillo `DC-`, punta roja en
   el tornillo `IN`.

| Lectura | Posición | Qué hacer |
|---|---|---|
| **~0 V** | `H` ✅ | Seguro. Conectar el `IN` al `P26`. |
| **~5 o ~12 V** | `L` ❌ | **No conectar nada al ESP32.** Desenchufar, correr el capuchón un lugar, y volver a medir. |

Esa es exactamente la diferencia entre las dos posiciones: en `L` el `IN` está
enganchado a `DC+` por una resistencia; en `H` está suelto, esperando que el
ESP32 le meta señal.

Medido en el módulo del proyecto: **12 V en `L`, 0 V en `H`**.

### Y efectivamente: 3,3 V no alcanzan

Medido en el módulo del proyecto. Con el jumper en `H` y el `IN` conectado al
`P26`, el pin **alterna limpio entre 0 y 3,4 V** —la señal llega perfecta— y
**el relé no se mueve**. Un solo clic al aparecer los 12 V, que es la bobina
asentándose, y después nada.

El optoacoplador de este módulo está dimensionado para lógica de 5 V. Con 3,3
la corriente por el LED interno queda por debajo de lo que necesita para
conducir.

**No hay firmware que arregle esto.** Es una incompatibilidad eléctrica entre un
módulo de 5 V y una placa de 3,3.

---

## La solución: un transistor, y el jumper vuelve a `L`

El transistor hace de amplificador: el ESP32 le da una señal minúscula a la
base y el transistor conmuta la corriente de verdad, tomándola de los 12 V del
propio módulo.

> Es un adaptador de interfaz. El ESP32 no puede hablar el protocolo que el
> relé escucha; el transistor traduce, sin que ninguno de los dos cambie.

```
   P26 ──[ 1k ]── base
                        NPN (2N2222 / BC547 / S8050)
   colector ── IN del relé
   emisor   ── GND
```

Y el jumper del módulo vuelve a **`L`**.

### Por qué `L` ahora sí es seguro

En `L` el `IN` queda enganchado a los 12 V, que es lo que antes hacía imposible
conectarlo al ESP32. Ahora **el ESP32 no toca el `IN`**: lo toca el colector del
transistor, que aguanta esos 12 V sin problema. La placa solo ve su resistencia
de base.

| `P26` | Transistor | `IN` | Relé |
|---|---|---|---|
| `HIGH` | conduce | llevado a ~0 V | **activado** |
| `LOW` | cortado | sube a 12 V | en reposo |

### El firmware no cambia

`NIVEL_ACTIVO` sigue en `HIGH`: la señal alta del ESP32 sigue significando
válvula abierta. El transistor invierte, y el jumper en `L` invierte otra vez.
Dos inversiones se cancelan.

Y la propiedad que importa se conserva: al arrancar, el `P26` flotando queda
cerca de 0 V, el transistor no conduce, el `IN` sube a 12 V y **el relé queda
en reposo**. Válvula cerrada sin corriente, sin código, sin nada.

### Lo que hay que comprar

- **Un transistor NPN de uso general**: `2N2222`, `BC547`, `S8050`, `PN2222`.
  Cualquiera sirve, cuestan monedas.
- **Una resistencia de 1k** (marrón · negro · rojo). Entre 330 Ω y 4,7 k
  funciona igual.

Conviene llevar también unas **10k** de repuesto, que en este proyecto aparecen
seguido.

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
