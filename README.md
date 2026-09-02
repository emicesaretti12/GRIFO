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
| **Etapa en curso** | 1 — Blink |
| **Esperando** | que el blink corra en la placa física |
| **Bloqueado por hardware** | etapas 2 y 3 esperan cables dupont · etapa 4 espera el módulo relé |

Ver el plan completo en [`docs/plan-de-etapas.md`](docs/plan-de-etapas.md).

---

## Cómo compilar y flashear

> La primera vez PlatformIO baja el toolchain del ESP32 (unos cientos de MB).
> Tarda un par de minutos. Es una sola vez.

### Opción A — VSCode (recomendada si es tu primera vez)

1. Instalá [VSCode](https://code.visualstudio.com/).
2. En VSCode: pestaña de extensiones (el ícono de los cuadraditos, o `Ctrl+Shift+X`)
   → buscá **PlatformIO IDE** → *Install*. Tarda, y al final pide recargar.
3. `File → Open Folder…` → elegí **esta carpeta** (la que tiene el `platformio.ini`).
   Importante: la carpeta del proyecto, no una de más arriba ni `src/`.
4. Enchufá la ESP32 por USB.
5. En la barra de estado (abajo de todo) aparecen unos íconos chiquitos:
   - **✓** → *Build* (solo compila)
   - **→** → *Upload* (compila y flashea)
   - **🔌** → *Serial Monitor*
6. Dale a **→** (Upload). Cuando termine con `SUCCESS`, dale al **🔌**.

### Opción B — línea de comandos

```bash
pip install platformio          # una sola vez

pio run                         # solo compila
pio run -t upload               # compila y flashea
pio device monitor -b 115200    # abre el monitor serial
```

Para flashear una etapa puntual (cuando haya más de una):

```bash
pio run -e etapa1_blink -t upload
```

**¿No flashea?** → [`docs/troubleshooting-flasheo.md`](docs/troubleshooting-flasheo.md)
(driver CP2102, botón BOOT, permisos en Linux, puerto ocupado).

---

## Estructura del repo

```
platformio.ini              un [env:...] por etapa
src/
  etapa1_blink/main.cpp     etapa 1 — blink + info del chip
docs/
  plan-de-etapas.md         las 8 etapas, qué necesita cada una, criterio de aceptación
  pinout-y-trampas.md       pinout definitivo + trampas de hardware explicadas
  etapa-01-blink.md         cableado y qué esperar en esta etapa
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
