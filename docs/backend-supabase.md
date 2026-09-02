# Backend en Supabase

Todo el lado servidor del grifo: dos RPC atómicas, el esquema y el modelo de
permisos. **No necesita hardware** — se prueba entero desde el editor SQL de
Supabase y con `curl`.

## Archivos

| Archivo | Qué hace |
|---|---|
| [`supabase/01-schema.sql`](../supabase/01-schema.sql) | Tablas (incluye `movimientos`), índices y RLS |
| [`supabase/02-funciones.sql`](../supabase/02-funciones.sql) | Las dos RPC del dispositivo + caja + tokens + mantenimiento + permisos |
| [`supabase/03-seed.sql`](../supabase/03-seed.sql) | Datos de prueba (incluye el ejemplo del contrato) |
| [`supabase/04-pruebas.sql`](../supabase/04-pruebas.sql) | Suite de pruebas. Corre en transacción y hace ROLLBACK |
| [`supabase/05-permisos.sql`](../supabase/05-permisos.sql) | Verifica que la anon key no pueda tocar nada más |
| [`supabase/06-auditoria.sql`](../supabase/06-auditoria.sql) | Arqueo: descuadres, cobros recortados, sesiones colgadas, grifos sin token |

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

> ✅ **Verificado punta a punta sobre HTTP** contra el proyecto real
> (`bkrwabezndztkldwygjd`), con la anon key y el mismo transporte que va a usar
> el ESP32:
>
> | Prueba | Resultado |
> |---|---|
> | `GET /rest/v1/tarjetas` | `permission denied for table tarjetas` |
> | `abrir_sesion` con token falso | `{"ok":false,"motivo":"token_invalido"}` |
> | `abrir_sesion` con token válido | `sesion_id 13, saldo 850000, ml_maximos 2656` |
> | `cerrar_sesion` 473 mL | `saldo 698640, costo 151360` — el número exacto del contrato |
> | `cerrar_sesion` repetido | `"repetida": true`, saldo **sigue** en 698640 |
>
> Los cinco scripts se corrieron además dos veces seguidas contra un
> PostgreSQL 16 local, así que son idempotentes.

## Probar con curl

```bash
SUPA=https://bkrwabezndztkldwygjd.supabase.co
KEY=tu-anon-key     # nunca la commitees; exportala en tu shell

TOKEN=el-token-que-devolvio-rotar_token_grifo

curl -s -X POST "$SUPA/rest/v1/rpc/abrir_sesion" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"p_uid\":\"A1B2C3D4\",\"p_grifo\":1,\"p_token\":\"$TOKEN\"}"
# {"ok":true,"sesion_id":1,"saldo_centavos":850000,
#  "precio_litro_centavos":320000,"pulsos_por_litro":452.700,"ml_maximos":2656}

curl -s -X POST "$SUPA/rest/v1/rpc/cerrar_sesion" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"p_sesion_id\":1,\"p_ml\":473,\"p_pulsos\":214,\"p_token\":\"$TOKEN\"}"
# {"ok":true,"saldo_centavos":698640,"ml_servidos":473,"costo_centavos":151360}

# Sin el token, o con uno inventado, no se hace nada:
curl -s -X POST "$SUPA/rest/v1/rpc/abrir_sesion" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_uid":"A1B2C3D4","p_grifo":1,"p_token":"cualquier-cosa"}'
# {"ok":false,"motivo":"token_invalido"}
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
`pulsos_por_litro`, `ml_minimos` y el `token_hash` del dispositivo.

**`movimientos`** — el libro mayor: una fila por cada carga y por cada consumo.

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

## El token de dispositivo

La anon key va grabada en el ESP32, así que es **pública** por diseño. El RLS
impide leer las tablas, pero sin nada más, cualquiera que extraiga esa key
podría llamar `cerrar_sesion` con mL inflados y **vaciarle el saldo a un
cliente**. Por eso las dos RPC piden además un **token por grifo**.

**Cómo funciona.** Cada grifo tiene un token propio. La base guarda solo su
**SHA-256** — si alguien se lleva un dump, no se lleva los tokens, igual que no
se guardan contraseñas en claro. El ESP32 guarda el suyo en NVS y lo manda en
cada llamada.

**Falla cerrado.** Un grifo con `token_hash` NULL no opera. Nunca hay un camino
en el que "sin token" signifique "pasá igual".

**Está acotado por grifo.** El token del grifo 1 no abre sesiones en el 2, ni
puede liquidar una sesión que se abrió en el 2. Si comprometen un grifo, rotás
ese token y los demás siguen andando.

### Poner en marcha un grifo

```sql
select public.rotar_token_grifo(1);
```

```json
{"ok": true, "grifo_id": 1,
 "token": "8a2ec52792034f2ebeb321d89cf1d9a1a7dd0254401140a3933ad8d005559b3e",
 "aviso": "Guardalo ahora. Se guarda hasheado y no se puede volver a ver."}
```

Ese token va grabado en el ESP32 de **ese** grifo. Es el mismo trato que un
personal access token de GitHub: se ve una vez; si lo perdés, rotás otro.

> ⚠️ Rotar un token **invalida el anterior al instante**. Si el ESP32 de ese
> grifo todavía tiene el viejo, ese grifo deja de funcionar hasta que le cargues
> el nuevo. Por eso las llamadas a `rotar_token_grifo` están comentadas en
> `03-seed.sql`: para que volver a correr el seed no baje un grifo en producción.

---

## Recarga en caja

```sql
select public.cargar_saldo(
  p_uid                => 'A1B2C3D4',
  p_centavos           => 500000,          -- $5000
  p_referencia         => 'ticket-4471',
  p_clave_idempotencia => 'caja1-ticket-4471'
);
```

- **Solo `service_role`**, la key del backend de caja. Nunca la anon key, nunca
  un dispositivo. Verificado en `05-permisos.sql`.
- **Da de alta la tarjeta** si el UID no existía: la primera carga crea al
  cliente. La respuesta trae `tarjeta_creada`.
- **Es idempotente** si le pasás `p_clave_idempotencia` (el número de ticket de
  caja, por ejemplo). Si la caja tuvo timeout y reintenta, la segunda llamada
  devuelve el resultado de la primera en vez de cargar dos veces. La garantía es
  un índice único sobre esa columna, no un `if`.

### El libro mayor

Toda la plata que entra y sale queda asentada en `movimientos`: una fila `carga`
por cada recarga y una `consumo` por cada sesión liquidada, con el saldo
resultante. `tarjetas.saldo_centavos` es el acumulado; `movimientos` es el
detalle que lo explica.

El asiento de consumo lleva `clave_idempotencia = 'sesion:<id>'`, así que el
índice único garantiza **un solo cobro por sesión** aunque el código llegara ahí
dos veces. La idempotencia está defendida en dos capas: el estado de la sesión y
el índice del libro mayor.

**Toda la plata entra por la puerta de entrada**, incluida la de prueba: el seed
crea las tarjetas con `cargar_saldo` en vez de escribir la tabla, para que
`sum(movimientos) = saldo_centavos` valga desde el primer centavo. Si en algún
momento cargás saldo editando la tabla a mano, esa tarjeta queda descuadrada y
`06-auditoria.sql` te la muestra.

---

## Decisiones ya tomadas

**La reserva de saldo es un lock, no un movimiento de plata.** `abrir_sesion`
no toca el saldo: garantiza exclusividad (una sola sesión abierta por tarjeta,
por índice único) y la plata se mueve recién al cerrar. Coincide con los números
del contrato (850000 → 698640, sin pasar por cero) y si el ESP32 muere, el saldo
del cliente sigue visible e intacto.

## Pendiente

Nada del lado servidor. Lo que falta de la etapa 6 es firmware: `tareaRed`, el
cliente HTTP y la cola offline en NVS.
