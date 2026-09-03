# App de gestión

La aplicación web donde el personal del restaurante maneja el sistema: cargar
saldo en caja, administrar canillas, ver reportes.

**Stack:** React + Vite + TypeScript + `@supabase/supabase-js`. Es una SPA sin
servidor propio: habla directo con Supabase, y toda la seguridad vive en la base.

---

## El principio de diseño

La app corre en un navegador, así que **no puede usar la service_role key**:
cualquiera abre las devtools y se lleva la llave maestra del sistema. Es el mismo
error que grabar la secret key en el firmware.

Entonces cada persona entra con su propio usuario y **la base decide qué puede
hacer**. La pantalla que no muestra un botón es una comodidad, no una defensa: si
el cajero llamara la API a mano, la base lo rebota igual.

| Quién | Con qué llave | Qué puede |
|---|---|---|
| ESP32 de la canilla | anon (pública) + token del grifo | abrir y cerrar sesiones |
| Cajero | su login | cargar saldo, consultar y bloquear tarjetas |
| Admin | su login | lo anterior + precios, calibración, tokens, reportes, personal |

Detalle de cómo está implementado en
[`../supabase/07-personal.sql`](../supabase/07-personal.sql).

### Por qué el cajero no lee tablas

El cajero **no tiene permiso de lectura sobre ninguna tabla**. Opera solo por
RPC, que le devuelve la tarjeta que consultó y nada más.

Si le diéramos un `select` sobre `movimientos`, podría bajarse la facturación del
día o el padrón entero de tarjetas con una request. Ocultar el botón en la
pantalla no cambiaría nada. Por eso la restricción está en la base.

El admin sí lee tablas, vía políticas RLS. Aun así, en `grifos` el permiso es
**por columna**: ni el admin ve `token_hash`.

---

## Puesta en marcha

```bash
cd app
npm install
cp .env.example .env.local     # y completá la URL y la anon key
npm run dev                    # http://localhost:5173
```

Las dos variables salen de Supabase → **Project Settings → API**:

```
VITE_SUPABASE_URL=https://bkrwabezndztkldwygjd.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

> La anon/publishable key **es pública por diseño** y está bien que viaje al
> navegador: lo que protege los datos es el login del personal más las policies,
> no el secreto de esa clave. La **service_role / secret key no va acá ni en
> ningún lado del front.**

### El primer usuario

Huevo y gallina: `admin_set_rol` exige ser admin, así que el primero no puede
crearse desde la app. Se hace una vez:

1. Supabase → **Authentication → Users → Add user**, con tu mail y una
   contraseña. Marcá **Auto Confirm User** para no tener que validar el mail.
2. Corré [`supabase/09-primer-admin.sql`](../supabase/09-primer-admin.sql) en el
   SQL Editor. Si el usuario todavía no existe, el script corta con un mensaje
   que te dice exactamente eso en vez de fallar en silencio.

De ahí en adelante, al resto del personal lo das de alta desde la pantalla
**Personal**.

### Publicar

`npm run build` deja todo en `dist/`, que son archivos estáticos. Se sube a
Vercel, Netlify, o se sirve desde cualquier lado — incluso una tablet en la barra
en modo kiosco. No hay servidor que mantener.

---

## Las pantallas

### Caja
La que más se usa. Apoyás la tarjeta en el lector y aparece la ficha: saldo,
estado, últimos 15 movimientos y si está sirviendo en este momento.

Cargar saldo con cuatro montos rápidos o uno a mano. Bloquear la tarjeta pide un
motivo, que queda guardado con quién la bloqueó.

Si la tarjeta no está registrada no es un error: la primera carga la da de alta.

**F2** devuelve el foco al campo de la tarjeta desde cualquier parte de la
pantalla, sin sacar la mano del teclado.

### Panel (admin)
Cómo viene el día: facturado, servido, promedio por tirada y cuántas canillas
están sirviendo en este momento. Facturación de los últimos 14 días y ranking por
canilla. Se refresca solo cada 20 segundos, y **solo mientras la pestaña está
visible** — no tiene sentido pegarle a la API para una pantalla que nadie mira.

Arriba de todo aparecen las alertas que hay que atender: canillas en servicio sin
token, cobros recortados y sesiones sin liquidar.

### Tarjetas (admin)
Padrón con saldo en circulación, filtros por estado y exportación a CSV.

> El **saldo en circulación** es plata ya cobrada que el bar todavía debe en
> cerveza. Es un pasivo, no una ganancia.

### Canillas (admin)
Precio, calibración, estado y tokens. Editar abre un diálogo que muestra, mientras
escribís el precio, **cuánto va a salir un vaso de 473 ml** — así el número tiene
sentido antes de guardarlo.

Generar o rotar un token pide confirmación explícita (el token viejo muere al
instante) y después lo muestra una sola vez, con botón para copiarlo.

### Reportes (admin)
Facturación y volumen por período (7 / 14 / 30 / 90 días), con gráfico por día y
ranking por canilla. Exportación a CSV de todas las tiradas.

Dos alertas que conviene mirar:

- **Cobros recortados** — se sirvió más de lo que había en la tarjeta, o sea que
  el corte local del ESP32 no llegó a tiempo. Casi siempre es la calibración mal
  medida en esa canilla.
- **Cierres reintentados** — al ESP32 no le llegó la respuesta y volvió a mandar.
  La idempotencia evitó el cobro doble, pero muchos reintentos indican problema
  de WiFi en el bar.

### Personal (admin)
Alta, cambio de rol y baja. Sobre tu propio usuario no se ofrece ninguna acción:
bajarte el rol te dejaría afuera, y si sos el único admin no queda nadie que
pueda arreglarlo.

---

## Detalles de la interfaz

**Nada de `confirm()` ni `prompt()`.** Todo lo destructivo pasa por un diálogo
propio con foco atrapado, cierre con Escape y un botón que dice qué va a hacer
("Rotar token", "Dar de baja") en vez de un "Aceptar" genérico.

**Avisos en una esquina, no carteles que empujan el contenido.** Cuando aparece
un mensaje el layout no salta y no perdés de vista lo que estabas mirando. Los
errores duran casi el doble que las confirmaciones: hay que poder leerlos.

**Skeletons mientras carga**, no un "Cargando…". Ves la forma de lo que viene y
la página no se reacomoda de golpe cuando llegan los datos.

**Modo claro y oscuro.** Por defecto sigue al sistema operativo; el botón de la
barra lateral fija tu elección y queda guardada. Los colores de los gráficos
están definidos por separado para cada modo, no son un invertido automático.

**Los gráficos** usan una paleta verificada para daltonismo y contraste sobre las
dos superficies. Barras finas con la punta redondeada, grilla apenas visible, y
**una sola etiqueta directa** (el máximo) en vez de un número sobre cada barra,
que se vuelve ruido. Los mismos datos van en una tabla oculta para lectores de
pantalla, así la información no depende de poder ver el gráfico.

**Red de contención.** Si algo falla al dibujar, se ve un mensaje con el error y
un botón de recargar, no una pantalla en blanco.

---

## El lector RFID USB

Estos lectores se presentan al sistema operativo como un **teclado**: al apoyar
la tarjeta "tipean" el UID muy rápido y cierran con Enter. Para el navegador es
indistinguible de alguien escribiendo… salvo por la velocidad.

De eso se agarra [`useLectorRFID`](../app/src/lib/useLectorRFID.ts): escucha el
teclado a nivel documento y, si llegan varios caracteres con menos de 60 ms entre
sí y termina en Enter, asume que fue el lector.

Escucha global en vez de un input con foco, a propósito: el foco se pierde con
cualquier clic, y en una caja con gente esperando eso es un problema real. Así el
cajero puede estar en cualquier parte de la pantalla y la tarjeta igual se lee.

### El formato del UID

No todos los lectores devuelven lo mismo para la misma tarjeta: unos dan
hexadecimal (`A1B2C3D4`) y otros decimal (`2712847316`).

Si no se normaliza, la misma tarjeta se carga en caja con un UID y el ESP32 la
lee con otro: **el cliente paga y el grifo no lo reconoce.** La base guarda
siempre hexadecimal en mayúsculas, que es lo que reporta el MFRC522 de la
canilla, y [`uid.ts`](../app/src/lib/uid.ts) traduce lo que venga.

En la pantalla de Caja hay un selector **Lector: Hexadecimal / Decimal**. Se
configura una vez por puesto y queda guardado en ese navegador.

**Cómo saber cuál te tocó:** apoyá una tarjeta con el cursor en un editor de
texto. Si sale algo como `A1B2C3D4`, es hexadecimal. Si sale solo dígitos y
tiende a 10 caracteres, es decimal.

---

## Plata

Todo en **centavos enteros**, igual que en la base y en el firmware. Los floats
binarios no representan 0.1 exacto, así que sumar precios arrastra error — el
clásico `0.1 + 0.2 === 0.30000000000000004`.

[`plata.ts`](../app/src/lib/plata.ts) convierte en el borde: `aCentavos()` toma
lo que el cajero tipea (`"1.500,50"`) y devuelve enteros; `pesos()` formatea para
mostrar. En el medio nunca hay decimales.

---

## "Creo que estoy viendo una versión vieja"

Entre el caché del navegador, el del hosting y un `git pull` que no se hizo, hay
demasiadas formas de estar mirando algo viejo sin enterarse. Por eso la app
**muestra con qué commit se compiló**:

- En la **app de gestión**, abajo de todo en la barra lateral: `v 6a819f2`.
  Pasando el mouse dice también la fecha de compilación.
- En la **pantalla de canilla**, en la esquina inferior derecha, muy tenue.

Para comparar contra lo último del repo:

```bash
git log -1 --format=%h
```

Si los dos números coinciden, estás viendo lo último. Si no:

```bash
git pull
npm install      # por si cambiaron dependencias
npm run dev
```

Y si estás mirando la versión publicada, forzá la recarga con **Ctrl+Shift+R**:
el navegador cachea el HTML y a veces se queda con el anterior aunque el deploy
haya terminado.
