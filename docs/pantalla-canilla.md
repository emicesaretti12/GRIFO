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

## Qué muestra

| Estado | Qué se ve |
|---|---|
| **Libre** | Nombre, estilo, ABV, IBU, descripción, precio por litro y "Apoyá tu tarjeta" |
| **Autorizado** | Saldo del cliente y cuántos mL le alcanzan |
| **Sirviendo** | Los mL que lleva, cuánto gastó y cuánto le queda, con el vaso llenándose |
| **Ticket** | Durante 25 segundos: cuánto sirvió, cuánto se le cobró y con cuánto queda |

El número de tarjeta va **enmascarado** (`····C3D4`). Es una pantalla a la vista
del público: nadie tiene por qué ver el número completo de la tarjeta ajena.

---

## El fondo animado

Un canvas a pantalla completa con la cerveza de **esa** canilla, en el color que
le cargaste: el líquido sube según cuánto lleva servido, las burbujas nacen del
fondo y suben, y arriba se forma espuma.

**Es interactivo:** al tocar la pantalla salen burbujas disparadas desde el dedo
y se dibuja una onda. Es una pantalla en una barra — la gente la va a tocar.

Detalles que importan:

- **Canvas, no CSS.** Son cientos de partículas a 60 fps. Con elementos del DOM
  el navegador recalcularía estilos y layout en cada cuadro; en canvas es una
  sola superficie que se repinta.
- **El nivel persigue al objetivo en vez de saltar.** Un vaso que da un brinco
  cuando llega un dato nuevo se ve roto, aunque el dato sea correcto.
- **Respeta `prefers-reduced-motion`**: si el sistema pide menos movimiento, el
  líquido queda quieto y no hay burbujas.

---

## El avance en vivo

Acá hay un detalle que no es obvio: **el ESP32 cuenta los pulsos localmente y
solo liquida al final.** El servidor no se entera de nada mientras se sirve, así
que la pantalla no tendría cómo mostrar el vaso llenándose.

Por eso hay una tercera RPC, `reportar_progreso(sesion, ml, pulsos, token)`, que
el firmware llama cada ~500 ms mientras sirve.

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
