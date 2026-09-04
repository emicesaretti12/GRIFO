# Pinout y trampas de hardware

## Pinout definitivo

| Componente | Señal | GPIO | Notas |
|---|---|---|---|
| MFRC522 | SDA / SS | 5 | bus VSPI |
| MFRC522 | SCK | 18 | |
| MFRC522 | MOSI | 23 | |
| MFRC522 | MISO | 19 | |
| MFRC522 | RST | 22 | alimentación **3.3V**, no 5V |
| Relé | IN | 26 | **activo en LOW** · bobina de 12V, ver trampa 6 |
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
eléctrico del ambiente, y a menudo se queda cerca de 0V. Como el relé es activo
en LOW, "cerca de 0V" significa **relé activado, válvula abierta**. En cada
reset, en cada bajón de tensión del bar, chorro de cerveza al piso.

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

### 2. Lógica invertida: el relé es activo en LOW

`LOW` → relé activado → **válvula abierta**
`HIGH` → relé en reposo → **válvula cerrada**

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
