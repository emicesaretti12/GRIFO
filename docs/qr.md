# El QR: cómo se identifica el cliente

Desde este cambio no hay tarjetas. El cliente muestra un **código QR** en la
tablet del grifo, la tablet lo lee con su cámara y, si tiene saldo, se abre la
canilla. El ESP32 no cambió de trabajo: sigue preguntando una vez por segundo
si hay alguien para servir.

```
cliente muestra QR ─▶ tablet (cámara) ─▶ Supabase: ¿vale? ¿tiene saldo?
                                              │ abre la sesión
                      ESP32 (sondea c/1 s) ◀──┘ abre la válvula, mide, cobra
```

Hay dos formas de tener un QR.

## 1. Con el celular: la app del cliente

Dirección: `https://TU-SITIO/#/cliente` (el QR para imprimir está en
**Cuentas**, abajo de todo).

1. Entra con **nombre y DNI**. No hay contraseña.
2. Carga saldo con **Mercado Pago**, o en efectivo en la caja.
3. **Toca su tarjeta** y aparece el QR. Lo acerca a la tablet del grifo.

**La cuenta queda unida al celular.** La primera vez, el navegador guarda un
secreto al azar y el servidor guarda su huella. Con el mismo DNI desde otro
celular no se entra.

> Es una cookie de "recordarme" sin formulario de login adelante. El DNI dice de
> quién es la cuenta; el secreto, que el que pregunta es el dueño.

- **Cambió de celular, o borró los datos del navegador:** en la caja, se busca
  su DNI y se toca **Cambió de celular**. Hay que mirarle el DNI: el primero que
  entre después con ese DNI y el nombre correcto se queda con el saldo.
- **Modo incógnito:** funciona, pero al cerrar la pestaña se pierde el secreto y
  hay que pasar por la caja.

**El QR dura 90 segundos** y se renueva solo mientras está en pantalla. Una
captura mandada por WhatsApp ya no sirve cuando el otro llega al grifo.

### Cargar efectivo a la app

Debajo del QR hay un **código de 6 números**. El cliente se lo dice al cajero,
que lo escribe en el buscador de la caja: aparece la cuenta de la app y se le
carga. No se imprime nada; el saldo aparece solo en el celular.

## 2. Sin celular: el ticket de la caja

1. El cajero escribe el **DNI**, el nombre, el monto y cómo paga.
2. **Cobrar e imprimir el ticket**: sale un papel con la carga, el saldo y un QR.
3. El cliente muestra ese QR en la tablet.

- El QR del ticket vale **hasta las 6:00** (el cierre de esa noche). Las
  recargas de la misma noche imprimen el mismo QR: el papel viejo sigue
  sirviendo.
- El **saldo no vence**: queda a nombre de ese DNI. Otra noche, se busca el DNI
  y **Reimprimir ticket** le da un QR nuevo con lo que tenía.
- **Perdió el ticket:** se busca el DNI y **Perdió el ticket**. El anterior deja
  de servir en el momento.
- El ticket es al portador, como la plata: el que lo tiene, se sirve.

### La impresora

El ticket está pensado para una **térmica de 80 mm** (o de 58: se elige en el
diálogo y queda guardado). Sale por el diálogo de impresión del navegador; hay
que elegir esa impresora y sacarle los márgenes y los encabezados. Si no hay
térmica, en una hoja común sale arriba a la izquierda y se recorta.

Para que imprima sin preguntar, Chrome se puede abrir con `--kiosk-printing`.

## Por qué un DNI puede tener dos saldos

El de la **app** y el del **ticket** son cuentas separadas y no se mezclan.

El DNI lo sabe cualquiera. Si con decir un DNI en la caja se cargara la cuenta
de la app de ese DNI, alguien podría anotarse en la app con el DNI de otro y
tomarse lo que el dueño verdadero cargue después. Por eso:

- por **DNI** en la caja se llega solo al ticket (un papel que tiene él);
- a la cuenta de la **app** se llega solo con el código de 6 números, que ve
  únicamente quien tiene ese celular en la mano.

## La tablet

- La cámara arranca sola. La **primera vez** el navegador pide permiso: hay que
  aceptarlo y queda guardado para ese sitio.
- En el pie dice **Cámara lista**. Si dice **Sin cámara**, falta el permiso (el
  candado de la barra de direcciones) u otra app la está usando.
- Usa la cámara **del frente**. Para cambiar a la de atrás, mantener apretado el
  recuadro de la cámara dos segundos.
- Un QR sostenido frente a la cámara es **un solo pedido**. Para volver a pedir
  hay que sacarlo de cuadro un momento: el celular olvidado frente a la tablet
  no abre otra tirada.
- Si el ESP32 no dio señales en dos minutos, la pantalla dice **Fuera de
  servicio** y no lee: antes abría una sesión que nadie iba a servir.

**A probar en el bar, con la luz real:** que la cámara lea un ticket de papel.
La pantalla de un celular tiene luz propia; el papel no. Si cuesta, una luz
chica arriba de la tablet lo resuelve.

## Qué pasa con las tarjetas viejas

No abren ninguna canilla. Las que tenían saldo siguen en **Cuentas** como
"Tarjeta vieja", con un botón para devolverlo en efectivo.

## Con SEN POS en la misma base

El sistema de canillas y SEN POS comparten la billetera (`tarjetas`). Para que
no se pisen:

- **Lo que cobra la caja de canillas entra al turno de caja del POS**, con su
  medio de pago, y las devoluciones salen como egreso. Sin turno abierto en el
  POS, la caja de canillas no cobra: el arqueo ciego del POS siempre cuadra.
- **La billetera de la app del POS también sirve en las canillas**: pide un QR
  temporal con `app_generar_pase()` (cambio en `sen-pos-qr-canilla.patch`), y la
  caja la encuentra por el código de 6 números.
- Las tablas propias se llaman `clientes_qr` y `recargas_mp`: el POS ya tiene
  `clientes` y `pagos`.

Probado sobre una copia de producción: las pruebas de las canillas, las del POS
completas y `33-pruebas-con-pos.sql`.

## Instalar

En el editor SQL de Supabase, en este orden:

1. `supabase/29-qr.sql`
2. `supabase/31-mercadopago.sql`

Los `30-…`, `32-…` y `33-…` son pruebas: se pueden correr, no dejan rastro.

Después, Mercado Pago: [mercado-pago.md](mercado-pago.md).
