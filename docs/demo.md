# Llevar el prototipo a mostrar

Cómo transportar el banco de pruebas sin que se desarme, y cómo mostrarlo para
que se entienda.

---

## Antes de tocar nada: fotos

**Sacá fotos de todo el cableado antes de moverlo.** De arriba, de los costados,
y de cerca de la protoboard y de la bornera del relé.

Si en el viaje se sale un cable —y se va a salir alguno— la foto es la diferencia
entre reconectarlo en un minuto o pasar media hora adivinando.

> Es el backup antes de la migración. No lo hacés porque esperes que falle: lo
> hacés porque si falla sin backup no hay vuelta.

---

## Fijar todo a una base

El enemigo es el movimiento. Todo lo que pueda vibrar por separado, va atado a lo
mismo.

1. **Una base rígida**: una tabla, un pedazo de madera fina, una bandeja plástica,
   una tapa de caja de zapatos rígida. Del tamaño de la protoboard más un poco.

2. **La protoboard va pegada** a la base. Casi todas traen una cinta doble faz en
   la parte de abajo, debajo de un papel que hay que despegar. Si no, cinta.

3. **El módulo relé y la válvula también**, cada uno atado o pegado a la base.
   La válvula pesa: si queda suelta, tira de sus cables y arranca lo que esté del
   otro lado.

4. **Una tira de cinta sobre los cables**, cerca de donde entran a la protoboard.
   No sobre los agujeros: al costado, para que la cinta aguante el tirón y los
   pines no se salgan.

5. **Las dos fuentes** (12 V y el cable USB) van sueltas en la caja, no colgando
   del circuito.

---

## Qué llevar

| | |
|---|---|
| La base con todo montado | |
| Fuente de 12 V | |
| Cable USB | |
| La notebook | para el monitor serie, por si hay que diagnosticar |
| **Las dos tarjetas** | `61FB7A54` y `E46D94E5` |
| El celular | de hotspot y de pantalla |
| Tester | por si hay que revisar un cable |
| Unos cables dupont de repuesto | macho-macho y macho-hembra |

---

## El WiFi: usá tu celular

No dependas del WiFi del lugar. En `secrets.h` poné **el nombre y la clave del
hotspot de tu celular**, y lo prendés al llegar.

```c
#define WIFI_SSID  "el-hotspot-del-celu"
#define WIFI_PASS  "la-clave"
```

Así funciona en cualquier lado y no tenés que pedirle la clave del WiFi a nadie
delante de tus jefes.

---

## Al llegar: el orden de encendido

**Siempre el mismo:**

1. Prendé el **hotspot** del celular
2. Enchufá los **12 V**
3. Enchufá el **USB**
4. Esperá unos segundos a que conecte

Para apagar, al revés: USB primero, 12 V después.

### Y antes de mostrar, probá una vez solo

Apoyá la tarjeta, serví un poco, retirala. Que la primera vez que funcione no sea
delante de ellos.

---

## El guion

Lo que se entiende sin explicar nada:

**1. Mostrá la app primero, sin hardware.**
La caja, las canillas con su precio, el saldo de una tarjeta. Que vean que hay un
sistema atrás, no un experimento.

**2. Apoyá la tarjeta.**
En la pantalla de la canilla aparece el nombre del cliente y cuánto puede tomar.

**3. Apretá el botón.**
El relé clickea, la válvula golpea. Ese ruido es el que convence: es la cosa
física obedeciendo.

**4. Mostrá el saldo bajando en vivo** mientras sirve.

**5. Retirá la tarjeta.**
Sale el ticket y el saldo queda descontado en la base.

**6. El remate: cortá el WiFi.**
Apagá el hotspot a mitad de una tirada. **La canilla sigue cortando en el límite
exacto**, porque el corte es local. Retirás la tarjeta, el cobro queda en cola,
prendés el hotspot y aparece solo en la app.

Ese último punto es el que separa esto de una maqueta. Un sistema que depende de
la red se cae con la red; este no.

---

## Lo que conviene decir de entrada

Que **es un prototipo de banco**, y que la versión para la barra va soldada en una
plaqueta dentro de una caja, con borneras y fusible. Ver la etapa 9 en
[`plan-de-etapas.md`](plan-de-etapas.md).

Decirlo vos primero evita que te lo pregunten como si fuera una objeción.

---

## Si algo no anda

Los tres que más probablemente pasen, en orden:

**1. La tarjeta no se lee.** Un cable del lector se salió en el viaje. Son cinco:
`A41` `A42` `A47` `A48` `A49`, más `C5` y `C10`. Comparalos con la foto.

**2. El relé no clickea.** Revisá que `A32`, `B32` y `C32` sigan **vacíos**. Si en
el viaje entró algo ahí, el relé queda pegado.

**3. No conecta al WiFi.** El hotspot del celular tiene que estar prendido
**antes** de enchufar el ESP32, y el nombre tiene que coincidir exacto con el de
`secrets.h`. Los celulares a veces le agregan algo al nombre.

### La regla de oro durante la demo

**No toques la válvula con la mano mientras funciona.** Le mete ruido a la masa y
te puede resetear la placa — ver la trampa 7 en
[`pinout-y-trampas.md`](pinout-y-trampas.md).
