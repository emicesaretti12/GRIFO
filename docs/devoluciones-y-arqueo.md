# Devolución de tarjeta y cierre de caja

SQL: [`supabase/14-devoluciones.sql`](../supabase/14-devoluciones.sql).
Pruebas: [`supabase/15-pruebas-devoluciones.sql`](../supabase/15-pruebas-devoluciones.sql).

---

## 1. Devolver la tarjeta

### El problema

Las tarjetas se reusan. El cliente se va, la devuelve, y la tarjeta vuelve a la
pila para el próximo. Si el saldo que le sobró se queda adentro, **el próximo
que agarre esa tarjeta se sirve gratis**.

Eso no era una comodidad que faltaba: era plata que se va sin que nadie la vea
salir.

### Cómo funciona

```sql
caja_devolver_tarjeta(p_uid text, p_motivo text default null)
```

Devuelve el saldo restante, lo asienta como `tipo = 'devolucion'` firmado por
quien lo hizo, deja la tarjeta en cero y **le borra la nota** — el nombre del
cliente anterior no tiene por qué viajar al próximo que la agarre.

Tres cosas que importan:

- **Es idempotente por construcción, no por acordarse de chequear.** La segunda
  llamada encuentra el saldo ya en cero y devuelve `0` sin asentar nada. Si el
  cajero aprieta dos veces, no paga dos veces. Es la misma idea que en
  `cerrar_sesion`: la seguridad sale del estado, no de un flag.

- **Con una sesión abierta no se devuelve.** La tarjeta está apoyada en un grifo
  y puede estar sirviendo *ahora*: devolverle la plata en ese momento dejaría
  una tirada en curso sin respaldo, y cuando el ESP32 liquide el cobro no
  tendría de dónde salir. Primero se retira la tarjeta del grifo.

- **`devolucion` tiene tipo propio, no es un `consumo` negativo.** El consumo es
  facturación; la devolución es plata que sale del cajón. Mezclarlos falsea el
  arqueo y la ganancia del día.

### En la app

En **Caja**, con la tarjeta buscada: **Devolver tarjeta**. El modal muestra en
grande cuánto hay que darle en efectivo antes de confirmar. El botón queda
deshabilitado —y dice por qué— si la tarjeta está apoyada en un grifo.

---

## 2. Cierre de caja

### El problema

Al final del turno hay que poder comparar lo que dice el sistema contra lo que
hay en el cajón. Y hay un número que un bar de prepago **tiene** que mirar y que
es fácil de confundir: el saldo en circulación.

### Cómo funciona

```sql
arqueo(p_desde timestamptz default null, p_hasta timestamptz default null)
```

Los rangos son `[desde, hasta)`: el borde de arriba no entra, así dos turnos
consecutivos nunca se pisan ni dejan un hueco.

Por defecto el período es "hoy", y **hoy arranca a las 6 de la mañana**. Un bar
cierra de madrugada: lo que se sirvió a las 2 AM pertenece al turno de la noche
anterior, no al que todavía no abrió.

### Qué muestra

**El cajón.** Cargas menos devoluciones = lo que tiene que haber de más en el
cajón. Se escribe lo que se contó y la pantalla dice si falta, sobra o cuadra.

Los **ajustes** aparecen aparte y no entran en ese neto, a propósito: un ajuste
corrige el saldo de una tarjeta, no mueve plata del cajón. Sumarlos ahí haría
que la caja no cuadre justo cuando alguien corrigió un error.

**Lo que se sirvió.** Facturación, costo y margen del período, calculados con el
costo **congelado** en cada tirada. Si mañana sube el barril, la ganancia de
ayer no cambia.

**Saldo en circulación.** La suma de todos los saldos de tarjetas. Esto **no es
ganancia, es una deuda**: cada peso es cerveza que alguien ya pagó y todavía no
se tomó, o plata que va a pedir de vuelta cuando devuelva la tarjeta.
Confundirla con ingreso es la forma más común de creer que te fue mejor de lo
que te fue.

**Por persona.** Quién cargó, quién devolvió, quién ajustó. Sin esto el arqueo
dice que falta plata pero no dónde mirar.

**Sesiones abiertas.** Tarjetas que quedaron trabadas en un grifo. Si el arqueo
no las muestra, el que cierra la caja se va a su casa sin saber que mañana hay
tres tarjetas que no se pueden usar.

### Quién ve qué

| | Cajero | Admin |
|---|---|---|
| El cajón (cargas, devoluciones, neto, ajustes) | ✅ | ✅ |
| Sesiones abiertas | ✅ | ✅ |
| Facturación, costo y margen | ❌ | ✅ |
| Saldo en circulación | ❌ | ✅ |
| Desglose por persona | ❌ | ✅ |

El cajero necesita cuadrar el cajón; no necesita saber cuánto gana el bar. Es la
misma razón por la que no tiene `SELECT` sobre las tablas.

**El recorte lo hace el backend, no la pantalla**: la función directamente no
devuelve esos campos si quien pregunta no es admin. Ocultar un `<div>` no es una
medida de seguridad — quien sabe abrir la consola del navegador lo ve igual.
