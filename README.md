# GRIFO — Grifo de cerveza automatizado

Grifo de autoservicio para un bar. El cliente carga saldo en una tarjeta en caja,
la apoya en el lector del grifo y se sirve la cerveza que le alcance. El saldo se
descuenta en tiempo real según los mililitros efectivamente servidos.

**Hardware:** ESP32 NodeMCU ESP-WROOM-32S · lector RFID MFRC522 · caudalímetro
YF-S201C · válvula solenoide 12V vía módulo relé
**Backend:** Supabase (dos RPC atómicas) + cola offline en NVS

---

## Estado actual

| | |
|---|---|
| **Última etapa aceptada** | ✅ 1 — Blink (LED parpadeando + Serial a 115200, verificado en placa) |
| **Próxima etapa** | 2 — Lector RFID |
| **En paralelo** | ✅ backend de Supabase listo y probado (no depende del hardware) |
| **Bloqueado por hardware** | etapas 2 y 3 esperan los cables dupont · etapa 4 espera el módulo relé |

### Datos de la placa real

Confirmados al flashear la etapa 1:

| | |
|---|---|
| Chip | ESP32-D0WD-V3, revisión v3.1 |
| Cristal | 40 MHz |
| Flash | 4 MB |
| MAC | `20:50:0D:D1:CC:3C` |
| Puerto (Debian) | `/dev/ttyUSB0` (conversor CP2102) |

⚠️ **Esta placa necesita `upload_speed = 115200`.** Con el default de esptool
(460800) el flasheo muere después del `Changing baud rate`. Ya está fijado en
`platformio.ini` — no lo subas.

Ver el plan completo en [`docs/plan-de-etapas.md`](docs/plan-de-etapas.md).

---

## Cómo compilar y flashear

**En Linux, de cero y paso a paso:** [`docs/setup-linux.md`](docs/setup-linux.md)
— instalación de PlatformIO, permisos del puerto serie, flasheo y monitor, con
lo que tenés que ver después de cada comando.

Resumen, parado en la carpeta del proyecto (la que tiene el `platformio.ini`):

```bash
pio run -t upload               # compila y flashea
pio device monitor -b 115200    # abre la consola de la placa (Ctrl+C para salir)
```

Para flashear una etapa puntual (cuando haya más de una):

```bash
pio run -e etapa1_blink -t upload
```

> La primera compilación tarda varios minutos: PlatformIO baja el toolchain del
> ESP32 (unos cientos de MB). Es una sola vez, después compila en segundos.

**¿No flashea?** → [`docs/troubleshooting-flasheo.md`](docs/troubleshooting-flasheo.md)
(cable USB de solo carga, permisos, botón BOOT, puerto ocupado, baudrate).

---

## Estructura del repo

```
platformio.ini              un [env:...] por etapa
.mcp.json                   servidor MCP de Supabase (hay que autenticarlo local, ver docs)
src/
  etapa1_blink/main.cpp     etapa 1 — blink + info del chip
supabase/
  01-schema.sql             tablas, índices y RLS
  02-funciones.sql          las dos RPC + mantenimiento + permisos
  03-seed.sql               datos de prueba
  04-pruebas.sql            suite de pruebas (corre en transacción, hace ROLLBACK)
  05-permisos.sql           verifica que la anon key no pueda tocar nada más
docs/
  plan-de-etapas.md         las 8 etapas, qué necesita cada una, criterio de aceptación
  backend-supabase.md       cómo aplicar y probar el backend + decisiones de diseño
  pinout-y-trampas.md       pinout definitivo + trampas de hardware explicadas
  etapa-01-blink.md         cableado y qué esperar en esta etapa
  setup-linux.md            paso a paso completo en Linux, de cero a flashear
  troubleshooting-flasheo.md  cuando no flashea
```

### Por qué un sketch por etapa

Cada etapa vive en su propia carpeta bajo `src/` y tiene su propio entorno en
`platformio.ini`. `build_src_filter` hace que se compile **una sola** carpeta por
vez, así que los sketches no se pisan entre ellos.

Es la misma lógica que un test unitario por módulo en vez de un test de
integración gigante: si el firmware completo no anda, no sabés cuál de las cinco
piezas de hardware falla. Si el sketch que prueba *solo* el lector RFID no anda,
el problema está en el lector RFID.

Ventaja extra: los envs viejos no se tiran. Si en la etapa 6 el caudalímetro
empieza a contar raro, volvés a flashear `etapa3_caudalimetro`, lo mirás aislado,
y después volvés.

---

## Reglas duras del proyecto

Estas no se negocian — si alguna se rompe hay cerveza en el piso o plata mal
cobrada. Detalle completo en [`docs/pinout-y-trampas.md`](docs/pinout-y-trampas.md).

- **El relé es activo en LOW.** `LOW` abre la válvula, `HIGH` la cierra.
- **La tirada se corta localmente.** El ESP32 calcula el techo de pulsos al abrir
  la sesión y corta comparando enteros. Ninguna decisión durante la tirada
  depende de la red.
- **Si se cae el WiFi con la válvula abierta, la válvula igual cierra.** La
  transacción queda en cola en NVS.
- **Fuera del estado `SIRVIENDO`, la válvula está cerrada**, chequeado explícito
  al final de cada iteración del loop.
- **Plata siempre en centavos enteros.** Nunca `float`. Redondeo hacia arriba.
- **El saldo nunca se guarda en la tarjeta.** Vive en Supabase; la tarjeta solo
  aporta el UID.
- **Nada de HTTP ni `delay()` dentro de la tarea de control.**
