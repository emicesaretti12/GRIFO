# La pantalla de cada canilla

Cada canilla tiene su propia pantalla al lado del grifo, mostrando qué cerveza
es, cuánto sale, y qué está pasando con la tirada en curso.

---

## Por qué una tablet y no el TFT del plan original

La etapa 8 del brief hablaba de un ILI9341 o ST7789 conectado al ESP32: 320×240
píxeles, sin sistema de archivos, y cada animación dibujada a mano en C++.

Cargar el logo de cada cerveza, un fondo animado que reaccione al usuario y
actualizarse en vivo es, en esa pantalla, entre imposible y carísimo de mantener.

**La alternativa es una tablet vieja, un celular o un monitor con una Raspberry
Pi**, mostrando una página web de este mismo sistema en modo kiosco:

| | TFT en el ESP32 | Pantalla web |
|---|---|---|
| Logo por cerveza | no | sí |
| Fondo animado | muy limitado | sí |
| Cambiar precio o nombre | recompilar y reflashear | se ve al instante |
| Firmware extra | sí, y bastante | **ninguno** |
| Costo | ~$15 el TFT | una tablet vieja, o ~$40 con una Pi Zero |

Encima, cambiar el precio o la foto de una cerveza no toca el firmware: se edita
en el panel y la pantalla lo refleja sola.

> El TFT sigue siendo válido como versión mínima si alguna canilla no justifica
> una pantalla. Las dos pueden convivir: comen del mismo backend.

---

## Cómo se vincula

**Se conecta sola.** En el panel, **Canillas → Generar/Rotar token**, aparece un
QR. Se escanea con la tablet y listo.

Lo que pasa por atrás:

1. El QR abre `https://…/#/pantalla?grifo=1&token=8537a4ed…`
2. La pantalla guarda la configuración en el navegador de **ese** dispositivo.
3. **Borra el token de la barra de direcciones.** La pantalla está a la vista de
   todo el bar: el token no tiene por qué quedar ahí ni en el historial.
4. De ahí en adelante, con abrir el navegador alcanza. Sobrevive a reinicios y
   cortes de luz.

### Se autentica con el token del grifo, el mismo del ESP32

No hay credenciales nuevas que administrar, y esto sale gratis:

- **Rotar el token desconecta a la vez el ESP32 y la pantalla** de esa canilla.
  Si te robaron la tablet, rotás y la tablet no sirve más.
- **Una pantalla no puede espiar otra canilla**: el token del grifo 1 no abre el
  estado del grifo 2.

### Poner el navegador en modo kiosco

**Android:** Chrome → menú → *Agregar a pantalla principal*. Se abre sin barras.
Conviene también *Ajustes → Pantalla → Suspender: nunca*.

**Raspberry Pi / PC:**

```bash
chromium-browser --kiosk --incognito=false \
  --app="https://TU-APP/#/pantalla"
```

---

## Probarla sin hardware

```
https://grifo-phi.vercel.app/#/pantalla?demo
```

Simula una tirada completa en bucle (canilla libre, tu turno, sirviendo con
una pausa a la mitad, ticket) sin ESP32, sin tarjeta y sin tocar la base: no
llama a Supabase ni guarda nada en el dispositivo. El pie dice
"Demostración" para que nadie la confunda con una canilla real.

Se puede cambiar la cerveza: `?demo&color=2a160b&nombre=Stout&vaso=500`.

---

## Qué muestra

La pantalla tiene dos partes que no compiten:

- **La escena**, en estilo anime: una torre de canilla cromada, la manija con el
  nombre de la cerveza y, sobre la bandeja de goteo, el protagonista: **un vaso
  con cara** que reacciona a lo que pasa. Detrás, la contrabarra con botellas.
- **El panel**: el nombre de la cerveza, el estado y el precio. A la derecha si
  la tablet está acostada; abajo si está parada.

| Estado | La escena | El panel |
|---|---|---|
| **Libre** | El vaso lleno hace de vidriera: canta, guiña, salta, mira para los costados | Rota cada 9 s: "Apoyá tu tarjeta", el precio del vaso, el podio del día |
| **Tu turno** | Entra saltando un vaso vacío, golpe de cámara con "!", ojos de estrella | Saludo según tu historia, saldo, cuánto te alcanza, "Abrí la canilla y serví" |
| **Sirviendo** | Se abre la manija, cae el chorro y el vaso se llena con lo medido, feliz; cerca del límite transpira | Los mL subiendo con el vaso, lo gastado, lo que te queda |
| **En pausa** | Espera mirando la canilla y parpadea | Igual que sirviendo |
| **Ticket** | Pinta perfecta: salta, ojos de estrella y papelitos. Si no, sonrisa, guiño y un corazón | El veredicto, la puntería, lo cobrado y lo que te queda |
| **Fuera de servicio** | El vaso duerme (Zzz y burbujita), luces bajas | Qué pasa, en castellano |

### La escena muestra lo que mide la canilla

No hay temporizadores. Todo sale de los mililitros que manda el ESP32:

- **La manija se abre cuando la medición sube** y se cierra cuando deja de subir
  durante 2,4 s. El ESP32 informa como mucho una vez por segundo y la pantalla
  consulta cada medio segundo, así que con un umbral más corto el chorro
  parpadearía. 2,4 s es menos que los 3 s que espera el propio ESP32 para dar la
  tirada por cortada.
- **El vaso se llena con el volumen, no con la altura.** Una pinta es un cono
  truncado: el mismo volumen ocupa menos altura arriba, donde es más ancha.
- **Entre dato y dato, el vaso sigue subiendo** al caudal que venía midiendo,
  para no avanzar a saltos. Pero **qué vaso es lo decide solo lo medido**: un
  vaso de 473 ml nunca "se pasa" a los 458 por una predicción.
- **Si te servís más de un vaso**, el lleno se va hacia adelante y se apoya uno
  vacío. El panel dice "Vas por el vaso 2".
- **El contador de mililitros y de plata nunca va adelante de lo medido.** El
  vaso puede adelantarse un poco porque es dibujo; la plata, no.

El vaso es un personaje, pero **la actuación sale de los datos**: está nervioso
porque la medición llegó al 86 % del vaso, festeja porque la tirada quedó a
±3 %. No hay nada actuado por reloj que contradiga lo que pasa en la canilla.

### Lo que la hace divertida

**El veredicto.** Al terminar, según qué tan cerca quedaste del vaso: *"Pinta
perfecta"*, *"Generosa"*, *"Sed de verdad"*, *"Leyenda"* si te serviste una
jarra. Un número solo no genera nada; un veredicto sí.

**El podio del día.** Con la canilla libre, rota a mostrar quiénes más tomaron
hoy **en esa canilla**, con las tarjetas enmascaradas.

**Te reconoce.** Al apoyar la tarjeta el saludo cambia según tu historia.

El número de tarjeta va **enmascarado** (`····C3D4`). Es una pantalla a la vista
del público.

### El estilo: anime

- **Dibujo animado, no foto.** Contorno grueso de tinta, colores planos y una
  sombra dura (cel shading). Se lee de lejos en un bar oscuro y le da
  personalidad a cada canilla: el iris de los ojos toma el color de la cerveza.
- **Física de dibujo animado.** El vaso se estira al saltar y se aplasta al
  caer (squash & stretch); la cerveza se sacude con cada salto; la manija rebota
  como un resorte y deja líneas de movimiento.
- **Recursos del anime**: rayos de fondo que giran más rápido cuando pasa algo,
  líneas de concentración (集中線) en los momentos fuertes, golpe de zoom y
  temblor en la pinta perfecta, rubor con rayitas, gota de sudor, notas
  musicales, estrellitas y papelitos.
- **La contrabarra**: estantes con botellas y trama de puntos de manga, pintada
  una sola vez.
- **En el panel**: contador de mililitros con rodillos, ondas en "Apoyá tu
  tarjeta" y una pasada de luz dorada sobre el veredicto.

En la demostración, el pie dice "Demostración, animado".

### Cómo está hecha

- **Canvas 2D, todo con trazos.** No hay imágenes ni modelos: el vaso, la cara,
  la torre y los efectos se dibujan con código, así que cualquier color de
  cerveza funciona y pesa poco. Dos lienzos: el de atrás (la contrabarra) se
  pinta una vez; el de adelante se redibuja en cada cuadro.
- **El motor no pasa por React.** Vive en `app/src/pantalla/pinta/motor.ts`;
  React solo le pasa los datos. El contador de mililitros lo escribe el motor
  directo en el DOM: por el estado de React, la pantalla se re-renderizaría 60
  veces por segundo.
- **Si la tablet no da abasto**, después de 2 s por debajo de ~38 cuadros por
  segundo dibuja a densidad 1. Se ve apenas menos nítido y vuelve a ser fluido.
- **Respeta `prefers-reduced-motion`**: las caras siguen contando el estado,
  pero sin saltos, sin rayos girando, sin golpes de cámara ni papelitos.
- **Los colores salen del color que cargás en el panel.** Con uno alcanza: la
  sombra, el brillo, la espuma y los ojos se derivan de ese tono.

---

## El avance en vivo

Acá hay un detalle que no es obvio: **el ESP32 cuenta los pulsos localmente y
solo liquida al final.** El servidor no se entera de nada mientras se sirve, así
que la pantalla no tendría cómo mostrar el vaso llenándose.

Por eso hay una tercera RPC, `reportar_progreso(sesion, ml, pulsos, token)`, que
el firmware llama cada ~1 s mientras sirve.

**Es puramente informativa: no toca plata ni cambia el estado de la sesión.** Si
esa llamada se pierde, no pasa absolutamente nada — la liquidación sigue siendo
cosa de `cerrar_sesion`, la única que mueve saldo. La pantalla sin datos de
avance sigue funcionando, solo que sin la animación de llenado.

El avance nunca retrocede (`greatest()` en el update): si dos reportes llegan
desordenados por la red, el vaso no da un salto para atrás.

---

## Imágenes

Se suben desde **Canillas → Editar → Cerveza y pantalla**, a un bucket de
Supabase Storage con lectura pública y escritura solo para admins.

La imagen **se achica en el navegador antes de subir** (máximo 900 px, WebP): una
foto de celular son 4 MB y 4000 px de ancho, y la pantalla la muestra a 128. Subir
el original sería tirar ancho de banda del bar y hacer que la pantalla tarde en
pintar.

El nombre del archivo lleva la hora, para que al cambiar la imagen el navegador y
el CDN no sigan mostrando la vieja.
