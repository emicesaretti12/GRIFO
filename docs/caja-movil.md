# Caja móvil — el celular como lector de tarjetas

El mozo acerca la tarjeta al teléfono, ve el saldo y le carga plata **en la
mesa**, sin volver a la caja.

Es la misma aplicación, en la ruta `#/movil`. No hay nada que instalar de una
tienda, y no hay credenciales nuevas: cada persona entra con **su propio
usuario**, así que rigen los mismos permisos que en la versión de escritorio.

---

## Cómo se lleva al teléfono

En el panel, sección **Caja móvil**, hay un QR. Se escanea con el teléfono y
listo.

Para que quede como una app de verdad: en Chrome, con la página abierta, menú →
**Agregar a pantalla principal**. Queda con ícono propio y se abre sin las barras
del navegador.

---

## Qué se puede hacer

- **Leer la tarjeta acercándola al celular**, por NFC
- Ver saldo, estado y últimos movimientos
- **Cargar saldo**, con cuatro montos rápidos o uno a mano
- **Devolver la tarjeta**: se le da en efectivo lo que le sobró y la tarjeta
  queda limpia para el próximo, sin volver a la caja
- Bloquear una tarjeta perdida en el momento

Cada carga queda firmada con el usuario que la hizo, igual que en la caja fija.

Al leer una tarjeta el teléfono **vibra corto**, y al confirmar una carga vibra
distinto. En un bar ruidoso esa es la única confirmación que el mozo va a
registrar sin mirar la pantalla.

---

## El límite del NFC en la web ⚠️

**Web NFC funciona en Chrome sobre Android, y sobre HTTPS. En iPhone no existe** —
Apple no le da acceso al NFC a las páginas web, y no es algo que se pueda
resolver del lado nuestro.

| | |
|---|---|
| Android + Chrome + HTTPS | ✅ escanea |
| Android + Chrome + HTTP o IP local | ❌ el navegador lo bloquea |
| iPhone, cualquier navegador | ❌ Apple no lo expone |
| Computadora | ❌ (salvo con lector NFC USB, que es otra cosa) |

**Cuando no puede escanear, la pantalla lo dice y explica por qué**, y ofrece
cargar el número a mano. Todo lo demás funciona igual: lo único que cambia es
cómo entra el UID.

> Si necesitás iPhone sí o sí, la salida es una app nativa — Apple sí expone el
> NFC a apps de la App Store, no a la web. Es un proyecto aparte y bastante más
> caro de mantener.

### Que el NFC no esté prendido

Es el error más común y la pantalla lo distingue: si el teléfono tiene NFC pero
está apagado, dice *"El NFC está apagado, prendelo desde los ajustes rápidos"*,
en vez de un error genérico.

---

## Que el UID coincida con el del grifo

Este es el detalle que puede arruinar todo silenciosamente.

El teléfono reporta el UID como `04:5a:2b:c1` y el MFRC522 del grifo lo reporta
como `045A2BC1`. La app **normaliza** lo que lee —saca los separadores y pasa a
mayúsculas— por el mismo camino que usa el lector USB de la caja. Un solo formato
en toda la aplicación es lo que evita que la misma tarjeta se cargue con un
número y el grifo la lea con otro: el cliente paga y la canilla no lo reconoce.

**Verificalo al empezar:** escaneá una tarjeta con el celular, anotá el número, y
compará con el que muestra el monitor serial del ESP32 en la etapa 2. Si no
coinciden, avisá antes de cargar tarjetas de verdad.

La app además avisa si el número leído no tiene forma de UID de 4, 7 o 10 bytes.

### Tarjetas MIFARE Classic

Las tarjetas que vienen con el MFRC522 suelen ser MIFARE Classic. **Algunos
Android no las leen**: depende del chip NFC del teléfono (los Broadcom viejos no
las soportan). Si el celular no detecta nada pero sí lee otras tarjetas, es
probablemente eso — y la salida es usar tarjetas NTAG213/215, que lee cualquier
teléfono.

---

## Batería

El escaneo se corta solo cuando la pantalla se va a segundo plano. Dejar la
antena encendida todo el turno se come la batería del teléfono del mozo, y ese
teléfono no es del bar.
