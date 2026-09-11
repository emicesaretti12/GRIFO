# Etapa 6 — Supabase + cola offline

La etapa 5 con los saldos de verdad. A partir de acá el sistema es el del bar.

**La válvula sigue sin conectarse.** Solo el relé haciendo clic.

---

## Dos tareas en dos núcleos

Una petición HTTPS puede tardar segundos: DNS, TLS, esperar al servidor. Si eso
pasara en el mismo lugar que la máquina de estados, la válvula quedaría abierta
sin que nadie cuente pulsos ni mire el límite durante todo ese rato.

| Tarea | Núcleo | Prioridad | De qué se ocupa |
|---|---|---|---|
| `tareaControl` | 1 | alta | tarjeta, pulsos, válvula |
| `tareaRed` | 0 | baja | WiFi, HTTPS, vaciar la cola |

**`tareaControl` nunca llama a la red.** Ni una vez. Se hablan por colas de
FreeRTOS.

> Es sacar el trabajo lento del request y mandarlo a un worker. La diferencia es
> que acá "el request" es lo que corta el chorro de cerveza.

---

## Qué pasa si se cae el WiFi

| Momento | Qué pasa |
|---|---|
| **A mitad de una tirada** | **Nada.** El límite ya está en pulsos, adentro del ESP32. El corte es una comparación de enteros y la red no participa. |
| **Al cerrar la sesión** | El cierre se escribe en la flash y se reintenta hasta que entre. El cliente se va, el próximo puede servir, la venta no se pierde. |
| **Al abrir una sesión** | Ahí sí hace falta red: el saldo vive en Supabase. Sin red no se autoriza. |

Lo último es deliberado: **preferimos no servir antes que servir sin saber si
hay con qué pagar.**

---

## La cola de cierres

Cuando termina una tirada, el cierre se escribe en **NVS** —la flash del
ESP32— y recién después se imprime el ticket. Si se corta la luz justo ahí, lo
que tiene que sobrevivir es el cobro, no el papelito.

> Es una outbox. Escribís la intención en tu propio almacenamiento dentro de la
> misma operación, y un worker la entrega después.

### Tres decisiones que la hacen confiable

**1. El dato antes que el índice.** Si el corte pasa en el medio, el dato quedó
escrito pero invisible: se pierde una entrega. Al revés se leería basura como si
fuera una venta.

**2. Entregar dos veces es aceptable, perder una no.** Los índices son
monótonos y no se reinician. En el peor caso se reenvía un cierre ya entregado,
y eso es inofensivo porque `cerrar_sesion` es **idempotente**: la segunda vez
devuelve `repetida: true` y no vuelve a cobrar.

> El diseño elige el error que se puede tolerar.

**3. Llena significa frenar, no pisar.** Una cola circular normal descarta lo
más viejo. Acá cada entrada es una venta. Cuando se llena (32 cierres), el
firmware **deja de autorizar sesiones nuevas**. Es preferible que la canilla no
sirva a que sirva sin cobrar.

---

## Configuración

Copiá la plantilla y completala:

```bash
cp src/etapa6_red/secrets.h.example src/etapa6_red/secrets.h
```

| Valor | De dónde sale |
|---|---|
| `WIFI_SSID` / `WIFI_PASS` | el WiFi del bar |
| `SUPABASE_URL` | Project Settings → API |
| `SUPABASE_ANON` | la publishable key (`sb_publishable_…`) |
| `GRIFO_ID` | el `id` de la canilla |
| `GRIFO_TOKEN` | app → Canillas → **Generar token** |

`secrets.h` está en `.gitignore`. **No va al repo**: quien tenga el token puede
liquidar sesiones en esa canilla.

### El certificado

Con `CERT_RAIZ` vacío, el firmware se conecta **sin validar** el certificado del
servidor. Anda, y para el banco de pruebas alcanza, pero alguien en la misma red
podría hacerse pasar por Supabase y quedarse con el token.

Antes de ponerlo en el bar:

```bash
openssl s_client -showcerts -connect TUPROYECTO.supabase.co:443 </dev/null
```

y pegá el **último** bloque `-----BEGIN CERTIFICATE-----` en `CERT_RAIZ`.

> Es la diferencia entre `rejectUnauthorized: false` y validar de verdad.

---

## Flashear

```bash
pio run -e etapa6_red -t upload
pio device monitor -b 115200
```

Con los **12 V desenchufados** mientras graba.

---

## Criterio de aceptación

- ✅ Conecta al WiFi y lo dice
- ✅ Apoyás la tarjeta y trae **el saldo real de Supabase**
- ✅ Servís, y al retirar la tarjeta el saldo baja **en la app**
- ✅ Una tarjeta sin saldo se rechaza con su motivo
- ✅ **Apagás el router a mitad de una tirada: el corte por límite funciona igual**
- ✅ Con el WiFi caído, al retirar la tarjeta el ticket dice "quedó en cola"
- ✅ Volvés a prender el router y el cobro aparece solo en la app
- ✅ **Cortás la luz del ESP32 con un cierre en cola, y al arrancar lo entrega**

Los dos últimos son los que importan. El resto dice que el sistema anda; esos
dicen que **no pierde plata cuando algo sale mal**, que es lo que un bar
necesita.
