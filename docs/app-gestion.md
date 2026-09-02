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

Cargar saldo con cuatro montos rápidos o uno a mano. Bloquear la tarjeta si el
cliente la perdió.

Si la tarjeta no está registrada no es un error: la primera carga la da de alta.

### Tarjetas · Grifos · Reportes · Personal
Solo admin. Padrón de tarjetas con saldo en circulación; precios, calibración,
estado y tokens de cada canilla; facturación y volumen por período y por canilla;
alta y baja del personal.

En **Reportes** hay dos alertas que conviene mirar:

- **Cobros recortados** — se sirvió más de lo que había en la tarjeta, o sea que
  el corte local del ESP32 falló. Suele ser calibración mal medida.
- **Cierres reintentados** — al ESP32 no le llegó la respuesta y volvió a mandar.
  Unos pocos son normales; muchos indican problema de red en el bar.

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
