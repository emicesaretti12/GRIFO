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

## Cableado

Con el ESP32 **desenchufado**, 7 cables:

| MFRC522 | → | ESP32 |
|---|---|---|
| `SDA` (o `SS`) | → | `D5` / `GPIO5` |
| `SCK` | → | `D18` / `GPIO18` |
| `MOSI` | → | `D23` / `GPIO23` |
| `MISO` | → | `D19` / `GPIO19` |
| `RST` | → | `D22` / `GPIO22` |
| `3.3V` | → | `3V3` ⚠️ |
| `GND` | → | `GND` |
| `IRQ` | → | *(no se conecta)* |

El pin `IRQ` queda al aire a propósito: sirve para que el módulo avise por
interrupción, y no lo usamos.

### Si el módulo vino con las patas sueltas

Muchos MFRC522 vienen con la tira de pines **sin soldar**, en una bolsita
aparte. Apoyar los pines en los agujeros y esperar que hagan contacto **no
funciona de forma confiable**: anda un rato, después no, y te vuelve loco
buscando un problema de software que no existe. Hay que soldarlos.

Si no tenés soldador, decime y vemos — pero es mejor resolverlo ahora que
descubrirlo en la etapa 5 con todo conectado.

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
