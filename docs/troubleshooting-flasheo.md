# Troubleshooting de flasheo

Errores típicos al subir código al ESP32, en orden de frecuencia.

---

## "No se ve el puerto" / PlatformIO no encuentra la placa

Primero, ver qué puertos hay:

```bash
pio device list
```

**Windows.** Administrador de dispositivos → *Puertos (COM y LPT)*. Tiene que
aparecer `Silicon Labs CP210x USB to UART Bridge (COMx)`.
Si no aparece, o aparece con triángulo amarillo → falta el driver. Buscar
*"CP210x USB to UART Bridge VCP Drivers"* en la página de Silicon Labs,
instalarlo, desenchufar y volver a enchufar el cable.

**Mac.** `ls /dev/cu.*` → tiene que salir `/dev/cu.usbserial-XXXX` o
`/dev/cu.SLAB_USBtoUART`. Mismo driver de Silicon Labs si no aparece.

**Linux.** `ls /dev/ttyUSB*` → tiene que salir `/dev/ttyUSB0` o similar. El
driver ya viene en el kernel, así que si no aparece suele ser el cable.

### El cable

Causa número uno, y da bronca: **muchos cables USB son solo de carga**, tienen
los dos cables de alimentación y no los de datos. Con uno de esos el LED rojo
prende igual (por eso confunde) pero la PC nunca ve el puerto. Probá con otro
cable, preferentemente uno que venga de un celular con transferencia de datos.

### Linux: permisos

Si el puerto aparece pero da `Permission denied`:

```bash
sudo usermod -a -G dialout $USER
```

Después **cerrar sesión y volver a entrar** (no alcanza con abrir otra terminal).

---

## `Failed to connect to ESP32: Timed out waiting for packet header`

La placa no entró en modo flasheo. Algunas placas no tienen bien resuelto el
auto-reset por DTR/RTS y hay que ayudarlas a mano:

1. Lanzá el upload.
2. Cuando en la consola aparezca `Connecting........_____`, **mantené apretado el
   botón BOOT** de la placa (el que dice BOOT o IO0, cerca del USB).
3. Soltalo apenas empiece a escribir (ves el porcentaje subir).

Si aun así falla, probá el combo clásico: mantené BOOT apretado, tocá y soltá
**EN** (reset), soltá BOOT, y recién ahí lanzá el upload.

También podés bajar la velocidad de flasheo agregando en `platformio.ini`:

```ini
upload_speed = 115200
```

Es más lento pero mucho más tolerante con cables largos o conversores clon.

---

## `Could not open port ... Access is denied` / `Resource busy`

Hay otro programa usando el puerto. Casi siempre es **el monitor serial que
quedó abierto**. Cerralo antes de flashear — el puerto es de a uno.

Sospechosos: la pestaña del Serial Monitor de VSCode, un Arduino IDE abierto,
otra terminal con `pio device monitor`.

---

## Sale basura en el monitor: `␀␀ÿýÿ` o `⸮⸮⸮`

Velocidad equivocada. Tiene que ser **115200**:

```bash
pio device monitor -b 115200
```

Si igual sale basura *solo en las primeras líneas* y después se acomoda, es
normal: es el bootloader del ESP32 que escupe su mensaje a 74880 baud antes de
que arranque nuestro código. Ignoralo.

---

## Compila pero el LED no parpadea

- Fijate que estés mirando el LED correcto: el **azul chiquito**, no el rojo de
  power. El rojo está fijo siempre y no lo controla el firmware.
- Algunas placas clon traen el LED de usuario en otro pin, o directamente no lo
  traen. Si por Serial ves los `LED ON` / `LED OFF` saliendo, **el firmware anda
  perfecto** y es solo un tema de qué pin tiene el LED en tu placa: avisame y lo
  cambiamos, o lo damos por bueno con el Serial.

---

## La primera compilación tarda muchísimo

Normal. PlatformIO baja el toolchain del ESP32 (compilador, framework Arduino,
herramientas) la primera vez: son unos cientos de MB. Después queda cacheado en
`~/.platformio` y las siguientes compilaciones tardan segundos.

---

## La placa se resetea sola o parpadea raro

Si pasa **con solo el USB conectado**, suele ser alimentación insuficiente: un
puerto USB flojo, un hub sin fuente, o el cable otra vez. Probá un puerto USB
directo de la PC, no un hub.
