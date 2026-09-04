# Barriles y ajustes de saldo

Dos cosas que faltaban para que el sistema sirva un día completo de bar sin que
nadie tenga que abrir la base a mano.

SQL: [`supabase/12-barriles.sql`](../supabase/12-barriles.sql).
Pruebas: [`supabase/13-pruebas-barriles.sql`](../supabase/13-pruebas-barriles.sql).

---

## 1. Stock de barriles

### El problema

Antes, el sistema sabía perfectamente cuánta cerveza vendió y cuánta plata
entró, pero no tenía idea de **cuánto queda en el barril**. En la práctica eso
significa que te enterás de que se terminó cuando un cliente apoya la tarjeta,
aprieta el botón y sale espuma.

### Cómo funciona

Cada grifo tiene **un barril activo**, garantizado por un índice único parcial:

```sql
create unique index if not exists barriles_uno_activo_por_grifo
  on public.barriles (grifo_id) where (estado = 'activo');
```

Es la misma idea que el índice de "una sesión abierta por tarjeta": en vez de
chequear en la aplicación si ya hay otro barril activo —y correr la carrera de
que dos pedidos lo chequeen al mismo tiempo y los dos pasen— se lo pedimos a
Postgres, que no puede equivocarse.

El descuento del stock va en un **trigger** sobre `sesiones`, no adentro de
`cerrar_sesion`:

```sql
create trigger tr_barril_descontar before update on public.sesiones
  for each row execute function public.barril_descontar();
```

Dos razones:

1. **El stock es una consecuencia de que una sesión se liquide, no parte del
   cobro.** El cobro tiene que poder cambiar (precios, promociones) sin tocar el
   inventario, y al revés.
2. Volver a correr `02-funciones.sql` no puede pisar el descuento de stock.
   Si estuviera adentro de `cerrar_sesion`, cada vez que actualizás las
   funciones te llevás el inventario puesto.

El barril se congela en la sesión (`sesiones.barril_id`) al abrirla, igual que
el precio. Si cambiás el barril en el medio de una tirada, esa tirada se
descuenta del barril del que efectivamente salió.

### En la app

**Barriles** en el menú lateral. Cada grifo muestra un tubo con lo que queda, en
litros y **en vasos**, que es la unidad en la que piensa el que atiende: "quedan
12 vasos" se entiende mucho más rápido que "quedan 3.6 litros".

Por debajo del **15%** el tubo se pone en alerta y aparece además un aviso en el
panel de inicio, para que no haya que entrar a la pantalla de barriles para
enterarse.

**Cambiar barril** cierra el activo (queda como `terminado`, con su histórico) y
abre uno nuevo con los litros que cargues. El que quedó guarda cuánto se sirvió
realmente, así se puede comparar contra los litros nominales del proveedor.

---

## 2. Ajuste de saldo

### El problema

El cajero carga $10.000 en vez de $1.000. Antes de esto, la única salida era
editar la tabla a mano desde Supabase: sin rastro, sin motivo y sin saber quién
lo hizo. Eso es exactamente el agujero por donde se va la plata en un bar.

### Cómo funciona

```sql
admin_ajustar_saldo(p_uid text, p_centavos bigint, p_motivo text)
```

Tres reglas, y ninguna es negociable:

- **Solo admin.** El cajero puede cargar saldo, no corregirlo. Si el que se
  equivoca es el mismo que puede tapar el error, no hay control.
- **Motivo obligatorio.** Un ajuste sin explicación no se distingue de un robo.
- **Nunca deja la tarjeta en negativo.** El ajuste que la pasaría de cero se
  rechaza con `saldo_insuficiente`.

Queda registrado en `movimientos` con `tipo = 'ajuste'`, el `motivo` y el
`hecho_por`. Aparece en el historial de la tarjeta con su propio chip, así que
en el arqueo del día se ven separados de las cargas reales.

### En la app

En **Caja**, con la tarjeta buscada, el botón **Ajustar saldo** (solo lo ve el
admin). Se escribe la **diferencia con signo** —`-9000` para sacar, `1500` para
sumar— y la pantalla muestra en qué saldo va a quedar la tarjeta *antes* de
confirmar, que es la pregunta que uno se hace justo antes de apretar.
