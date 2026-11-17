# Traspaso: fusionar GRIFO (canillas) con SEN POS

Para quien siga con esto. Los dos sistemas usan **la misma base de Supabase**
(proyecto `bkrwabezndztkldwygjd`) y la misma billetera (`public.tarjetas` +
`public.movimientos`). Este documento dice qué hay en cada lado, qué ya está
integrado y probado, y qué falta.

| Repo | Qué es | Rama |
|---|---|---|
| `emicesaretti12/GRIFO` | Canillas: firmware ESP32, base 01-33, app Vite (pantalla del grifo, caja, app del cliente) | `claude/grifo-cerveza-esp32-qndb2h` |
| `emicesaretti12/sen-pos` | POS estilo Fudo (Next.js), 23 migraciones | `main` (commit `053ad9b`) |

---

## 1. Qué hay hoy en producción

- **Canillas 01 a 28**: aplicadas.
- **SEN POS**: las 23 migraciones, aplicadas el 16/11/2026 (ver
  `sen-pos/docs/BASE-DE-DATOS.md` §5). Su `20260101000000_baseline_grifos.sql`
  NO se corrió: reproduce, parcialmente, lo que ya había.
- **`supabase/INSTALAR-QR.sql`** (= `29-qr.sql` + `31-mercadopago.sql`):
  **todavía NO aplicado**. El usuario lo va a pegar en el SQL Editor. Comprobalo
  con `select to_regclass('public.pases');` (si devuelve `pases`, está).

El frontend de GRIFO (Vercel, `grifo-phi.vercel.app`) ya está publicado con lo
último y espera que `INSTALAR-QR.sql` esté aplicado.

## 2. El cambio de NFC a QR (lado GRIFO)

El cliente ya no apoya una tarjeta: muestra un **QR temporal** y la cámara de la
tablet del grifo lo lee. Resumen en `docs/qr.md`. Piezas en la base (`29-qr.sql`):

- `pases`: QR de 90 s (app) o hasta las 6:00 (ticket impreso). Formato
  `GRIFO:` + 32 hex. Se guarda el hash; el de ticket también en claro para
  reimprimir.
- `tablet_abrir_sesion_qr(codigo, grifo, token)`: lo que llama la tablet. Exige
  que el ESP32 haya latido en los últimos 120 s.
- `clientes_qr`: cuentas por DNI de la app de canillas (`tipo = 'app'`, atada al
  celular) y del ticket de la caja (`tipo = 'ticket'`). Son dos saldos separados
  a propósito (ver `docs/qr.md`, "Por qué un DNI puede tener dos saldos").
- Caja por DNI: `caja_vender`, `caja_cargar`, `caja_buscar_cliente`,
  `caja_buscar_por_codigo`, `caja_ficha`, `caja_emitir_pase`,
  `caja_habilitar_celular`, `caja_devolver_tarjeta`.
- `inicio_jornada()`: 6:00 a 6:00 hora argentina (igual que `dia_comercial` del POS).
- `31-mercadopago.sql`: `recargas_mp` + `pago_*`, para la app de canillas, con la
  Edge Function `supabase/functions/mercadopago`.

## 3. Lo que ya está integrado con SEN POS (probado)

1. **Sin choques de nombres.** El POS ya tenía `clientes` y `pagos`; las de
   canillas se llaman `clientes_qr` y `recargas_mp`.
2. **La caja de canillas cobra dentro del turno del POS.** `_cargar` (29) usa
   `pos_cargar_billetera` si existe: la carga queda en `caja_movimientos` del
   turno abierto, con su medio (`mercadopago` → `qr_mp`). Sin turno abierto
   devuelve `sin_turno_abierto`. `caja_devolver_tarjeta` asienta un `egreso` en
   el turno. **El arqueo ciego del POS cierra en cero** (prueba 33).
3. **La billetera de la app del POS sirve en las canillas.**
   `app_generar_pase()` (29) da un QR temporal al usuario logueado del POS, para
   su `app_clientes.tarjeta_uid`. `caja_buscar_por_codigo` también encuentra
   esas billeteras (no tienen DNI: la ficha viene con `dni = null`).
4. **Funciones viejas de canillas blindadas** para el fuzzing del POS: datos
   inválidos devuelven `{ok:false}` en vez de un error interno
   (`admin_crear_grifo`, `admin_actualizar_grifo`, `admin_actualizar_cerveza`,
   `admin_ajustar_saldo`, `admin_ordenar`, `caja_bloquear_tarjeta`), y
   `admin_listar_personal`/`estado_barriles` devuelven `null` a quien no es admin.
5. **`_medio_carga`**: el cierre de caja de canillas reconoce también las cargas
   que hizo el POS (por la referencia `caja:<medio>` o la clave `mp:`).

### Cómo se probó (y cómo repetirlo)

Sobre una copia local de producción: canillas 01-28 + las 23 migraciones del POS,
en Postgres 17, y encima `INSTALAR-QR.sql`.

```bash
# Postgres 17 en /tmp:5433 con roles anon, authenticated y service_role.
GRIFO=$PWD SENPOS=../sen-pos supabase/_pruebas-locales/armar-replica-produccion.sh \
  supabase/INSTALAR-QR.sql supabase/30-pruebas-qr.sql \
  supabase/32-pruebas-mercadopago.sql supabase/33-pruebas-con-pos.sql
SENPOS=../sen-pos supabase/_pruebas-locales/pruebas-del-pos.sh
```

Resultado: pasan las pruebas de canillas (01-33), `INSTALAR-QR.sql` corrido dos
veces seguidas, y **todas las del POS** (fases 1-10, permisos con fuzzing,
simulación). `supabase/_pruebas-locales/01-imitar-supabase.sql` imita lo que
Supabase trae de fábrica (extensions, cron, net, vault, realtime, permisos por
defecto).

Sin el POS, `supabase/_pruebas-locales/` + los archivos 01-33 también pasan en
Postgres 16 (los bloques del POS se saltean solos).

## 4. Lo que falta para terminar la fusión

### En SEN POS (no tenía permiso de escritura)

1. **Aplicar `docs/sen-pos-qr-canilla.patch`** (`git am`). Agrega a
   `/billetera` un botón "Servirme en una canilla" con el QR de
   `app_generar_pase`. El QR fijo con el `uid` que ya había queda para la caja:
   la tablet no lo acepta a propósito (una foto serviría desde otro celular).
   Pasa `tsc` y `scripts/verificar-contrato.py` contra una base con 29.
2. **Actualizar `20260101000000_baseline_grifos.sql`** para que incluya lo de
   GRIFO 29/31 que el POS usa (`pases`, `app_generar_pase`, y lo que haga falta),
   o su `check:contrato` y sus pruebas locales no lo van a encontrar.
3. **`supabase/tests/pos_permisos.sql`**: su lista `v_base` no incluye las
   funciones que la tablet y el ESP32 llaman sin sesión (ya pasaba antes del QR)
   ni las de la caja de canillas. Ver los ajustes en
   `supabase/_pruebas-locales/pruebas-del-pos.sh`.
4. **`pos_fase3.sql`** cuenta exactamente 5 personas en `personal`; en
   producción hay un admin más (el de las canillas).

### Decisiones del usuario, pendientes

- **Una sola app para los clientes.** Hoy hay dos sobre el mismo saldo: la de
  canillas (`grifo-phi.vercel.app/#/cliente`, nombre + DNI, sin contraseña) y la
  del POS (`/billetera`, email + clave, además pide comida). Si queda la del POS,
  `31-mercadopago.sql`, la Edge Function `mercadopago` y `app/src/cliente/`
  sobran (ojo: hay que mantener `cliente_*` mientras haya cuentas de app con
  saldo, o devolvérselo).
- **Una sola caja.** La de canillas (gestión → Caja: DNI, ticket impreso con QR)
  y la del POS conviven bien (la de canillas ya cobra dentro del turno del POS).
  Lo natural es llevar "vender ticket con QR por DNI" a la caja del POS
  (`caja_vender` + `Ticket.tsx` de GRIFO como referencia) y retirar la otra.
- **Mercado Pago**: cada sistema tiene la suya, conviven (cada una ignora los
  pagos con referencias de la otra). Si queda una sola app, queda una sola.

### Otros pendientes conocidos

- `pos_verificar_integridad()` en producción marca 4 tarjetas de prueba con saldo
  sin movimiento (····3344, ····BEEF, ····34D4, ····C3D4). Borrarlas o asentarles
  un ajuste inicial.
- `admin_borrar_grifo`, `admin_crear_grifo`, `admin_ordenar`,
  `admin_cancelar_orden`, `admin_listar_grifos`, `admin_listar_ordenes` niegan
  con `raise ... errcode 42501` (diseño original de canillas, con pruebas
  propias). El estilo del POS es `{ok:false}`.
- El firmware (`etapa7_tablet`, `etapa7_placa`) no se pudo compilar en la nube
  (la red bloquea PlatformIO). Revisado a mano; lo compila el usuario al flashear.
- Hardware: `docs/flashear-y-probar.md`. Falta el diodo 1N4007 en la válvula.

## 5. Reglas de la casa (que siguen los dos repos)

- Plata en centavos enteros. Nada se escribe directo: funciones `SECURITY
  DEFINER` con `set search_path = ''` que responden `{ok, motivo}`.
- Idempotencia en todo lo que mueve plata (`movimientos.clave_idempotencia`).
- Las migraciones de GRIFO son idempotentes (se pueden correr dos veces) y
  tienen "guarda de orden".
- Nunca subir `src/nube/secrets.h` ni claves (`sb_secret_`, token de Mercado
  Pago, tokens de canilla).
- Explicaciones al usuario: castellano rioplatense, informal, con analogías de
  software; no tiene experiencia en hardware.
