# Flashear y probar el hardware

La prueba de punta a punta con el sistema nuevo: el cliente muestra un **QR**, la
tablet lo lee, el ESP32 abre la válvula, mide y cobra. Lleva unos 30 minutos.

Hacé los pasos en orden. Si algo no da lo que dice, **pará ahí** y mandame la
foto o el texto del monitor: cada paso prueba una sola cosa.

---

## 0. Antes de tocar el hardware (una sola vez)

### La base

En **Supabase → SQL Editor**, pegar y correr, en este orden:

1. `supabase/29-qr.sql`
2. `supabase/31-mercadopago.sql`

Los dos terminan con `✅ … aplicado`. Se pueden correr de nuevo sin problema.

> **Ya están adaptados a SEN POS.** Los probé sobre una copia de tu base de
> producción (canillas + las 23 migraciones del POS): las pruebas de las
> canillas y **todas las del POS** (fases 1 a 10, permisos, fuzzing y simulación)
> pasan. Si querés, corré también `33-pruebas-con-pos.sql`: no deja rastro y
> termina con `✅ TODAS LAS PRUEBAS DE CONVIVENCIA CON EL POS PASARON`.

### La caja necesita un turno abierto en el POS

Desde que está SEN POS, **lo que se cobra en la caja de canillas entra en el
turno de caja del POS** (si no, el arqueo ciego del POS daría sobrante). Sin un
turno abierto, la caja de canillas dice *"No hay una caja abierta en SEN POS"*.

Antes de la prueba: entrá al POS como cajero y **abrí el turno**.

---

## 1. Bajar el código

```bash
cd ~/GRIFO
git pull
```

Revisá que siga estando tu `secrets.h` (no viaja con el `git pull`, está en
`.gitignore`):

```bash
ls src/nube/secrets.h
```

---

## 2. Elegir el firmware: ¿protoboard o placa?

| Qué tenés armado | Entorno | Por qué |
|---|---|---|
| **Protoboard** con el módulo relé y el conversor de niveles | `etapa7_tablet` | El relé es activo en BAJO, con el pin en open-drain |
| **Placa GRIFO rev A** (la que mandaste a hacer, con el MOSFET) | `etapa7_placa` | El MOSFET es activo en ALTO: la lógica es la inversa |

**No los cruces.** El de la protoboard en la placa deja la válvula **abierta**
en reposo, y al revés.

---

## 3. Flashear

Con los **12 V desenchufados** (solo el USB) y el monitor cerrado:

```bash
# Protoboard:
pio run -e etapa7_tablet -t upload

# Placa rev A:
pio run -e etapa7_placa -t upload
```

Si no conecta, mantené apretado el botón **BOOT** del ESP32 cuando aparece
`Connecting...` (ver [troubleshooting-flasheo.md](troubleshooting-flasheo.md)).

> Si la compilación tira un error, mandámelo entero. El firmware no lo pude
> compilar en mi entorno (la red bloquea las descargas de PlatformIO); lo revisé
> a mano.

---

## 4. Arranque: la válvula tiene que quedar CERRADA

```bash
pio device monitor -b 115200
```

Recién ahora enchufá los **12 V**. Lo que tiene que pasar:

- [ ] **No se escucha el clic del relé** (en la placa: el LED de la válvula
  apagado). Si hace clic y queda pegado, desenchufá los 12 V: está abierta en
  reposo. Revisá que el entorno sea el del paso 2.
- [ ] El monitor muestra que se conecta al WiFi.
- [ ] En el panel, **Canillas**: la canilla figura **en línea**, con firmware
  `etapa7` (o `etapa7-placa`).

---

## 5. La tablet

1. En el panel, **Canillas → Token** de esa canilla: escaneá el QR con la tablet.
2. La primera vez el navegador pide **permiso para la cámara**: Permitir.
3. Abajo tiene que decir **Cámara lista** y en el centro **Mostrá tu QR**, con
   el recuadro de la cámara.

- [ ] Si dice **Fuera de servicio · sin conexión**: el ESP32 no está latiendo.
  Volvé al paso 4.
- [ ] Si dice **Sin cámara**: tocá el candado de la barra de direcciones y
  habilitá la cámara.

---

## 6. La prueba de punta a punta

### a. Cargar y conseguir un QR

En la caja de canillas (la app de gestión, **Caja**):

1. Escribí un DNI de prueba (el tuyo), tu nombre, **$ 5.000**, **Efectivo**.
2. **Cobrar e imprimir el ticket**. Si no hay impresora, cancelá la impresión:
   el ticket queda en pantalla con el QR.

### b. Servir

1. Mostrá el QR del ticket a la cámara de la tablet.
   - [ ] La tablet dice **Hola, <tu nombre>** y tu saldo.
   - [ ] En **1 segundo o menos**, el relé hace clic (válvula abierta).
2. Pasá agua por el caudalímetro.
   - [ ] La tablet muestra los mililitros subiendo.
3. Cortá el agua.
   - [ ] A los pocos segundos de quieto, la válvula cierra (clic).
   - [ ] La tablet muestra el ticket: cuánto serviste y cuánto se cobró.
   - [ ] En **Caja**, buscando tu DNI: el consumo figura en los movimientos.

### c. Lo que NO tiene que pasar

- [ ] **El mismo QR otra vez, sin sacarlo de la cámara:** no abre de nuevo.
- [ ] **Un QR cualquiera** (el de una página web): dice *"Ese QR no es del bar"*.
- [ ] **Nadie abre el grifo:** a los **30 s** la válvula cierra sola sin cobrar.
- [ ] **Sin saldo:** cargá $ 1.000, serví hasta que corte. Tiene que cortar
  solo al llegar al tope, no seguir.

### d. Con la app (opcional)

- **App de canillas** (`…/#/cliente`, entra con nombre y DNI): tocá la tarjeta,
  mostrá el QR a la tablet.
- **App del POS** (`/billetera`): necesita el cambio de
  [`sen-pos-qr-canilla.patch`](sen-pos-qr-canilla.patch). Hoy esa billetera
  muestra su código fijo, que es para la caja: la tablet no lo acepta a
  propósito, porque una foto de ese código serviría desde cualquier celular.

---

## 7. Al terminar

- Cerrá el turno en el POS: el arqueo tiene que cuadrar con lo que cobraste.
- **Devolvé el saldo de prueba** desde **Caja → Devolver saldo**: sale como
  egreso del turno del POS.

## Si algo falla, mandame

1. Qué paso y qué casilla.
2. El texto del monitor serie desde que conectaste los 12 V.
3. Una foto de la tablet.
