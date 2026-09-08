# Etapa 3 — Caudalímetro solo

**Necesita:** el caudalímetro YF-S201C, una resistencia de **10k**, el
protoboard y cuatro cables macho-hembra.

**No conectes el relé ni la válvula.** Esta etapa mide pulsos, nada más. Ni
siquiera hace falta que pase líquido: se prueba soplando.

---

## Por qué hace falta una resistencia

La salida del caudalímetro es **colector abierto**. Eso significa que el sensor
solo sabe hacer una cosa: **conectar el cable a masa, o soltarlo**. No sabe
ponerlo en alto.

Cuando lo suelta, el cable no queda en 5 V ni en 0 V: queda **flotando**, sin
nada que le fije un valor. Un pin flotante toma el valor que le dicte el ruido
eléctrico del ambiente, y en un bar hay heladeras, motores y luces que generan
mucho.

> **Analogía.** Es una función que devuelve `0` o `undefined`. La resistencia de
> pull-up es el `?? 1` que le falta: el valor por defecto para cuando la función
> no devuelve nada.

La resistencia de 10k conecta ese cable a **3,3 V** de forma suave. Cuando el
sensor lo suelta, sube a 3,3 V; cuando el sensor lo agarra, gana el sensor y baja
a 0 V. La señal deja de ser ambigua.

**Va a 3,3 V y no a 5 V a propósito:** así la señal nunca puede superar lo que
tolera un pin del ESP32, pase lo que pase.

Sin la resistencia el contador **sube solo, con el sensor quieto**. Y en este
sistema un pulso fantasma es cerveza que le cobrás a un cliente y que nunca
salió del barril.

### Verificado en el sensor del proyecto

Con el sensor alimentado a 5 V y el cable amarillo sin conectar a nada, el
amarillo mide **1,28 V**. Ni 5 ni 0: está flotando. **No trae pull-up interno**,
así que la resistencia externa es obligatoria.

Si trajera pull-up interno a 5 V, ese mismo punto mediría 5,00 V clavados — y
entonces habría que agregar un divisor antes del ESP32, porque 5 V en una pata
de 3,3 V la va degradando hasta romperla.

---

## Cableado

El caudalímetro trae los tres cables terminados en un **conector de 3
posiciones** con la misma separación que los dupont, así que los pinchitos
entran directo. Para saber cuál es cuál, seguí el color del cable hasta el
agujero por donde entra.

| Caudalímetro | → | Dónde |
|---|---|---|
| **rojo** | → | pin `5V` del ESP32 |
| **negro** | → | pin `GND` del ESP32 |
| **amarillo** | → | una fila libre del protoboard (digamos la **20**) |

Y después:

| Desde | → | Hasta |
|---|---|---|
| resistencia de 10k, una pata | → | fila **20** (con el amarillo) |
| resistencia de 10k, otra pata | → | fila **25** (o cualquier otra libre) |
| cable | → | de la fila **25** al pin `3V3` del ESP32 |
| cable | → | de la fila **20** al pin `P27` del ESP32 |

El `5V` acá **sí** es el correcto: el caudalímetro se alimenta con 5 V. Es el
lector RFID el que va a 3,3 V.

**La resistencia de 10k** tiene las bandas marrón · negro · naranja, más una
dorada al final.

---

## Flashear

```bash
pio run -e etapa3_caudalimetro -t upload
pio device monitor -b 115200
```

---

## Qué tenés que ver

Al arrancar:

```
=============================================
 GRIFO DE CERVEZA - ETAPA 3: CAUDALIMETRO
=============================================
Pin de senal      : GPIO 27
Filtro de glitch  : 1023 ciclos APB (~12.8 us)
Factor provisional: 450 pulsos/litro (se calibra en la etapa 7)
---------------------------------------------
Con el sensor QUIETO, la columna pulsos NO se
tiene que mover. Si sube sola, falta el pull-up.
Sopla por la entrada para verla subir.
---------------------------------------------
```

Con el sensor quieto, cada 5 segundos:

```
[   5100 ms] quieto      pulsos=0
[  10100 ms] quieto      pulsos=0
```

Soplando por la entrada:

```
[  14100 ms] pulsos=87        +87     87.0 p/s  ~193 ml  ~11.60 L/min
[  15100 ms] pulsos=203       +116   116.0 p/s  ~451 ml  ~15.47 L/min
```

Los mililitros y los litros por minuto son **estimados con el factor nominal de
la hoja de datos**. Todavía no significan nada exacto: la calibración real se
mide con probeta en la etapa 7.

---

## Criterio de aceptación

- ✅ **Con el sensor quieto, `pulsos` NO se mueve.** Ni de a uno.
- ✅ Soplando, el contador sube.
- ✅ Al dejar de soplar, se queda quieto en el número al que llegó.

**El primero es el que importa de verdad.** Que suba soplando prueba que el
sensor está vivo; que NO suba quieto prueba que la señal está limpia. Un
contador que suma de a poco con la canilla cerrada le cobra al cliente cerveza
que nunca salió, y ese error no se nota hasta que la caja no cierra.

---

## Por qué el sketch hace lo que hace

### El PCNT en vez de una interrupción por pulso

El ESP32 tiene un **contador de pulsos por hardware**. Cuenta solo, aunque el
procesador esté ocupado o hablando por WiFi. Nosotros solo le preguntamos el
número cuando lo necesitamos.

Con una interrupción por pulso sería código nuestro corriendo cientos de veces
por segundo, compitiendo con todo lo demás. Cuando en la etapa 6 aparezca el
WiFi —que se toma sus ratos y no avisa— esa competencia se convierte en cuentas
perdidas.

> **Analogía.** Es la diferencia entre un `setInterval` que incrementa una
> variable y un `COUNT(*)` en la base. El primero depende de que tu proceso
> llegue a tiempo; el segundo es verdad sin importar qué estabas haciendo.

### El filtro de glitch, que es un debounce por hardware

El PCNT descarta cualquier pulso más corto que **12,8 µs**. A caudal máximo el
sensor da un pulso cada 4,4 ms — es 300 veces más largo. Filtramos ruido sin
riesgo de comernos una cuenta buena.

Es el mismo debounce que el de la etapa 2 para detectar que retiraron la
tarjeta, pero acá lo hace el hardware y no cuesta nada.

### Los desbordes

El contador del PCNT es de 16 bits con signo: se pasa de rosca a los 32.767, que
son unos 70 litros. En una tirada no llegaría… pero *"no llegaría"* no es una
garantía, y esto maneja plata.

Se configura un límite de 10.000. Cuando el hardware lo toca, se reinicia solo y
dispara una interrupción que suma uno a un contador de desbordes. A caudal
máximo eso pasa **una vez cada 44 segundos**, no cientos de veces por segundo.

Y al leer el total se comprueba que no haya habido un desborde justo en el
medio de la lectura: se lee el contador de desbordes, después el del hardware, y
otra vez el de desbordes. Si cambió, se repite. Sin eso, una vez cada tanto el
total daría 10.000 pulsos de más o de menos.

### El pull-up interno queda apagado

El ESP32 tiene pull-ups internos, pero son de ~45k: demasiado débiles para un
cable de un metro en un bar lleno de motores.

Y hay una segunda razón, más importante: **dejándolo apagado, si te olvidás la
resistencia externa el contador se dispara solo.** Que es exactamente el síntoma
que esta etapa tiene que poder detectar. Un pull-up interno de respaldo taparía
el error justo en la prueba diseñada para encontrarlo.

### Avisa incluso cuando no pasa nada

Con el sensor quieto imprime `quieto` cada 5 segundos. El silencio absoluto no
distingue "todo bien" de "la placa se colgó".

---

## Si no anda

**El contador sube solo con el sensor quieto** → falta la resistencia de 10k, o
está mal puesta. Revisá que una pata comparta fila con el cable amarillo y la
otra llegue al `3V3`.

**Soplando no sube nada** → seguí el amarillo hasta el `P27`. Y probá soplar más
fuerte: la turbina necesita un empujón para arrancar.

**Sube de a saltos grandes al soplar** → normal. La turbina acelera y frena.

**No sale nada por el monitor** → velocidad equivocada, tiene que ser 115200.
