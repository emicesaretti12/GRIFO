-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Arqueo
--
-- Consultas de control para correr cuando quieras. No modifican nada.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. ¿El libro mayor cuadra con los saldos? ───────────────────────────────
-- Cada tarjeta tiene que cumplir: suma de movimientos = saldo actual.
-- Si aparece alguna fila acá, hay plata que entró o salió sin quedar asentada.
--
-- Nota: las tarjetas creadas a mano (editando la tabla) van a figurar como
-- descuadradas, y está bien que se noten — de eso se trata.
select t.uid,
       t.saldo_centavos                        as saldo,
       coalesce(sum(m.centavos), 0)            as suma_movimientos,
       t.saldo_centavos - coalesce(sum(m.centavos), 0) as diferencia
  from public.tarjetas t
  left join public.movimientos m on m.uid = t.uid
 group by t.uid, t.saldo_centavos
having t.saldo_centavos <> coalesce(sum(m.centavos), 0)
 order by abs(t.saldo_centavos - coalesce(sum(m.centavos), 0)) desc;


-- ── 2. Cobros recortados ────────────────────────────────────────────────────
-- El ESP32 tendría que cortar antes de pasarse del saldo. Si hay filas acá,
-- alguien sirvió más de lo que tenía y se cobró solo hasta donde alcanzaba.
select id, uid, grifo_id, ml_servidos, costo_centavos, cerrada_en
  from public.sesiones
 where costo_recortado
 order by cerrada_en desc;


-- ── 3. Cierres que hubo que reintentar ──────────────────────────────────────
-- intentos_cierre > 1 significa que al ESP32 no le llegó la respuesta y
-- reintentó. Unos pocos son normales; muchos indican problema de red.
select id, uid, grifo_id, intentos_cierre, ml_servidos, cerrada_en
  from public.sesiones
 where intentos_cierre > 1
 order by intentos_cierre desc, cerrada_en desc;


-- ── 4. Sesiones colgadas ────────────────────────────────────────────────────
-- Abiertas hace rato, o abandonadas que nunca se liquidaron (el ESP32 se
-- quedó con la transacción en la cola del NVS y nunca volvió).
select id, uid, grifo_id, estado, abierta_en,
       now() - abierta_en as hace_cuanto
  from public.sesiones
 where estado in ('abierta', 'abandonada')
 order by abierta_en;


-- ── 5. Grifos sin token ─────────────────────────────────────────────────────
-- Estos no pueden operar (fallan cerrado). Si un grifo está en la barra y
-- aparece acá, hay que correrle rotar_token_grifo y grabarle el token.
select id, nombre, activo, token_rotado_en
  from public.grifos
 where token_hash is null;
