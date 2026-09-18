# Rediseño: la tarjeta la lee la tablet

La identidad se va del grifo a la tablet. El ESP32 deja de ser el que decide
todo y pasa a ser **un actuador con un medidor**.

---

## Cómo funciona

1. El cliente **toca la tarjeta contra la tablet** que está al lado de la canilla
2. La tablet muestra **su nombre y su saldo**
3. Si tiene saldo, la tablet **abre la sesión** en Supabase
4. El ESP32 lo ve y **abre la solenoide**
5. El cliente **abre el grifo manual** y se sirve
6. **Tres segundos sin cerveza** = cerró el grifo → la solenoide cierra
7. Se cobra exacto lo que salió

Una tablet por canilla. La tablet ya sabe cuál es su canilla, así que el cliente
no elige nada.

---

## Lo que se cae

| Pieza | Por qué |
|---|---|
| **MFRC522** | La tarjeta la lee la tablet por NFC |
| **El botón** | El permiso lo da la tablet |
| **La presencia de la tarjeta** | El grifo ya no sabe quién está parado ahí |

El lector sale del cableado. Los pines `P5` `P18` `P19` `P22` `P23` quedan
libres.

---

## Lo que NO cambia, y no es negociable

**El corte lo sigue decidiendo el ESP32 comparando dos enteros.** La sesión le
llega con su límite ya convertido a pulsos, y de ahí en adelante no consulta a
nadie. Si se cae la red a mitad de un servicio, corta igual.

Que la tarjeta la lea otro aparato no cambia quién es responsable de cerrar la
válvula.

> Es validar del lado del servidor aunque el formulario ya haya validado. El que
> ejecuta la acción es el que tiene que poder decir no.

También siguen igual la cola de cierres en NVS, el latido, y el portal de WiFi.

---

## El problema nuevo: avisarle al grifo

Antes el ESP32 **veía** al cliente. Ahora el cliente se identifica en otro
aparato y alguien tiene que avisarle al grifo.

Y eso no es gratis: **el ESP32 está detrás del router del bar, sin IP pública.**
Nadie de afuera le puede iniciar una conversación.

> Es el problema del webhook que no podés recibir. La solución no es esperar el
> empujón: es preguntar seguido.

### Por qué no lo llama la tablet directo

Sería lo ideal: la tablet está en la misma red y el ESP32 ya corre un servidor
web. Latencia de milisegundos.

**No se puede.** La app se sirve por HTTPS, y un navegador **bloquea** que una
página HTTPS llame a `http://172.20.10.7`. Es contenido mixto, y no hay bandera
que lo habilite en una tablet de producción.

### Entonces el grifo pregunta, y pregunta rápido

Una orden de "reiniciate" puede tardar 30 segundos. **"Abrí, que el cliente está
esperando" no.**

| Estado | Cada cuánto pregunta |
|---|---|
| `ESPERANDO` | **1 segundo** |
| Sirviendo | no pregunta: ya tiene todo lo que necesita |

Un segundo alcanza porque el cliente igual tarda dos o tres en leer su saldo y
caminar hasta el grifo. El costo son unos 86.000 pedidos por día por canilla, de
una función deliberadamente barata.

> Es elegir el intervalo del polling por la latencia que querés, no por lo que
> parece prolijo. Y saber lo que eso cuesta.

**Si ese costo molesta**, el próximo paso es un WebSocket a Supabase Realtime: el
servidor empuja y el grifo no pregunta. Es bastante más trabajo en el ESP32 y no
hace falta para arrancar.

---

## La máquina de estados nueva

```
ESPERANDO ──(aparece una sesión)──> HABILITADO ──(primer pulso)──> SIRVIENDO
    ^                                    │                            │
    │                                    │ 30 s sin abrir el grifo    │ 3 s sin pulsos
    │                                    v                            v
    └────────────── LIQUIDANDO <───────────────────────────────── PAUSA
                                                                   │ ^
                                                    25 s sin volver │ │ vuelve a
                                                                   v │ correr
                                                              LIQUIDANDO
```

| Estado | Válvula | Qué espera |
|---|---|---|
| `ESPERANDO` | cerrada | Que aparezca una sesión |
| `HABILITADO` | **abierta** | Que el cliente abra el grifo manual |
| `SIRVIENDO` | abierta | Que siga corriendo |
| `PAUSA` | cerrada | Que el cliente vuelva, o que se acabe la gracia |
| `LIQUIDANDO` | cerrada | Guardar el cierre y cobrar |

### Los tres plazos, y por qué son distintos

```c
ESPERA_PRIMER_PULSO_MS = 30000   // caminar hasta el grifo y abrirlo
FIN_DE_SERVICIO_MS     =  3000   // cerró el grifo: terminó
GRACIA_PAUSA_MS        = 25000   // se puede volver sin tocar la tablet
```

**30 segundos para empezar** porque el cliente tiene que caminar. **3 segundos
para terminar** porque el grifo cerrado es la señal de que terminó.

Son el mismo evento —"no hay pulsos"— con dos significados opuestos según el
momento. Un solo plazo para los dos sería o demasiado corto para llegar al
grifo, o demasiado largo para cerrar.

> Es el timeout de conexión contra el de inactividad. Miden distinto y no pueden
> compartir número.

### La pausa: por qué la válvula se asoma

Acá hay algo físico que condiciona el diseño. **La solenoide está antes del grifo
manual.** Si la solenoide está cerrada y el cliente abre el grifo, no pasa
líquido — y sin líquido no hay pulsos. **El grifo no tiene forma de avisar que lo
abrieron.**

La salida es que la válvula **se asome**: abre 200 ms cada tanto. Si el grifo
está abierto, sale cerveza, aparecen pulsos, y la sesión sigue. Si está cerrado,
no sale nada.

Y es seguro por una razón concreta: **la única forma de entrar en pausa es que el
grifo esté cerrado.** Con el grifo cerrado, la válvula abierta no entrega nada.

Los sondeos van con espera creciente —3, 6, 10, 15, 22 segundos— así son cinco
en toda la gracia y no veinte. Cada ciclo de la bobina es un pico de tensión;
menos ciclos es menos castigo.

```c
static const uint32_t SONDEOS[] = { 3000, 6000, 10000, 15000, 22000 };
static const uint32_t SONDEO_MS = 200;
```

**Para desactivarlo** y volver al comportamiento literal (3 segundos y se
liquida), `GRACIA_PAUSA_MS = 0`.

---

## Del lado de Supabase

`abrir_sesion` y `cerrar_sesion` **ya hacen todo lo que hace falta** y no se
tocan. La tablet llama a la primera; el ESP32, a la segunda.

Se agrega una sola función, para que el grifo pueda preguntar:

```
canilla_sesion_activa(p_grifo, p_token)
  -> { ok, sesion_id, uid, cliente, ml_maximos,
       pulsos_por_litro, precio_litro_centavos, saldo_centavos }
```

Deliberadamente barata: un `select` de una fila por un índice. La llama cada
canilla una vez por segundo, para siempre.

### La trampa de la idempotencia

Si el ESP32 liquida una sesión y **la red se cae antes de entregar el cierre**,
la sesión sigue `abierta` del lado del servidor. El próximo sondeo la devolvería
y el grifo **volvería a abrir la válvula** para una sesión ya cobrada.

Se resuelve con el mismo patrón que la cola de cierres: una **marca de agua en
NVS**. El ESP32 anota el id de la última sesión que liquidó e ignora todo id
menor o igual, aunque el servidor insista.

> Es el offset del consumidor. El servidor no es la única fuente de verdad sobre
> lo que ya procesaste.

---

## Del lado de la tablet

### El límite que define la compra

⚠️ **Web NFC existe solo en Chrome sobre Android.** Un iPad **no puede** leer una
tarjeta desde el navegador: Apple no expone NFC a la web.

Si las tablets son Android, andamos con la app que ya existe. Si alguna es iPad,
para esa canilla hace falta una app nativa o volver al lector.

### La pantalla

Es la pantalla de la canilla que ya existe (`#/pantalla?grifo=N&token=...`), con
tres estados nuevos:

| Momento | Qué muestra |
|---|---|
| En reposo | La cerveza, su precio, "Apoyá tu tarjeta" |
| Al leer la tarjeta | **"Hola, Emi" + su saldo** y cuánto puede servirse |
| Sirviendo | El vaso llenándose, los ml y los pesos en vivo |
| Al terminar | Lo que salió, lo que se cobró, el saldo que le queda |

El saldo y el mensaje de bienvenida salen de la respuesta de `abrir_sesion`, que
ya los devuelve. No hace falta una consulta aparte.

---

## Lo que hay que construir, en orden

| | Pieza | Se prueba con |
|---|---|---|
| 1 | `canilla_sesion_activa` + pruebas SQL | Postgres local |
| 2 | Etapa 7: firmware sin lector ni botón | Soplando el caudalímetro |
| 3 | NFC en la pantalla de la canilla | Una tablet Android |
| 4 | Todo junto, con cerveza | El bar |

Cada una se prueba sola antes de pasar a la siguiente. La etapa 6 sigue
compilando y flasheable: si el rediseño falla, se vuelve con un comando.

---

## Lo que queda pendiente de antes, y ahora pesa más

**El diodo 1N4007.** Con los sondeos de la pausa, la bobina cicla más que antes.
Cada cierre sin diodo es un pico que ya vimos resetear la placa. **Con la válvula
abriendo sola, un reset a mitad de servicio deja la válvula cerrada pero la
sesión abierta** — el cliente se queda sin cerveza y con la sesión trabada hasta
que el barrido de abandonadas la limpie.

Antes era una molestia. Ahora es lo primero de la lista.
