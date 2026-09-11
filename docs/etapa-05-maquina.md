# Etapa 5 — Los tres juntos, sin red

**Necesita:** el lector RFID, el caudalímetro, el módulo relé, la fuente de 12V
y un **botón** (o un cable macho-macho, que es lo mismo).

**La válvula NO se conecta.** Solo el relé haciendo clic. La cerveza recién en
la etapa 7, después de calibrar.

---

## Qué prueba

Que el sistema haga el trabajo completo **sin red**: leer la tarjeta, autorizar,
servir mientras se aprieta el botón, cortar al llegar al límite, y cobrar al
retirar la tarjeta.

Los saldos están hardcodeados en `main.cpp` y viven en RAM: se reinician con la
placa. Supabase y la cola offline llegan en la etapa 6.

---

## La máquina de estados

```
  ESPERANDO ──apoya tarjeta──> AUTORIZANDO ──saldo ok──> LISTO
      ^                             │                     │  ^
      │                             │ sin saldo           │  │ suelta boton
      │                             v                     v  │ / limite
      │                         RECHAZADO            SIRVIENDO
      │                             │                     │
      └──retira──── LIQUIDANDO <────┴─────retira──────────┘
```

| Estado | Válvula | Qué espera |
|---|---|---|
| `ESPERANDO` | cerrada | que apoyen una tarjeta |
| `AUTORIZANDO` | cerrada | calcula cuántos pulsos paga el saldo |
| `LISTO` | cerrada | el botón |
| `SIRVIENDO` | **abierta** | el único estado que sirve cerveza |
| `LIQUIDANDO` | cerrada | cobra e imprime el ticket |
| `RECHAZADO` | cerrada | que retiren la tarjeta |

---

## El invariante de seguridad

En **cada vuelta** del loop, si el estado no es `SIRVIENDO`, la válvula se
cierra:

```cpp
if (estado != SIRVIENDO) valvulaCerrar();
```

No dice "si creo que está abierta, la cierro". La cierra, siempre, antes de
cualquier otra lógica.

No alcanza con cerrarla en las transiciones. Una transición sin cubrir, un
`return` temprano, un estado nuevo agregado dentro de seis meses: cualquiera de
esas deja la canilla abierta.

> Es la diferencia entre validar en cada endpoint y validar en el middleware. El
> middleware sigue andando cuando alguien agrega un endpoint y se olvida.

---

## El corte es local, y eso no es negociable

El límite se calcula **una vez al autorizar**, y se guarda en pulsos:

```cpp
pulsosMax = pulsosQuePagaElSaldo(saldo, precio, pulsosPorLitro);
```

Durante la tirada, el corte es una comparación de enteros:

```cpp
if (pulsos >= pulsosMax) { valvulaCerrar(); ... }
```

Sin red, sin consultas, sin esperar a nadie. Aunque el WiFi esté caído y
Supabase no exista, ese `if` corta igual.

Por eso el límite se convierte a pulsos al principio en vez de consultarse
mientras sale la cerveza: durante la tirada no se le pregunta nada a nadie.

---

## Los failsafes

Los dos existen para el mismo escenario —algo se rompe y la válvula queda
abierta— y ninguno depende de que la lógica de arriba sea correcta.

| Failsafe | Umbral | Para qué |
|---|---|---|
| Tiempo máximo abierta | **90 s** | una pinta son ~20 s; 90 significa que algo está mal |
| Abierta sin pulsos | **3 s** | barril vacío, sensor muerto, o válvula trabada |

El segundo es más sutil: si el sensor deja de contar, **no tenemos forma de
cobrar lo que salga**. Cerveza que sale sin medirse es cerveza regalada, así que
la respuesta correcta es cerrar.

---

## La plata, en enteros

Todo en **centavos**, como entero sin signo. Nunca `float`.

Un float no puede representar 0,10 exacto: lo guarda como 0,100000001490116...
Mil operaciones después el saldo del cliente no cuadra con la caja y nadie sabe
por qué.

### Las dos asimetrías

Hay dos divisiones que no dan exactas, y las dos redondean **a favor del bar**:

| Cuenta | Redondeo | Ejemplo |
|---|---|---|
| Cuántos pulsos autoriza el saldo | **hacia abajo** | alcanza para 449,7 → autoriza 449 |
| Cuánto se cobra por lo servido | **hacia arriba** | salieron 156,01 → cobra 157 |

Si fuera al revés, cada tirada regalaría una fracción de centavo. Con miles de
tiradas es plata que falta en el cajón y que nadie puede explicar.

### La garantía

Cobrar lo que se autorizó **nunca puede superar el saldo**. El truncado hacia
abajo del primero deja justo el margen que consume el redondeo hacia arriba del
segundo. Un saldo no puede quedar negativo.

Eso está probado, no supuesto:

```bash
./pruebas/correr.sh
```

Barre ~4 millones de combinaciones de saldo, precio y calibración verificando
que `precioDeLosPulsos(pulsosQuePagaElSaldo(saldo)) <= saldo`. Corre en la
compu, sin placa, en un segundo.

---

## Cableado

Todo lo de las etapas 2, 3 y 4 junto, más el botón.

| Componente | Señal | GPIO |
|---|---|---|
| MFRC522 | SDA/SS | 5 |
| MFRC522 | SCK | 18 |
| MFRC522 | MOSI | 23 |
| MFRC522 | MISO | 19 |
| MFRC522 | RST | 22 |
| Caudalímetro | amarillo | 27 |
| Relé | `IN` → `HV4`, `LV4` → | 26 |
| Botón | a `GND` | 14 |
| LED | (el de la placa) | 2 |

**El lector se alimenta con 3,3 V. Con 5 V se quema.**

### El botón

Un botón es dos cables que se tocan. Si no tenés uno:

- una punta de un macho-macho en **`GPIO14`**
- la otra tocando **`GND`**

Tocar = apretar. Soltar = soltar. Funciona igual.

El pin usa `INPUT_PULLUP`, así que **apretado es `LOW`**. La lógica queda
invertida respecto de lo que uno esperaría, y es lo normal en botones: el
pull-up es lo que evita que el pin quede flotando cuando nadie lo toca.

### El riel `HV` sigue desconectado

Lo de la etapa 4: con el riel a 5 V el relé quedaba pegado. Así que acá se prueba
la salida 1 de las anotadas en el plan — **el pull-up del caudalímetro lo pone el
ESP32** (`caudalIniciar(true)`).

Los 45k del pull-up interno son más débiles que los 10k del conversor. El
criterio de siempre: **quieto no tiene que contar ni un pulso.** Si cuenta, hay
que volver a un pull-up externo y resolver el riel de otra forma.

---

## Flashear

```bash
pio run -e etapa5_maquina -t upload
pio device monitor -b 115200
```

Con los **12 V desenchufados** mientras se graba. Después se enchufan.

---

## Qué tenés que ver

```
1) Apoya la tarjeta
2) Aprieta el boton (o toca GPIO14 contra GND)
3) Retira la tarjeta para cobrar
```

Al apoyar:

```
[   4210 ms] ESPERANDO -> AUTORIZANDO
Tarjeta 61FB7A54 | saldo $5000,00 | autorizado hasta 1111 ml
Apreta el boton para servir.
[   4215 ms] AUTORIZANDO -> LISTO
```

Al apretar (el relé clickea y el LED rojo prende):

```
[   6100 ms] LISTO -> SIRVIENDO
   sirviendo... 22 ml  $100,00  (10/500 pulsos)
   sirviendo... 44 ml  $200,00  (20/500 pulsos)
```

Al retirar:

```
================ TICKET ================
 Tarjeta   : 61FB7A54
 Servido   : 44 ml  (20 pulsos)
 Cobrado   : $200,00
 Saldo     : $4800,00
========================================
```

---

## Criterio de aceptación

- ✅ Apoyar la tarjeta imprime el saldo y el máximo autorizado
- ✅ Apretar el botón hace clic el relé; soltarlo lo corta
- ✅ El contador de pulsos sube **solo** mientras el relé está activado
- ✅ Al llegar al límite **corta solo**, sin soltar el botón
- ✅ Retirar la tarjeta imprime el ticket y descuenta el saldo
- ✅ La tarjeta con poco saldo (`E46D94E5`, $200) corta mucho antes
- ✅ Una tarjeta desconocida queda en `RECHAZADO` y no sirve nada
- ✅ **Con el relé en reposo, el contador quieto no sube ni un pulso**

Y el de siempre, que no se abandona: **al resetear la placa, el relé no hace
ningún clic durante el arranque.**

---

## Cómo probar los failsafes

Sin barril, el caudalímetro no cuenta. Eso hace que el failsafe de "abierta sin
pulsos" salte a los 3 segundos, y **está bien que salte**: es exactamente el
escenario que tiene que cubrir.

```
!! FAILSAFE: abierta sin pulsos. Barril vacio, sensor
!! muerto o valvula trabada. Corta.
```

Para probar el ciclo normal sin agua, soplá por la entrada del sensor mientras
tenés el botón apretado. Con eso cuenta pulsos y el failsafe no salta.
