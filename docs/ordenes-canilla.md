# Órdenes: tocar la canilla desde la app

## El agujero que tapa

La app **miraba** la canilla pero no podía **tocarla**. Todo lo que hubiera que
hacerle había que hacerlo con el cuerpo: ir hasta ahí, desenchufar, enchufar, o
peor, con una notebook y el cable.

## Por qué la canilla pregunta y el servidor no avisa

Lo natural sería que el servidor le mande la orden. **No se puede**: el ESP32
está detrás del router del bar, sin IP pública y sin puerto abierto. Nadie de
afuera puede iniciarle una conversación.

Así que se da vuelta: el servidor deja la orden anotada y **la canilla la
busca** en cada latido, que ya estaba pasando igual.

> Es exactamente la diferencia entre un webhook y un polling. Cuando el que
> tiene que recibir no es alcanzable, el que recibe pregunta.

Por eso la pantalla dice "pedido" y muestra en qué estado va, en vez de fingir un
spinner y mentir que pasó al instante.

## Solo tres órdenes, y no es por falta de ganas

| Orden | Para qué |
|---|---|
| `reiniciar` | Quedó rara y no hay nadie en el bar |
| `wifi` | Cambiarle la red sin ir hasta ahí |
| `olvidar_wifi` | Borrarle la red para que levante el portal |

**"Bloquear la canilla" no está en la lista** — y es a propósito. `abrir_sesion`
ya chequea `activo`, así que el botón *Desactivar* que ya existía surte efecto en
el servidor **al instante**, aunque el ESP32 esté apagado. Una orden para eso
sería más lenta y menos confiable.

> Si el servidor puede resolverlo solo, mandárselo al dispositivo es agregar un
> punto de falla a cambio de nada.

## La marca de agua

La canilla manda en cada latido *hasta qué número de orden llegó*, y el servidor
solo le entrega órdenes con un número mayor.

> Es un offset de consumidor. No hace falta un ACK por mensaje: alcanza con "voy
> por el N", y eso sobrevive a que el aparato se reinicie a la mitad.

Dos detalles que no son opcionales:

**La marca se guarda en NVS, no en RAM.** La orden más útil es "reiniciate". Si
la marca se perdiera en el reinicio, el servidor entregaría la misma orden en el
latido siguiente y la canilla se reiniciaría para siempre.

**La marca se anota ANTES de ejecutar.** Mismo motivo, desde el otro lado.

> Es commitear el offset antes de procesar. Al revés, un mensaje que mata al
> worker se reintenta eternamente: la cola de veneno.

El precio es que una orden podría darse por hecha sin haberse ejecutado. Para
estas tres es barato: se vuelve a mandar desde la app. Un bucle de reinicios, en
cambio, no se arregla solo.

## Cuándo se aplica: nunca en el medio de una cerveza

La tarea de red **recibe** la orden pero no la ejecuta. La deja en una cola, y la
tarea de control la levanta **solo estando en `ESPERANDO`**: sin tarjeta, sin
sesión y con la válvula cerrada.

Reiniciar en medio de un servicio cortaría la cerveza y perdería la venta — el
cierre recién se guarda al liquidar.

> Es aplicar la migración entre requests y no arriba de uno a medio ejecutar. El
> momento correcto no es "cuando llega": es "cuando no hay nada en vuelo".

Por eso en la app hay un estado **"Recibida"** distinto de "Aplicada". No es un
detalle cosmético: es la diferencia entre "no llegó" y "llegó y está esperando el
momento".

## La clave del WiFi

Viaja en la orden, en claro, porque el ESP32 la necesita así para conectarse. Lo
que se controla es **cuánto tiempo existe**:

- Solo la devuelve `canilla_latido`, que está detrás del token de la canilla.
- Apenas la canilla confirma que aplicó la orden, el servidor **le borra la
  clave y conserva el SSID**.
- `admin_listar_ordenes` nunca devuelve la clave, ni al admin que la escribió.

> Es guardar en el log qué usuario intentó entrar, y no su contraseña.

## Y el rollback sigue valiendo

Una orden de `wifi` entra por el mismo camino que el portal: **a prueba**, con la
red anterior de respaldo. Si la red nueva no conecta en 20 segundos, la canilla
vuelve sola a la que andaba.

Eso es lo que hace que cambiar el WiFi desde la app **no pueda** dejar la canilla
incomunicada. Sin eso, una letra mal en la clave sería un viaje al bar.

## Latencia

El latido pasó de 60 a **30 segundos**, porque sin canal de push el intervalo del
polling *es* la latencia de una orden. Son 2.880 pedidos por día por canilla, que
no es nada.

> Es elegir el intervalo del polling por la latencia que querés, no por lo que
> parece prolijo.

## Archivos

| Archivo | Qué hace |
|---|---|
| `supabase/22-ordenes.sql` | Tabla, `canilla_latido` extendido, `admin_ordenar` |
| `supabase/23-pruebas-ordenes.sql` | 13 pruebas, terminan en `rollback` |
| `src/etapa6_red/ajustes.cpp` | La marca de agua en NVS |
| `src/etapa6_red/red.cpp` | Manda la marca, lee la orden |
| `src/etapa6_red/main.cpp` | `aplicarOrden()`, solo desde `ESPERANDO` |
| `app/src/pantallas/ControlarCanilla.tsx` | La pantalla |

## Prueba de aceptación

1. Canillas → **Controlar** → **Reiniciar**. En menos de 30 s la canilla se
   reinicia y la orden pasa a **Aplicada**.
2. Repetilo **mientras está sirviendo**. La orden tiene que quedar en
   **Recibida** y no reiniciar hasta que el cliente saque la tarjeta.
3. Mandale una red con la **clave mal a propósito**. Tiene que reiniciar, no
   conectar, y volver sola a la red anterior.
4. Mandale la red buena. Tiene que quedar andando en la red nueva.
5. Mirá el historial: donde dice la red tiene que estar el **nombre** y en ningún
   lado la clave.

El punto 2 es el que importa. Si una orden puede interrumpir una venta, el
sistema no sirve para un bar.
