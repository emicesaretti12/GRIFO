# Setup en Linux — de cero a flashear

Guía paso a paso para Linux. Después de cada comando dice **qué tenés que ver**:
si no ves eso, no sigas al siguiente, resolvé ese paso primero.

---

## 0. Enchufar la placa y confirmar que Linux la ve

```bash
ls /dev/ttyUSB*
```

**Tenés que ver:** `/dev/ttyUSB0` (el número puede variar).

**Si dice `No such file or directory`:** Linux no está viendo la placa. Ver
[Problemas comunes](#problemas-comunes) más abajo, sección "no aparece
/dev/ttyUSB0".

---

## 1. Dar permiso al puerto

En Linux los puertos serie pertenecen al grupo `dialout` y tu usuario no está
ahí por defecto. Sin esto, al flashear te va a decir `Permission denied`.

**Arreglo definitivo:**

```bash
sudo usermod -a -G dialout $USER
```

Y después **cerrar sesión y volver a entrar** (o reiniciar). No alcanza con
abrir otra terminal: los grupos se leen al iniciar sesión.

**Atajo si no querés cerrar sesión ahora:**

```bash
sudo chmod 666 /dev/ttyUSB0
```

Funciona al toque, pero se pierde cada vez que desenchufás la placa. Sirve para
probar hoy; hacé igual el `usermod` para no repetirlo siempre.

---

## 2. Instalar PlatformIO

```bash
pip3 install --user platformio
```

**Tenés que ver:** `Successfully installed platformio-...`

### Si te tira `error: externally-managed-environment`

Es normal en Ubuntu 23.04+, Debian 12+ y Fedora recientes: no dejan instalar
paquetes de Python "sueltos" en el sistema. Usá `pipx`, que instala la
herramienta en su propio entorno aislado:

```bash
sudo apt install pipx     # en Fedora: sudo dnf install pipx
pipx install platformio
pipx ensurepath
```

Después **cerrá y abrí la terminal**.

### Verificar

```bash
pio --version
```

**Tenés que ver:** `PlatformIO Core, version 6.x.x`

**Si dice `pio: command not found`:** el binario está instalado pero no en el
PATH. Arreglalo con:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
pio --version
```

---

## 3. Traer el proyecto

```bash
git clone https://github.com/emicesaretti12/GRIFO.git
cd GRIFO
git checkout claude/grifo-cerveza-esp32-qndb2h
ls
```

**Tenés que ver:** `README.md  docs  platformio.ini  src`

Es importante quedar parado **dentro de la carpeta GRIFO** — o sea, en la
carpeta donde está el `platformio.ini`. Todos los comandos de abajo se corren
desde ahí.

---

## 4. Compilar y flashear

```bash
pio run -t upload
```

**La primera vez tarda varios minutos** y parece colgado: está bajando el
compilador y el framework del ESP32 (unos cientos de MB). Es una sola vez.

**Tenés que ver, al final:**

```
Writing at 0x00010000... (100 %)
Wrote 267584 bytes ...
Hash of data verified.
Leaving...
Hard resetting via RTS pin...
========================= [SUCCESS] Took 45.23 seconds =========================
```

Lo importante es el **`[SUCCESS]`** verde del final.

---

## 5. Ver la consola de la placa

```bash
pio device monitor -b 115200
```

**Tenés que ver:**

```
=============================================
 GRIFO DE CERVEZA — ETAPA 1: BLINK
=============================================
Revision del chip : 1
CPU               : 240 MHz
Flash             : 4194304 bytes
Heap libre        : 298765 bytes
MAC (eFuse)       : 3C61052E1F4C
---------------------------------------------
Si ves esto y el LED chiquito parpadea, la etapa 1 esta OK.

[500 ms] LED ON
[1000 ms] LED OFF
```

Y el LED azul chiquito de la placa parpadeando 1 vez por segundo.

**Para salir del monitor:** `Ctrl+C`.

> Ojo: mientras el monitor está abierto, el puerto está ocupado. Si querés
> volver a flashear, primero salí con `Ctrl+C`.

---

## Problemas comunes

### No aparece `/dev/ttyUSB0`

Mirá qué detectó el kernel al enchufar la placa:

```bash
dmesg | tail -20
```

**Si ves `cp210x converter now attached to ttyUSB0`** → está todo bien, la placa
se ve, revisá de nuevo el `ls`.

**Si no ves nada al enchufar y desenchufar:** es el cable. Muchísimos cables USB
son *solo de carga*: tienen los hilos de alimentación pero no los de datos. Con
uno de esos el LED rojo de la placa prende igual (por eso confunde tanto), pero
la PC nunca ve el puerto. Probá con otro cable, preferentemente uno con el que
hayas pasado archivos desde un celular.

### Aparece y desaparece solo (Ubuntu)

Ubuntu trae `brltty`, un servicio para displays braille que reclama para sí los
dispositivos CP210x y te roba el puerto a los pocos segundos. Si en `dmesg` ves
menciones a `brltty`:

```bash
sudo apt remove brltty
```

Desenchufá y volvé a enchufar la placa.

### `Permission denied` al flashear

Volvé al paso 1: falta el `usermod -a -G dialout` (y cerrar sesión), o el
`chmod 666` provisorio.

### `Failed to connect to ESP32: Timed out waiting for packet header`

La placa no entró en modo flasheo. Lanzá `pio run -t upload` y, cuando aparezca
`Connecting........_____`, **mantené apretado el botón BOOT** de la placa;
soltalo apenas veas subir el porcentaje.

Si sigue fallando, agregá esta línea al `platformio.ini`, abajo de
`monitor_speed`, y probá de nuevo:

```ini
upload_speed = 115200
```

### Sale basura tipo `␀␀ÿýÿ` en el monitor

Velocidad equivocada: tiene que ser `-b 115200`.

Si la basura sale **solo en las primeras líneas** y después se acomoda, es
normal: es el bootloader del ESP32 hablando a otra velocidad antes de que
arranque nuestro código.
