# Qué hace que esto aguante años

Auditoría de lo que rompe un sistema como este con el tiempo, qué se hizo, y qué
queda.

No es una lista de buenas intenciones: cada punto dice **qué falla concretamente
si no está**.

---

## Hecho

### 1. Watchdog: la canilla se recupera sola

**Qué pasaba sin esto:** si una tarea se trababa —un bug, un pico de ruido, un
puntero mal— la canilla quedaba muerta hasta que alguien notara que no funciona y
fuera a desenchufarla. En un bar, eso puede ser toda una noche.

**Qué hace:** cada tarea avisa que está viva. Si deja de avisar durante 30
segundos, el chip se reinicia solo.

> Es el proceso que se reinicia cuando deja de responder al health check. No
> arregla la causa, pero evita que una falla dure horas.

Y el reinicio es seguro **por construcción**: al arrancar, el GPIO del relé es
una entrada en alta impedancia, o sea válvula cerrada. Un watchdog que reiniciara
con la canilla abierta sería peor que no tenerlo.

Los 30 segundos son holgados a propósito: una petición HTTPS puede tardar 8 s, y
la tarea de red puede encadenar dos. El watchdog tiene que disparar por algo
trabado de verdad, no por una red lenta.

### 2. Latido: se ve cuándo una canilla se cae

**Qué pasaba sin esto:** una canilla colgada, sin WiFi, o con ventas sin cobrar
atoradas **no se notaba hasta que un cliente reclamaba**.

Un sistema que dura años no es uno que no falla: es uno donde **se ve que falló**,
temprano y sin que nadie tenga que ir a mirar.

> Es la diferencia entre tener logs y tener alertas. El primero te deja averiguar
> qué pasó; el segundo te avisa mientras está pasando.

**Qué hace:** cada ESP32 manda un latido por minuto con su versión de firmware,
cuántos cierres tiene sin entregar, su señal WiFi y su IP. En la pantalla de
Canillas aparece:

| Chip | Significa |
|---|---|
| **En línea** | latido de hace menos de 3 minutos |
| **Sin señal · hace 12 min** | dejó de reportar |
| **Nunca reportó** | todavía no se instaló, o el token está mal |
| **3 sin cobrar** | ⚠️ hay ventas servidas esperando entregarse |
| **-45 dBm** | señal; arriba de -70 está bien |

Tres minutos de tolerancia sobre un latido por minuto: aguanta dos perdidos antes
de alarmar. Un umbral más ajustado avisaría por cada bache de WiFi, y **una
alarma que suena por nada es una alarma que nadie mira**.

El latido va firmado con el token de la canilla. Si cualquiera pudiera mandarlos,
podría hacer figurar como sana una canilla caída, justo cuando hay que verla.

### 3. La limpieza de sesiones abandonadas, agendada

`cerrar_sesiones_abandonadas()` existía desde el principio y **nadie la
llamaba**. Una función de limpieza que no está agendada es una función que no
existe: las sesiones abandonadas se acumulan, y **una tarjeta con una sesión
abierta no puede servir en ninguna canilla**.

Ahora corre con `pg_cron` cada 5 minutos. Si la extensión no está habilitada, el
SQL avisa en vez de fallar en silencio.

### 4. La plata, probada y no supuesta

`./pruebas/correr.sh` barre ~4 millones de combinaciones verificando que **cobrar
lo autorizado nunca supere el saldo**. Corre en la computadora, sin placa, en un
segundo.

### 5. Las migraciones, probadas en una base vacía

Las 21 corren limpias en orden sobre un Postgres nuevo, con sus suites de
pruebas. Ver [`_pruebas-locales/README.md`](../supabase/_pruebas-locales/README.md).

---

## Lo que ya estaba y sostiene el resto

| | |
|---|---|
| **Corte local** | El límite se pasa a pulsos al autorizar. Durante la tirada es una comparación de enteros: sin red, sin consultas. El WiFi puede caerse a mitad de una pinta y corta igual. |
| **Invariante de la válvula** | Cada vuelta del loop, si el estado no es `SIRVIENDO`, la válvula se cierra. No se verifica: se cierra. |
| **Cola en flash** | El cierre se escribe en NVS antes que el ticket. Si se corta la luz, sobrevive el cobro. |
| **Idempotencia** | Reintentar un cierre ya entregado devuelve `repetida` y no cobra dos veces. Visto funcionando en la placa. |
| **Dos failsafes** | 90 s máximo abierta, y 3 s abierta sin pulsos. No dependen de que la lógica de arriba sea correcta. |
| **Plata en enteros** | Nunca `float`. Las dos asimetrías de redondeo, a favor del bar. |

---

## Lo que falta, en orden de importancia

### 1. Validar el certificado TLS ← antes del bar

Hoy el firmware se conecta **sin verificar** quién está del otro lado. Alguien en
la misma red podría hacerse pasar por Supabase y quedarse con el token de la
canilla.

```bash
openssl s_client -showcerts -connect TUPROYECTO.supabase.co:443 </dev/null
```

y el último bloque `-----BEGIN CERTIFICATE-----` va en `CERT_RAIZ` del
`secrets.h`. Es la diferencia entre `rejectUnauthorized: false` y validar.

### 2. Diodo de rueda libre en la válvula ← antes del bar

Un `1N4007`. Sin él, cada cierre manda un pico de cientos de volts que castiga
los contactos del relé. Ver la trampa 7 en
[`pinout-y-trampas.md`](pinout-y-trampas.md).

### 3. Guardar el progreso de la tirada

Si se corta la luz **con la válvula abierta**, la cerveza que ya salió no se
cobra: el ESP32 olvida cuántos pulsos llevaba. El servidor cierra la sesión por
abandono a los 15 minutos, en cero.

Se arregla persistiendo el avance en NVS cada ~100 pulsos. El costo es desgaste
de flash; el beneficio, no regalar media pinta cuando se corta la luz. **Vale la
pena recién cuando el sistema esté facturando de verdad**, para decidirlo con
datos y no con una corazonada.

### 4. Autorizar más rápido

Hoy tarda ~2,3 s: el cliente tiene que sostener la tarjeta. Es el handshake TLS,
que se rehace en cada petición. Reusando la conexión bajaría a menos de un
segundo.

### 5. Tests de la máquina de estados sin placa

`dinero.h` ya se prueba en la computadora. La máquina de estados no: hoy la única
forma de probarla es flashear y servir.

Extraerla a un módulo puro —sin Arduino— permitiría probar en un segundo los
casos que en la placa cuestan quince minutos: que la válvula nunca abra fuera de
`SIRVIENDO`, que los failsafes disparen, que retirar la tarjeta a mitad liquide
bien.

**Es lo de mayor valor a largo plazo.** Es lo que hace que dentro de dos años se
pueda cambiar algo sin miedo.

### 6. El MFRC522 se cuelga cada tanto

Apareció varias veces en las pruebas:

```
[tarjeta] se recupero reiniciando el lector
```

El último recurso lo levanta y la sesión se salva, pero la frecuencia es alta. Es
ruido en el SPI por la longitud del recorrido. En la canilla el lector va a 20 cm
con cable corto. **Si sigue apareciendo con cables cortos, hay un problema de
fondo.**

### 7. Montaje definitivo

La protoboard no va al bar. Ver la etapa 9 en
[`plan-de-etapas.md`](plan-de-etapas.md).
