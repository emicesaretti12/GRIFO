# Etapa 7 — La tarjeta la lee la tablet

El ESP32 deja de ver al cliente. Se caen el lector RFID y el botón; queda **un
actuador con un medidor**.

El diseño completo y el porqué de cada decisión están en
[`rediseno-tablet.md`](rediseno-tablet.md). Esto es cómo se prueba.

---

## Antes de flashear: mover el `secrets.h`

La capa de red (`red`, `cola`, `ajustes`, `portal`) se mudó a `src/nube/`
porque ahora la usan **las dos etapas**. El `secrets.h` tiene que ir con ella:

```
move src\etapa6_red\secrets.h src\nube\secrets.h
```

En Linux:

```bash
mv src/etapa6_red/secrets.h src/nube/secrets.h
```

Es el único paso manual. Sin eso no compila **ninguna** de las dos etapas.

---

## Flashear

```
python -m platformio run -e etapa7_tablet -t upload
```

Con los **12 V desenchufados** y el monitor cerrado.

La etapa 6 sigue existiendo y se puede volver con un comando:

```
python -m platformio run -e etapa6_red -t upload
```

---

## La máquina de estados

| Estado | Válvula | Sale cuando |
|---|---|---|
| `ESPERANDO` | cerrada | Aparece una sesión en el sondeo |
| `HABILITADO` | **abierta** | Llega el primer pulso · o pasan 30 s |
| `SIRVIENDO` | abierta | 3 s sin pulsos · límite · 90 s |
| `PAUSA` | cerrada, se asoma | Vuelve a correr · o pasan 25 s |

Los tres plazos miden lo mismo —"no llegan pulsos"— y significan cosas
distintas según el momento.

---

## Las pruebas, en orden

### 1. Arranca y queda esperando

```
 GRIFO - ETAPA 7: LA TARJETA LA LEE LA TABLET
Canilla           : 1
Lector RFID       : no se usa
Boton             : solo para el portal
[red] conexion lista en ~1900 ms
```

La válvula tiene que estar **cerrada** y quedarse así sola.

### 2. La tablet abre y la válvula responde

Apoyá la tarjeta en la tablet. **En menos de 2 segundos**:

```
Hola Emi | saldo $12400,00 | hasta 3875 ml (1754 pulsos)
Abri el grifo cuando quieras.
[   9520 ms] ESPERANDO -> HABILITADO
```

Y se tiene que escuchar el **clic del relé**.

### 3. Sale cerveza al abrir el grifo

```
>> Empezo a salir. Sirviendo.
   sirviendo... 130 ml  (59/1754 pulsos)
```

### 4. Cerrar el grifo NO cierra la válvula todavía

Cerrá el grifo manual. A los 3 segundos sin pulsos:

```
>> Dejo de correr. Le espero 7 s por si sigue.
```

**La válvula queda abierta y no vas a escuchar ningún clic.** Eso es a
propósito. Antes la canilla cerraba y cada tanto "asomaba" para ver si el
cliente había vuelto, pero ese asomo hacía girar la turbina y el firmware lo
leía como "volvió a servir". El mecanismo que servía para medir era el mismo que
perturbaba lo medido, y la sesión no liquidaba nunca.

Si escuchás clics repetidos acá, estás con firmware viejo.

### 5. Volver a abrir reanuda, y la espera se agranda

Dentro de esos 7 segundos, abrí el grifo de nuevo:

```
>> Siguio sirviendo. La proxima espera 10 s.
```

Cada pausa que el cliente completa le suma 3 segundos a la próxima espera, hasta
un techo de 16. La canilla aprende que **esta persona** toma con pausas y deja
de apurarla; con un cliente que se sirve de una, sigue cerrando a los 7.

Repetilo tres o cuatro veces y mirá cómo sube el número. Esa es la prueba de que
la espera es adaptativa y no un temporizador fijo.

### 6. Al final cobra una sola vez

Cerrá el grifo y esperá sin tocar nada hasta que se agote la espera:

```
>> Se fue. Cierra y cobra lo servido.
================ TICKET ================
 Cliente   : Emi
 Servido   : 480 ml  (217 pulsos)
```

Ahí sí escuchás **un** clic. Y en la app, **un solo cobro** por todo lo servido,
pausas incluidas.

### 7. Nadie abre el grifo

Apoyá la tarjeta y no toques nada. A los 30 segundos:

```
>> Nadie abrio el grifo. Cierra sin cobrar.
```

Con **0 ml** y sin cobrar nada.

### 8. La que importa de verdad: no cobrar dos veces

Cortá el WiFi, serví, dejá que liquide. El cierre queda en la cola.

**Con el WiFi todavía cortado**, la sesión sigue `abierta` del lado del
servidor. Volvé a prender el WiFi.

La canilla **no** tiene que volver a abrir la válvula. Tiene que entregar el
cierre y nada más:

```
[red] entregando cierre sesion=128 ml=480 (quedan 1)
[red] cierre confirmado
```

Eso es la marca de agua haciendo su trabajo. Sin ella, la canilla serviría de
nuevo gratis cada vez que se corta el WiFi a mitad de una venta.

---

## Lo que NO cambió

El corte lo sigue decidiendo esta placa comparando dos enteros. Probalo: cortá
el WiFi **mientras sirve** y dejá que llegue al límite. Tiene que cortar igual.

---

## Si algo no anda

| Síntoma | Dónde mirar |
|---|---|
| No compila, falta `secrets.h` | Mové el archivo a `src/nube/` |
| La tablet abre pero la válvula no | ¿Corriste `26-sesion-activa.sql`? ¿La canilla dice *En línea*? |
| Tarda más de 3 s en abrir | El sondeo es cada 1 s; si tarda más, mirá la señal WiFi en el latido |
| Sirve y no corta al cerrar el grifo | El caudalímetro sigue contando: puede ser aire en la línea |
| Se reinicia al cerrar la válvula | El diodo. Ver la trampa 7 en `pinout-y-trampas.md` |
