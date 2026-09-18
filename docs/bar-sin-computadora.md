# Ir al bar sin la computadora

La idea de este documento: que puedas llevar la canilla al bar, enchufarla,
y operar todo desde el celular. Sin notebook, sin cable USB, sin monitor serie.

## Por qué antes no se podía

El monitor serie era tu única ventana. Si la canilla no andaba, la única forma
de saber *por qué* era enchufar el USB y leer los `Serial.printf`. Es como
tener una API en producción sin logs: anda o no anda, y si no anda, adiviná.

Ahora la canilla te cuenta en qué anda **por el latido**. Cada 30 segundos le
manda a Supabase dos cosas más de las que mandaba antes:

- `estado_texto` — en qué estado de la máquina está: `ESPERANDO`, `HABILITADO`,
  `SIRVIENDO`, `LIQUIDANDO`.
- `ultimo_evento` — la última frase en castellano de lo que le pasó. Es
  literalmente la misma línea que antes salía por el serie.

Eso lo ves en la app, en **Canillas**, y con más detalle en **Controlar**.

## Antes de salir de casa (esto sí necesita la compu, una sola vez)

1. **Correr el SQL nuevo** en Supabase (SQL Editor, pegar y ejecutar):
   - `supabase/28-que-esta-haciendo.sql`
   Si te saltea esto, el latido va a seguir funcionando pero la app no va a
   mostrar el estado (la RPC va a rechazar los parámetros nuevos).

2. **Flashear la canilla** con el firmware que manda el estado:
   ```
   cd ~/GRIFO && git pull && pio run -e etapa7_tablet -t upload
   ```

3. **Dejar el WiFi del bar cargado**, o al menos saber que vas a usar el portal.
   Si la canilla no encuentra la red guardada, levanta sola el portal.

4. **Probar una vez en casa** que el estado aparece en la app. Enchufá la
   canilla, esperá 30 segundos, abrí la app en el celular y fijate que la
   canilla diga "Libre". Si eso se ve, ya tenés ojos en el bar.

## En el bar, con el celular

### 1. Enchufar

Enchufá la canilla. No necesita USB: con el cargador de 5 V alcanza.
Dale un minuto — arranca, se conecta al WiFi y manda el primer latido.

### 2. Conectarla al WiFi del bar (portal)

Si la red del bar no es la que tiene guardada:

1. La canilla levanta su propio WiFi. Buscá en el celular una red que se
   llame **GRIFO-setup**.
2. Conectate. Poné la contraseña que figura en `docs/portal-wifi.md`.
3. Se abre sola una pantalla (es el "captive portal", lo mismo que el WiFi de
   un hotel). Si no se abre, andá a `http://192.168.4.1`.
4. Elegí la red del bar de la lista, poné la contraseña, Guardar.
5. La canilla prueba la red nueva. **Si no logra conectarse en 20 segundos,
   vuelve sola a la red anterior.** No la podés dejar incomunicada por
   equivocarte una contraseña.

### 3. Verificar desde la app

Abrí `grifo-phi.vercel.app` en el celular → **Canillas**.

| Lo que ves | Qué significa |
|---|---|
| **En línea** + **Libre** | Todo bien, esperando clientes. |
| **En línea** + **Esperando que abran** | Alguien apoyó la tarjeta, la válvula está abierta, falta que abran el grifo. |
| **En línea** + **Sirviendo** | Está saliendo cerveza ahora. |
| **Sin señal** | Hace más de 2 minutos que no manda latido. Ver abajo. |
| **N cierres pendientes** | Se cortó internet y tiene ventas guardadas sin subir. Se suben solas cuando vuelve. |

Debajo de los chips vas a ver **"Lo último:"** con la frase de lo que le pasó.
Esa línea es tu monitor serie.

### 4. Servir

1. El cliente apoya la tarjeta en la tablet.
2. La tablet muestra saldo y bienvenida.
3. Si tiene saldo, **se abre la solenoide**.
4. El cliente abre el grifo manual y se sirve.
5. Cuando deja de correr cerveza, la canilla espera unos segundos por si sigue
   (la espera se agranda sola si el cliente ya hizo pausas) y después cierra y
   cobra.

## Si algo falla, desde el celular

### La canilla dice "Sin señal"

Casi siempre es WiFi. En orden:

1. ¿Está enchufada? (obvio, pero es lo primero).
2. Apagala y prendela. Esperá un minuto entero — el arranque más el primer
   latido tardan.
3. Si sigue sin aparecer: buscá la red **GRIFO-setup** en el celular. Si
   aparece, la canilla está viva pero no encuentra el WiFi del bar → rehacé el
   paso 2 (portal).
4. Si no aparece ni **GRIFO-setup**, no está arrancando: problema de
   alimentación, no de red.

### La tablet dice "no pudimos abrir la sesión"

Mirá el mensaje completo:

- **"permission denied"** → falta un `grant` en Supabase. Se arregla desde el
  SQL Editor, necesitás la compu.
- **"canilla ocupada"** → ya hay una sesión abierta en esa canilla. Desde la
  app, **Controlar → Reiniciar** la cierra.
- **"sin saldo"** → es lo que dice. Cargale saldo desde la app.
- **"No se encontró la función"** → falta correr un SQL. Necesitás la compu.

### El cliente se fue y la válvula quedó abierta

No puede quedar abierta para siempre: hay un tope duro de 3 minutos
(`MAX_APERTURA_MS`) y un tope de espera del primer pulso de 30 segundos. Si
igual querés forzarlo: **Controlar → Reiniciar**. La canilla se reinicia, cobra
lo servido y cierra.

### Quiero apagar una canilla sin desenchufarla

**Canillas → el switch Activa.** Con eso el servidor rechaza cualquier tarjeta
en esa canilla. No depende de que la canilla esté en línea.

## Lo que todavía necesita la compu

Siendo honesto, esto no lo resolvés desde el celular:

- **Flashear firmware nuevo.** Necesita cable USB y PlatformIO.
- **Correr SQL nuevo** en Supabase (se puede desde el navegador del celular,
  pero pegar un archivo largo en un teléfono es una tortura).
- **Calibrar el caudalímetro.** Necesitás medir con jarra y cambiar
  `pulsos_por_litro`. Eso sí se puede desde la app (Canillas → editar), pero la
  medición la hacés a mano.

Todo lo demás — WiFi, alta de canillas, precios, saldo, ver qué está pasando,
reiniciar, apagar — sale del celular.
