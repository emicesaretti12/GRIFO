# Backend en Supabase

Todo el lado servidor del grifo: dos RPC atómicas, el esquema y el modelo de
permisos. **No necesita hardware** — se prueba entero desde el editor SQL de
Supabase y con `curl`.

## Archivos

| Archivo | Qué hace |
|---|---|
| [`supabase/01-schema.sql`](../supabase/01-schema.sql) | Tablas, índices y RLS |
| [`supabase/02-funciones.sql`](../supabase/02-funciones.sql) | Las dos RPC + mantenimiento + permisos |
| [`supabase/03-seed.sql`](../supabase/03-seed.sql) | Datos de prueba (incluye el ejemplo del contrato) |
| [`supabase/04-pruebas.sql`](../supabase/04-pruebas.sql) | Suite de pruebas. Corre en transacción y hace ROLLBACK |
| [`supabase/05-permisos.sql`](../supabase/05-permisos.sql) | Verifica que la anon key no pueda tocar nada más |

## Cómo aplicarlo

En el proyecto de Supabase → **SQL Editor** → pegar y ejecutar **en orden**:

```
01-schema.sql → 02-funciones.sql → 03-seed.sql → 04-pruebas.sql → 05-permisos.sql
```

Los tres primeros son idempotentes: se pueden volver a correr sin romper nada.
Los dos últimos son verificaciones y no dejan rastro.

Salida esperada:

```
✅ TODAS LAS PRUEBAS PASARON
✅ PERMISOS OK — anon solo puede ejecutar las dos RPC
```

> Ya se corrieron los cinco contra un PostgreSQL 16 local, dos veces seguidas,
> y pasan. Pero conviene correrlos igual en Supabase: confirma que el proyecto
> real quedó bien configurado.

## Probar con curl

```bash
SUPA=https://bkrwabezndztkldwygjd.supabase.co
KEY=tu-anon-key     # nunca la commitees; exportala en tu shell

curl -s -X POST "$SUPA/rest/v1/rpc/abrir_sesion" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_uid":"A1B2C3D4","p_grifo":1}'
# {"ok":true,"sesion_id":1,"saldo_centavos":850000,
#  "precio_litro_centavos":320000,"pulsos_por_litro":452.700,"ml_maximos":2656}

curl -s -X POST "$SUPA/rest/v1/rpc/cerrar_sesion" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_sesion_id":1,"p_ml":473,"p_pulsos":214}'
# {"ok":true,"saldo_centavos":698640,"ml_servidos":473,"costo_centavos":151360}
```

Y para comprobar que las tablas están cerradas — esto **tiene** que fallar:

```bash
curl -s "$SUPA/rest/v1/tarjetas?select=*" -H "apikey: $KEY"
# {"code":"42501","message":"permission denied for table tarjetas"}
```

---

## MCP de Supabase

El repo trae un [`.mcp.json`](../.mcp.json) con el servidor MCP de Supabase
apuntando al proyecto `bkrwabezndztkldwygjd`. Sirve para que Claude Code pueda
aplicar migraciones, consultar el esquema y leer logs sin salir de la terminal.

**No hace falta para trabajar.** Los cinco `.sql` se pegan en el SQL Editor de
Supabase y hacen exactamente lo mismo. El MCP es una comodidad: le permite a
Claude Code aplicar migraciones y leer el esquema sin que copies y pegues.

Si lo querés, hay que autenticarlo una sola vez, y **requiere el CLI de Claude
Code instalado en tu máquina** (la versión web no sirve para esto):

```bash
# 1. instalar el CLI (necesita Node.js)
npm install -g @anthropic-ai/claude-code

# 2. abrir Claude Code parado en la carpeta del proyecto
cd ~/GRIFO/GRIFO
claude
```

Y **una vez adentro de Claude Code** —o sea, ya no en la terminal— escribir:

```
/mcp
```

Ahí elegís `supabase` → *Authenticate*. Se abre el navegador, entrás a tu cuenta
y listo.

> `/mcp` es un comando de Claude Code, no de bash. Si lo tipeás en la terminal
> te va a decir `No existe el fichero o el directorio`.

Tiene que ser una terminal común, no una extensión de IDE.

> ⚠️ El flujo es OAuth con navegador, así que **no se puede completar desde una
> sesión remota de Claude Code en la nube**: ahí no hay navegador ni forma de
> recibir el callback. Desde el contenedor remoto las herramientas de Supabase
> no van a estar disponibles aunque el `.mcp.json` esté en el repo.

Sin el MCP igual está todo cubierto: los cinco `.sql` se pegan en el SQL Editor
de Supabase y hacen exactamente lo mismo.

---

## Modelo de datos

**`tarjetas`** — el saldo, en centavos enteros, por UID. Nunca en la tarjeta
física: la tarjeta solo aporta el UID.

**`grifos`** — precio por litro (cada cerveza vale distinto), calibración
`pulsos_por_litro` y `ml_minimos`.

**`sesiones`** — una fila por "tarjeta apoyada en el grifo". Guarda un
**snapshot** de saldo, precio y calibración al abrir, y el resultado al cerrar.

Tres estados:

| Estado | Significa |
|---|---|
| `abierta` | El cliente tiene la tarjeta apoyada. Puede servir. |
| `cerrada` | Liquidada. **Terminal**: reintentar el cierre no vuelve a cobrar. |
| `abandonada` | Quedó colgada. Libera la tarjeta, pero **todavía acepta el cierre tardío**. |

---

## Decisiones de diseño

### 1. Plata en enteros, y el redondeo hacia arriba sin floats

```sql
v_costo := (p_ml::bigint * v_ses.precio_litro_centavos + 999) / 1000;
```

`(a + 999) / 1000` con división entera **es** `ceil(a / 1000)`: si `a` es
múltiplo exacto de 1000 no cambia nada, y cualquier resto empuja al entero
siguiente. Ni un `float` en todo el camino de la plata.

Para el techo, al revés — trunca:

```sql
v_ml_max := (saldo_centavos * 1000) / precio_litro_centavos;
```

Truncar acá es lo correcto: nunca habilitamos un mL que el cliente no pagó.
**Cobrar redondea para arriba, habilitar trunca para abajo.** Las dos
asimetrías van a favor del bar, que es la regla del brief.

### 2. El precio queda congelado al abrir la sesión

`sesiones` copia `precio_litro_centavos` y `pulsos_por_litro` al abrir. Si el
dueño sube el precio mientras alguien está sirviendo, se le cobra el precio que
vio al empezar. Es lo mismo que congelar el precio en una orden de compra: la
factura no cambia porque cambió el catálogo.

### 3. `cerrar_sesion` es idempotente (el invariante que impide cobrar doble)

Si la sesión ya está `cerrada`, la función devuelve **exactamente la misma
respuesta** que la primera vez y no toca un centavo — aunque el reintento traiga
otros mL. El ESP32 puede reintentar todas las veces que quiera.

Lo que lo hace posible es que guardamos `saldo_final_centavos` en la sesión: la
respuesta repetida no se recalcula, se relee. Es un patrón de idempotency key,
donde la key es el `sesion_id`.

`intentos_cierre` cuenta los reintentos. Si en producción ves valores altos,
tenés un problema de red que investigar.

### 4. `abrir_sesion` también es idempotente

Si llega un `abrir_sesion` para una tarjeta que ya tiene sesión abierta **en el
mismo grifo**, devuelve la sesión existente con `"reanudada": true` en vez de
crear otra. Cubre el caso de que al ESP32 se le reinicie con la tarjeta apoyada.

En **otro** grifo devuelve `sesion_abierta_en_otro_grifo`. Eso es la
pre-autorización.

### 5. La pre-autorización la garantiza un índice, no el código

```sql
create unique index sesiones_una_abierta_por_tarjeta
  on public.sesiones (uid) where (estado = 'abierta');
```

Un `if` en el código se puede ganar con una condición de carrera: dos grifos que
consultan al mismo tiempo, los dos ven "no hay sesión abierta", los dos insertan.
Un índice único **parcial** no: es el motor rechazando el segundo INSERT.

Igual la función toma un `SELECT ... FOR UPDATE` sobre la tarjeta, que serializa
todo lo que le pase a esa tarjeta — un mutex por clave, no sobre la tabla
entera. El índice es el cinturón; el lock, los tirantes.

### 6. `abandonada` no cobra, y eso es a propósito

Si a un ESP32 le cortan la luz con la tarjeta apoyada, la sesión queda `abierta`
para siempre y esa tarjeta no se puede usar en ningún otro grifo. Por eso
`cerrar_sesiones_abandonadas(minutos)` las marca `abandonada` pasado un rato.

**Pero no cobra y no cierra.** Si cerráramos con 0 mL, romperíamos la cola
offline del NVS: el ESP32 vuelve media hora después, manda su
`cerrar_sesion` con los mL reales, se encuentra la sesión ya `cerrada` y la
idempotencia le devuelve el 0 — cerveza regalada.

Con `abandonada`, la tarjeta se libera enseguida **y** el cierre tardío se sigue
liquidando bien. Solo `cerrada` es terminal.

### 7. Los locks se toman siempre en el mismo orden

En las dos funciones: **primero `tarjetas`, después `sesiones`**. Por eso
`cerrar_sesion` lee la sesión sin lock solo para saber de qué tarjeta se trata,
bloquea la tarjeta, y recién ahí bloquea la sesión.

Tomar los locks siempre en el mismo orden es lo que evita los deadlocks: dos
transacciones esperándose cruzado. Misma regla que en cualquier código
concurrente.

### 8. `SECURITY DEFINER` + `search_path = ''`

Las RPC corren con los permisos del dueño de las tablas, así que saltean el RLS.
Es exactamente un endpoint de backend: el cliente no toca la base, le pide a una
función que haga una operación concreta y validada.

`search_path = ''` obliga a calificar todo con `public.`. Sin eso, alguien que
pueda crear objetos en otro esquema podría hacer que la función use *su* tabla
`tarjetas` en vez de la nuestra. Es prevención de inyección por resolución de
nombres — el equivalente a fijar las rutas absolutas en un script con `sudo`.

### 9. RLS activado y **cero** policies

Sin policy, RLS niega todo. Sumado a `revoke all on table ... from anon`, la
anon key no puede leer ni escribir una sola fila de ninguna tabla.

Y como en Postgres `PUBLIC` recibe `EXECUTE` sobre toda función nueva por
defecto, hay que revocarlo explícitamente antes de otorgar lo justo. Lo único
que la anon key puede hacer en toda la base es ejecutar `abrir_sesion` y
`cerrar_sesion`. Verificado en `05-permisos.sql`.

---

## Preguntas abiertas ⚠️

### A. La anon key es pública — y eso tiene un límite real

El brief lo dice: la anon key va grabada en el dispositivo, así que es pública.
El RLS ya impide leer las tablas, pero **cualquiera que extraiga la key del
ESP32 puede llamar las dos RPC**. En concreto, podría:

- Probar UIDs hasta encontrar tarjetas válidas.
- Abrir sesiones en nombre de otro (molesto: le bloquea la tarjeta al cliente).
- Llamar `cerrar_sesion` con mL inflados y **vaciarle el saldo a alguien**.

Lo último es plata real. La forma barata de taparlo es un **token por grifo**:
una columna `grifos.token`, un `p_token` en las dos RPC, y cada ESP32 con el
suyo en NVS. Quien tenga solo la anon key no puede hacer nada; quien abra un
grifo obtiene un token que se revoca desde la base sin tocar los otros.

**Esto cambia el contrato** (agrega un parámetro), así que no lo implementé.
Hay que decidirlo.

### B. La "reserva" de saldo es un lock, no un movimiento de plata

El brief dice que `abrir_sesion` "reserva el saldo". Está implementado como
**exclusividad**: una sola sesión abierta por tarjeta, garantizada por índice.
La plata no se mueve hasta `cerrar_sesion`.

Los números del contrato confirman esta lectura (850000 → 698640, sin pasar por
cero). La alternativa —descontar todo al abrir y devolver la diferencia al
cerrar— protege contra que alguien baje el saldo en caja a mitad de una tirada,
pero deja la plata del cliente en cero si el ESP32 muere y nunca liquida.

Me parece mejor la actual, pero confirmalo.

### C. Falta la recarga en caja

No hay función para cargar saldo todavía — el brief no la especificaba. Cuando
la hagamos: va con la **service_role key** desde el backend de caja,
**nunca** con la anon key.
