# Pinout y trampas de hardware

## La placa

**NodeMCU ESP-32S v1.1**, 38 pines, micro-USB, conversor CP2102.

Los nombres de los pines están impresos **del lado de abajo** (el opuesto al
módulo metálico) y llevan prefijo **`P`**: lo que el código llama `GPIO5`, la
plaqueta lo rotula `P5`.

Los cinco pines de datos del lector RFID (`P5 P18 P19 P22 P23`) caen todos en la
misma fila. Verificado en la placa real, con los rótulos hacia arriba y el USB
hacia abajo:

- **Columna izquierda:** `CLK` pegado al USB, `GND` en la punta opuesta.
- **Columna derecha:** `5V` pegado al USB ⚠️, `3V3` en la punta opuesta ✅.

Que los dos pines de alimentación estén en puntas opuestas, y que el peligroso
sea el que está junto al USB, es lo que hace difícil equivocarse en el único
error que rompe algo.

Detalle con las posiciones contadas desde el USB en
[`etapa-02-rfid.md`](etapa-02-rfid.md).

---

## Pinout definitivo

| Componente | Señal | GPIO | Notas |
|---|---|---|---|
| MFRC522 | SDA / SS | 5 | bus VSPI |
| MFRC522 | SCK | 18 | |
| MFRC522 | MOSI | 23 | |
| MFRC522 | MISO | 19 | |
| MFRC522 | RST | 22 | alimentación **3.3V**, no 5V |
| Relé | IN | 26 | **activo en ALTO** · bobina de 12V, jumper en `H`, ver trampa 6 |
| Caudalímetro | señal (amarillo) | 27 | pull-up 10k a 3.3V |
| Pulsador | — | 14 | a GND, pull-up interno |
| LED estado | — | 2 | opcional (es el LED de la placa) |

El display, cuando llegue, va en **HSPI** — no en VSPI. El MFRC522 es conflictivo
compartiendo bus y no vale la pena pelearla.

---

## Orden físico de la línea de cerveza

```
Barril → Caudalímetro → Válvula solenoide → Pico
```

El caudalímetro va **antes** de la válvula. Con la válvula cerrada, ese tramo
queda lleno de líquido y quieto, y la turbina del medidor solo gira cuando
realmente corre cerveza.

Al revés (válvula antes que el medidor) ese tramo se vacía entre servida y
servida, entra aire, y al abrir la válvula el aire pasa por la turbina y la hace
girar: contás burbujas como si fueran cerveza y le cobrás espuma al cliente.

---

## Trampas de hardware

### 1. Pin flotante en el reset → la válvula se abre sola

**El problema.** Entre que la placa arranca y que tu código llega a
`pinMode(PIN_RELE, OUTPUT)`, el GPIO26 no está manejado por nadie: está
*flotante*. Un pin flotante no vale 0 ni 1 — vale lo que le dicte el ruido
eléctrico del ambiente, y a menudo se queda cerca de 0V.

Con un relé **activo en LOW**, "cerca de 0V" significaría **relé activado,
válvula abierta**: en cada reset, en cada bajón de tensión del bar, chorro de
cerveza al piso. Por eso este proyecto pasó a **activo en ALTO** (trampa 2), y
ese mismo "cerca de 0V" pasó a significar válvula cerrada.

La trampa queda documentada igual, y el orden de inicialización se respeta lo
mismo: si alguna vez hay que volver a activo en bajo, el código ya está bien
escrito y no hay que acordarse de nada.

**Analogía.** Es leer una variable antes de inicializarla. No te da `undefined`
prolijo: te da basura de memoria. Y acá justo la basura más probable coincide con
el valor peligroso.

**La solución.** Escribir el valor seguro **antes** de convertir el pin en
salida, y repetirlo después:

```cpp
digitalWrite(PIN_RELE, HIGH);      // 1) carga HIGH en el latch de salida
pinMode(PIN_RELE, OUTPUT);         // 2) recién ahora el pin empieza a manejar la línea,
                                   //    y sale manejando el valor que ya estaba cargado
digitalWrite(PIN_RELE, HIGH);      // 3) por las dudas, de nuevo
```

Si lo hacés al revés (`pinMode` primero), hay una ventana de microsegundos en la
que el pin ya es salida pero todavía tiene el valor por defecto — que es LOW — y
el relé alcanza a hacer clic. Es una race condition, igual que las de software:
el orden de dos líneas cambia el resultado.

**Cómo se verifica:** en la etapa 4, reseteando la placa el relé **no** tiene que
hacer clic durante el arranque.

---

### 2. El nivel activo, y por qué dejó de estar invertido

**Este proyecto usa activo en ALTO**, con el jumper del módulo en `H`:

`HIGH` → relé activado → **válvula abierta**
`LOW` → relé en reposo → **válvula cerrada**

El plan original decía activo en LOW, porque asumía un módulo de 5 V. El que
llegó es de 12 V, y en modo activo-bajo su pin `IN` queda conectado por una
resistencia a `DC+` —12 voltios— que rompería la pata del ESP32.

Que además el estado seguro haya pasado a ser el valor por defecto de un pin
flotante es la mejor consecuencia del cambio, y desactiva casi por completo la
trampa 1. Detalle en [`etapa-04-rele.md`](etapa-04-rele.md).

**Analogía.** Es un flag que se llama `disabled` en vez de `enabled`. Todo se lee
al revés, y lo peor es que el valor por defecto (0 / falso / LOW) es justo el
estado peligroso.

Por eso en el código nunca usamos `digitalWrite(PIN_RELE, estado)` a pelo, sino
funciones con nombre — `abrirValvula()` / `cerrarValvula()` — que encapsulan la
inversión en un solo lugar. Un lugar donde equivocarse, no veinte.

---

### 3. El caudalímetro es open-collector → hace falta el pull-up de 10k

**El problema.** La salida del sensor solo sabe hacer una cosa: **tirar la línea
a 0V**. No puede subirla a 3.3V. Cuando la turbina gira, el sensor va tirando la
línea a 0V y soltándola. Pero al soltarla, la línea no vuelve sola a 3.3V: queda
flotando, y el ESP32 lee ruido en vez de pulsos limpios.

**Analogía.** Es una API que solo expone `set(false)`. No hay `set(true)`. Si
querés que el valor vuelva a `true` cuando el sensor lo suelta, alguien más lo
tiene que restaurar.

**La solución: el pull-up.** Una resistencia de 10k entre la línea de señal y
3.3V. Es el "alguien más": tira suavemente de la línea hacia arriba todo el
tiempo. Es el `?? true` de la expresión — el valor por defecto que aplica cuando
nadie está forzando nada.

¿Por qué 10k y no un cable directo a 3.3V? Porque tiene que ser un tirón **débil**:
lo bastante fuerte para levantar la línea cuando el sensor la suelta, pero lo
bastante débil para que, cuando el sensor sí quiere tirar a 0V, gane el sensor.
Un cable directo sería 3.3V peleando contra el sensor a full — cortocircuito.

Queda así:

```
3.3V ──[ 10k ]──┬── GPIO27 (ESP32)
                │
                └── cable AMARILLO del caudalímetro
```

**Antes de conectarlo:** medir con el tester entre el amarillo y el rojo del
sensor, con el sensor desconectado de todo. Si ya mide unos kΩ, el módulo trae
pull-up interno y no hace falta el nuestro.

**Cómo se verifica:** en la etapa 3, el contador sube cuando soplás y **no se
mueve** cuando el sensor está quieto. Si sube quieto, hay ruido o falta el
pull-up.

---

### 3b. El lector va en la canilla, y eso ata dónde va el ESP32

El MFRC522 tiene que quedar montado en la canilla, contra la superficie donde el
cliente apoya la tarjeta, al lado de la pantalla. No es un componente de caja:
es la interfaz.

Eso **no** significa que el ESP32 pueda quedar lejos, en un tablero aparte. Los
cinco cables que los unen son **SPI**, un bus sincrónico pensado para viajar
centímetros dentro de una placa, no metros por un cable colgando. Estirado y sin
apantallar empieza a leer mal: lecturas intermitentes, UIDs cortados, o el
módulo directamente no contesta.

**Regla práctica: no más de 20-30 cm entre el ESP32 y el lector.** O sea que la
caja del ESP32 vive **dentro de la columna de la canilla**, cerca del lector, y
lo que se estira son las cosas que sí toleran distancia: la alimentación, el
cable del relé y el del caudalímetro.

**Analogía.** Es la diferencia entre una llamada a función y una request HTTP.
SPI es una llamada a función: asume que el otro contesta en nanosegundos y no
tiene reintentos ni checksum. Estirarlo por un cable largo es querer hacer una
llamada a función a través de la red.

Si en alguna canilla la distancia no se puede evitar, la salida no es cable más
grueso: es poner un ESP32 por canilla —que es lo que el diseño ya hace— o pasar
el lector a un bus pensado para distancia. No lo resolvemos estirando SPI.

---

### 4. Todo comparte GND

ESP32, módulo relé, sensor, fuente de 5V y fuente de 12V: **todos los negativos
unidos**.

**Analogía.** El voltaje no es un valor absoluto, es una **diferencia** — como un
`git diff`: no significa nada sin saber contra qué commit. Cuando el ESP32 dice
"saqué 3.3V", quiere decir "3.3V más que mi GND". Si el relé tiene otro GND, ese
3.3V no le dice nada; está comparando contra otra base. Los circuitos no andan, o
andan a veces, que es peor.

---

### 5. La válvula NO se alimenta del ESP32

La solenoide de 12V tira varios cientos de mA. El regulador de 3.3V de la placa
no da eso ni cerca: si la colgás del ESP32 se resetea la placa, o la quemás.

La válvula va a su **fuente de 12V aparte**. El relé es únicamente el
interruptor: el ESP32 le manda una señal de control minúscula y el relé cierra un
circuito de potencia que nunca pasa por la placa.

**Analogía.** Tu servidor web no procesa el video: encola un job y lo procesa
otra máquina con la CPU para eso. El ESP32 encola, la fuente de 12V hace fuerza.

### La válvula del proyecto: FPD-270A

Impreso en la etiqueta: **DC 12V**, **0.02–0.8 MPa**.

Lo de 12V confirma que va a la fuente de 12V junto con el relé, nunca al ESP32.

Lo del rango de presión es lo que hay que tener presente, porque **no es una
válvula que abra sola**: es asistida por presión. La bobina no levanta el
diafragma a pulso, mueve un piloto y **es la presión del líquido la que termina
de abrirla**. Sin presión mínima, aunque el relé haga clic, no pasa nada.

| | En MPa | En bar | En psi |
|---|---|---|---|
| Presión **mínima** para abrir | 0.02 | 0.2 | 2.9 |
| Presión máxima | 0.8 | 8 | 116 |

- **Un barril con CO2** anda entre 0.7 y 1.0 bar. Sobra.
- **La canilla de la pared** anda entre 2 y 4 bar. Sobra.
- **Un balde en alto por gravedad NO alcanza.** 0.2 bar son unos **2 metros de
  columna de agua**. Un bidón sobre la mesa da centímetros, no metros.

**Consecuencia para la etapa 7:** la calibración con agua se hace conectando la
válvula a la **canilla de agua de red**, no a un recipiente elevado. Si no, la
válvula no abre, y el síntoma —relé que clickea y nada que sale— se confunde
enseguida con un problema de cableado o de firmware que no existe.

### Confirmar que la válvula es NC (normalmente cerrada)

**NC** significa que sin corriente está **cerrada**. Es la única opción
aceptable: si se corta la luz o se cuelga el ESP32, la cerveza tiene que dejar
de salir, no empezar.

Se verifica sin conectar nada: **soplar por la entrada de la válvula, sin
alimentar**. Si no pasa aire, es NC. Si pasa, es NO y **no sirve para este
proyecto**.

---

### 6. El relé que llegó es de 12V, no de 5V

El módulo que llegó es un **SRD-12VDC-SL-C**, 1 canal, con optoacoplador y
bornera de tornillo de 3 posiciones: `IN`, `DC-`, `DC+`. Trae además un **jumper
de selección H/L** (*high/low level trigger*) impreso en la plaquita.

Dos consecuencias que cambian lo que estaba planificado:

1. **La bobina es de 12V.** No se alimenta del pin `5V` del ESP32: `DC+` y `DC-`
   van a la **fuente de 12V**, la misma que la válvula.
2. **El `DC-` de la fuente de 12V tiene que unirse al `GND` del ESP32.** Si no,
   la señal de `IN` no tiene contra qué compararse (ver la trampa 4).

El jumper **H/L** define si el relé se activa con la señal en alto o en bajo. El
firmware asume **activo en LOW**, así que el jumper va en la posición que
corresponda a *low level trigger* — se confirma en la etapa 4 escuchando el clic.

Si el relé queda **zumbando o pegado**, es que el optoacoplador está conduciendo
a medias con los 3.3V del ESP32. Se resuelve en la etapa 4 según cómo se
comporte; no es un problema de software.


---

## 7. La bobina no se deja apagar: hace falta un diodo

**Síntoma medido:** con la válvula conectada, tocarla con la mano tiraba abajo el
puerto USB del ESP32 (`Disconnected ([Errno 5] Input/output error)`).

**Causa:** cuando el relé corta la corriente de la válvula, el campo magnético de
la bobina colapsa y genera un pico de tensión **en sentido contrario** —cientos
de volts durante microsegundos—. Ese pico salta entre los contactos del relé y se
irradia por los cables.

> Es un `finally` que no existe. Cortás la ejecución de golpe y el recurso libera
> de cualquier manera.

**La solución:** un diodo **`1N4007`** en paralelo con la válvula, **al revés**:

```
   NO ───┬──── válvula ────┬─── DC-
         │                 │
         └──[◄|]───────────┘
            raya
```

La **raya** del diodo va del lado del `NO`, o sea del positivo.

Mientras la válvula está alimentada el diodo no conduce y no hace nada. Cuando el
relé corta, le da a esa corriente un camino cerrado y el pico se disipa adentro
de la bobina en vez de salir afuera.

Cuesta monedas. **Sin él el sistema anda igual**, pero cada corte castiga los
contactos del relé y mete ruido. En una canilla que abre cien veces por noche,
eso se paga en contactos picados y en resets que nadie puede explicar.

### El otro efecto, más sutil

Las fuentes switching baratas dejan el negativo flotando a un centenar de volts
respecto de tierra, con microamperes. No es peligroso —no se siente— pero al
tocar el metal de la válvula la persona se vuelve camino a tierra y le mete ruido
a toda la masa del circuito.

Por eso el problema empeoraba justo al tocarla. **Regla de banco: no se toca la
válvula con la mano mientras el sistema está funcionando.**

### Lo que sí quedó validado

| Medición | Valor |
|---|---|
| Bobina, entre lengüetas | **24 Ω** → 0,5 A a 12 V |
| Lengüeta contra cuerpo metálico | **abierto** → el aislante no pierde |
| Camino completo `NO` → bobina → `DC-` | **24,6 Ω** |
| Tensión en `NO` con el relé activado | **12 V** |
| Prueba en seco | **golpea** ✅ |
