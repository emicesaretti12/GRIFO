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

**Poné el jumper en `H`.**

### El riesgo que hay que medir

3,3 V puede quedar corto para el optoacoplador de un módulo pensado para 12 V.
Si con la señal en alto el relé no llega a activarse, hay dos salidas —
alimentar el lado lógico con 5 V, o interponer un transistor y usar `L`. Se
decide **en esta etapa**, escuchando si el relé clickea o no.

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

**No clickea nunca** → los 3,3 V no alcanzan para el optoacoplador. No es un
error tuyo ni de cableado: es lo que veníamos a medir. Avisame y resolvemos con
un transistor o alimentando el lado lógico con 5 V.

**Clickea pero queda zumbando o pegado** → el optoacoplador está conduciendo a
medias. Mismo caso que el anterior, misma solución.

**Clickea durante los 5 segundos de silencio** → algo está manejando el GPIO26
antes que nuestro código. Avisame: es el problema más importante de esta etapa y
no se pasa por alto.

**Clickea al revés** (activado cuando dice reposo) → el jumper quedó en `L`.
Desenchufá todo antes de moverlo: en `L` el `IN` tiene 12 V y no puede estar
conectado al ESP32.
