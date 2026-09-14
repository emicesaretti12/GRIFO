# Llevar el sistema al bar

Cómo prepararlo, transportarlo sin que se desarme, y mostrarlo para que se
entienda.

---

# 1 · Lo que hay que hacer ANTES de salir

Esto no es opcional. **La primera vez que algo funcione no puede ser delante de
ellos.**

## 1.1 Flashear y que arranque

```bash
cd ~/GRIFO && git pull
pio run -e etapa6_red -t upload && pio device monitor
```

Con los **12 V desenchufados** mientras graba. Si tira
`Serial data stream stopped`, es eso — ver
[`troubleshooting-flasheo.md`](troubleshooting-flasheo.md).

Tiene que salir, en este orden:

```
[red] WiFi conectado a "..."
[red] abriendo la conexion segura (tarda unos segundos)...
[red] conexion lista en ~2800 ms. La primera tarjeta ya no espera esto.
```

## 1.2 Probar el portal — **esto es lo que te salva mañana**

Es lo único que te permite cambiar de WiFi en el bar sin la notebook. Si no lo
probaste antes, no cuenta.

1. Desenchufá y volvé a enchufar **con el botón apretado**, 3 segundos (el LED
   parpadea contando).
2. Con el celular, conectate a la red **`GRIFO-1`**, clave la de `PORTAL_PASS`.
3. Se abre sola una página. Si no, `http://192.168.4.1`.
4. Que **liste las redes de tu casa**. Ahí ya sabés que el escaneo anda.
5. Salí sin guardar nada, o guardá la misma red de siempre.

📱 **Practicá esto una vez con el celular que vas a llevar.** Algunos Android
piden confirmar "esta red no tiene internet, ¿seguir conectado?" — decile que sí,
o te va a saltar a los datos móviles justo cuando lo necesites.

## 1.3 Una tirada completa

Tarjeta → botón → sirve → retirás → el saldo baja en la app. Entera, sin
saltearte nada.

## 1.4 La prueba que más impresiona

Serví, y **con el chorro saliendo apagá el WiFi**. Tiene que seguir sirviendo y
cortar igual. Retirás la tarjeta: el cierre queda en cola. Prendés el WiFi: el
cobro aparece solo.

Si esto no te sale en casa, no lo muestres en el bar.

## 1.5 Saldo en las tarjetas

Cargales saldo de sobra desde **Caja**. Las que tenés: `61FB7A54`, `26BA2E8E`,
`E46D94E5`.

Cargá una **con poco saldo a propósito** (unos 200 ml) para poder mostrar el
corte por límite, que es la parte que demuestra que cobra bien.

## 1.6 Fotos del cableado

**De arriba, de los costados, y de cerca del protoboard y de la bornera.**

Si en el viaje se sale un cable —y se va a salir alguno— la foto es la diferencia
entre reconectarlo en un minuto o pasar media hora adivinando.

> Es el backup antes de la migración. No lo hacés porque esperes que falle: lo
> hacés porque si falla sin backup no hay vuelta.

## 1.7 Fijar todo a una base

El enemigo es el movimiento. Todo lo que pueda vibrar por separado va atado a lo
mismo.

1. **Una base rígida**: una tabla, una bandeja, una tapa de caja rígida.
2. **El protoboard pegado** a la base (casi todos traen doble faz abajo).
3. **El relé y la válvula también.** La válvula pesa: si queda suelta, tira de
   sus cables y arranca lo que esté del otro lado.
4. **Una tira de cinta sobre los cables**, al costado de los agujeros —no encima—
   para que la cinta aguante el tirón y los pines no se salgan.
5. **Las dos fuentes sueltas en la caja**, nunca colgando del circuito.

---

# 2 · Qué llevar

| | Para qué |
|---|---|
| La base con todo montado | |
| Fuente de 12 V | |
| Cable USB | |
| La notebook | el monitor serie, por si hay que diagnosticar |
| **Las tarjetas** | al menos dos, una con poco saldo |
| El celular | hotspot, portal, y para mostrar la app |
| Tester | por si hay que revisar un cable |
| Cables dupont de repuesto | macho-macho **y** macho-hembra |
| Un vaso y un balde | si vas a hacer correr líquido |

---

# 3 · El WiFi ya no se compila

Esto cambió y es lo más importante que llevás.

Antes el WiFi estaba adentro del binario: cambiar de red era abrir la notebook y
reflashear. **Ahora vive en la memoria de la canilla** y se cambia desde el
celular.

Tenés dos caminos, y conviene tener los dos:

### Camino A — el hotspot de tu celular (el seguro)

No depende de nadie. Prendelo **antes** de enchufar el ESP32.

Si el `secrets.h` todavía apunta a tu casa, al llegar entrás al portal (botón
apretado 3 s) y le ponés el hotspot. Dos minutos.

### Camino B — el WiFi del bar (el que impresiona)

Mismo procedimiento, pero elegís la red del bar de la lista. Y de paso les
mostrás que **la canilla se configura sin herramientas**, que es exactamente lo
que van a preguntar.

⚠️ **Dos trampas del WiFi ajeno:**

- **El ESP32 solo habla 2,4 GHz.** Si el bar tiene una red que es solo 5 GHz, no
  la va a ver en la lista. No está roto: no existe para él.
- **Si el WiFi del bar tiene página de login** (esas que te piden aceptar
  términos), **no sirve**. La canilla no puede clickear un botón. Hotspot y listo.

Por eso el camino A va primero y el B es el bonus.

---

# 4 · Al llegar

## El orden de encendido — siempre el mismo

1. Prendé el **hotspot**
2. Enchufá los **12 V**
3. Enchufá el **USB**
4. Esperá a que diga `conexion lista`

Para apagar, al revés: **USB primero, 12 V después.**

## Probá una vez solo, antes de llamarlos

Tarjeta, un chorrito, retirar. Que la primera vez que funcione no sea delante de
ellos.

---

# 5 · El guion

**1. La app primero, sin hardware.**
Caja, canillas con su precio, el saldo de una tarjeta. Que vean que hay un
sistema atrás y no un experimento.

**2. Abrí Inicio y dejalo ahí.**
El panel **Ahora mismo** muestra las canillas en vivo. Dejalo abierto en el
celular o en la notebook: se va a mover solo cuando sirvas.

**3. Apoyá la tarjeta.**
Aparece quién es y cuánto puede tomar.

**4. Apretá el botón.**
El relé clickea y la válvula golpea. **Ese ruido es el que convence**: es la cosa
física obedeciendo.

**5. Señalá la pantalla mientras sirve.**
Los mililitros y los pesos suben solos. El vaso se llena; si te pasás, se
convierte en jarra.

**6. Retirá la tarjeta.**
Sale el ticket y el saldo queda descontado.

**7. Ahora la tarjeta con poco saldo.**
Apretá el botón y **no lo sueltes**. Corta solo, en el límite exacto. Esto es lo
que responde a "¿y si alguien se sirve de más?".

**8. El remate: cortá el WiFi.**
Apagá el hotspot a mitad de una tirada. **Sigue cortando igual**, porque el corte
lo decide la canilla comparando dos números, sin preguntarle a nadie. Retirás la
tarjeta, el cobro queda en cola, prendés el hotspot y aparece solo en la app.

> Un sistema que depende de la red se cae con la red. Este no.

**9. Si preguntan por el mantenimiento** — y van a preguntar:
Canillas → **Controlar** → **Reiniciar**. Se reinicia sola desde la app.
Y contales que el WiFi también se le cambia desde ahí, sin ir hasta la canilla.

---

# 6 · Qué conviene decir vos primero

Que **es un prototipo de banco de pruebas**, y que la versión para la barra va
soldada en una plaqueta dentro de una caja, con borneras y fusible — la etapa 9
de [`plan-de-etapas.md`](plan-de-etapas.md).

Decirlo vos primero lo convierte en un plan. Que lo digan ellos lo convierte en
una objeción.

---

# 7 · Si algo no anda

**1. La tarjeta no se lee.** Se salió un cable del lector en el viaje. Son cinco:
`A41` `A42` `A47` `A48` `A49`, más `C5` (3,3 V) y `C10` (GND). Comparalos con la
foto.

**2. El relé no clickea.** Revisá que `A32`, `B32` y `C32` sigan **vacíos**. Si en
el viaje entró algo ahí, el relé queda pegado y parece que el firmware no corta.

**3. No conecta al WiFi.** Botón apretado 3 s al arrancar → portal → elegís la red
de nuevo. Acordate: solo 2,4 GHz, y nada de redes con página de login.

**4. Se reinicia sola o se cuelga.** Probablemente tocaste la válvula con la mano
mientras funcionaba.

### La regla de oro

🚫 **No toques la válvula con la mano mientras está andando.** Le mete ruido a la
masa y te resetea la placa. Trampa 7 en
[`pinout-y-trampas.md`](pinout-y-trampas.md).

---

# 8 · Lo que todavía falta, y conviene que lo digas vos

| | |
|---|---|
| **Diodo 1N4007** en la válvula | Sin él, cada corte castiga los contactos del relé. Es una moneda. |
| **Calibración con agua a presión** | Los pulsos por litro de ahora son de catálogo. El número fino sale con presión de red. |
| **Plaqueta soldada** | El protoboard no va a un bar. Etapa 9. |
| **Certificado TLS** | Hoy se conecta sin validar el servidor. Anda, pero antes de manejar plata de verdad va. |

Que sepan que **vos ya sabés lo que falta** vale más que aparentar que no falta
nada.
