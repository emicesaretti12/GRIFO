-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Devolución de tarjeta y arqueo de turno
--
-- Correr después de 01, 02, 07, 10 y 12.
--
-- Dos agujeros que quedaban para poder cerrar un día de bar:
--
--   1. DEVOLVER LA TARJETA. Las tarjetas se reusan: el cliente se va, la
--      devuelve y vuelve a la pila. Si el saldo que le sobró se queda adentro,
--      el próximo cliente que agarre esa tarjeta se sirve gratis. Hasta ahora
--      no había forma de cerrar una tarjeta: eso no es una comodidad que falta,
--      es plata que se va.
--
--   2. CERRAR LA CAJA. Al final del turno hay que poder comparar lo que dice el
--      sistema contra lo que hay en el cajón. Y sobre todo, saber cuánto saldo
--      quedó en circulación: esa es plata que el bar ya cobró pero todavía
--      debe en cerveza. Es un pasivo, no una ganancia, y confundirlos es la
--      forma más común de creer que te fue mejor de lo que te fue.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Guarda de orden ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='movimientos'
                    and column_name='hecho_por')
  or not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='es_personal') then
    raise exception
      E'FALTAN ARCHIVOS ANTERIORES.\n\n'
      'Corré en este orden:\n'
      '   01-schema.sql -> 02-funciones.sql -> 07-personal.sql -> 10-pantallas.sql\n'
      '   -> 12-barriles.sql\n'
      'y recién después este.';
  end if;
end $$;


-- ── El libro mayor acepta un tipo más ───────────────────────────────────────
-- 'devolucion' sale del mismo lado que 'consumo' (centavos negativos), pero no
-- es lo mismo: el consumo es facturación, la devolución es plata que sale del
-- cajón. Mezclarlos falsea el arqueo, así que llevan tipo propio.
do $$
begin
  alter table public.movimientos drop constraint if exists movimientos_tipo_check;
  alter table public.movimientos add constraint movimientos_tipo_check
    check (tipo in ('carga', 'consumo', 'ajuste', 'devolucion'));
end $$;


-- ── Devolver la tarjeta ─────────────────────────────────────────────────────
-- El cliente entrega la tarjeta, se le devuelve en efectivo lo que le sobró y
-- la tarjeta queda limpia para el próximo.
--
-- Es idempotente por construcción y no por acordarse de chequear: la segunda
-- llamada encuentra el saldo ya en cero y devuelve 0, sin asentar nada. Si el
-- cajero aprieta dos veces, no paga dos veces.
create or replace function public.caja_devolver_tarjeta(
  p_uid text, p_motivo text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      text;
  v_saldo    bigint;
  v_nota     text;
  v_mov      bigint;
  v_abierta  bigint;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  v_uid := upper(trim(coalesce(p_uid, '')));
  if v_uid = '' then
    return jsonb_build_object('ok', false, 'motivo', 'uid_invalido');
  end if;

  -- Mismo orden de locks que en todas las demás funciones: tarjetas y después
  -- sesiones. Es lo único que evita que dos operaciones se traben entre sí.
  perform 1 from public.tarjetas where uid = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_desconocida');
  end if;

  -- Con una sesión abierta la tarjeta está apoyada en un grifo y puede estar
  -- sirviendo AHORA. Devolverle la plata en ese momento dejaría una tirada en
  -- curso sin respaldo: cuando el ESP32 liquide, el cobro no tendría de dónde
  -- salir. Primero se retira la tarjeta del grifo, después se devuelve.
  select id into v_abierta
    from public.sesiones
   where uid = v_uid and estado = 'abierta'
   limit 1;
  if v_abierta is not null then
    return jsonb_build_object('ok', false, 'motivo', 'sesion_abierta',
      'detalle', 'La tarjeta está apoyada en un grifo. Retirala primero.',
      'sesion_id', v_abierta);
  end if;

  select saldo_centavos, nota into v_saldo, v_nota
    from public.tarjetas where uid = v_uid;

  if v_saldo = 0 then
    -- Nada que devolver, pero igual limpiamos la tarjeta: el nombre del cliente
    -- anterior no tiene por qué viajar al próximo que la agarre.
    update public.tarjetas
       set nota = null, actualizada_en = now()
     where uid = v_uid;
    return jsonb_build_object('ok', true, 'uid', v_uid, 'devuelto_centavos', 0,
                              'saldo_centavos', 0, 'nada_que_devolver', true);
  end if;

  update public.tarjetas
     set saldo_centavos = 0,
         nota           = null,
         actualizada_en = now()
   where uid = v_uid;

  insert into public.movimientos (uid, tipo, centavos, saldo_resultante,
                                  referencia, motivo, hecho_por)
  values (v_uid, 'devolucion', -v_saldo, 0,
          coalesce(nullif(trim(v_nota), ''), 'devolución de tarjeta'),
          nullif(trim(coalesce(p_motivo, '')), ''), (select auth.uid()))
  returning id into v_mov;

  return jsonb_build_object('ok', true, 'uid', v_uid,
                            'devuelto_centavos', v_saldo,
                            'saldo_centavos', 0,
                            'cliente', v_nota,
                            'movimiento_id', v_mov);
end;
$$;

comment on function public.caja_devolver_tarjeta(text, text) is
  'Devuelve el saldo restante en efectivo y deja la tarjeta en cero, lista para el próximo cliente.';


-- ── Arqueo de turno ─────────────────────────────────────────────────────────
-- Todo lo que hace falta para cerrar la caja de un período, en una sola
-- llamada. Los rangos son [desde, hasta): el borde de arriba no entra, así dos
-- turnos consecutivos nunca se pisan ni dejan un hueco.
create or replace function public.arqueo(
  p_desde timestamptz default null,
  p_hasta timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_desde timestamptz;
  v_hasta timestamptz;
  v_mov   jsonb;
  v_con   jsonb;
  v_gente jsonb;
  v_res   jsonb;
  v_circ  bigint;
  v_colg  int;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  -- Por defecto, el día de hoy. Un bar cierra de madrugada, así que "hoy"
  -- arranca a las 6 de la mañana: lo que se sirvió a las 2 AM pertenece al
  -- turno de la noche anterior, no al que todavía no abrió.
  v_desde := coalesce(p_desde, date_trunc('day', now() - interval '6 hours') + interval '6 hours');
  v_hasta := coalesce(p_hasta, now());

  if v_hasta <= v_desde then
    return jsonb_build_object('ok', false, 'motivo', 'rango_invalido');
  end if;

  -- Plata que entró y salió por el mostrador.
  select coalesce(jsonb_object_agg(tipo, fila), '{}'::jsonb) into v_mov
    from (
      select tipo,
             jsonb_build_object('cantidad', count(*), 'centavos', sum(centavos)) as fila
        from public.movimientos
       where creado_en >= v_desde and creado_en < v_hasta
       group by tipo
    ) t;

  -- Lo que se sirvió: facturación, costo y margen real del período.
  -- SOLO PARA EL ADMIN. El cajero necesita cuadrar el cajón, no saber cuánto
  -- gana el bar: es la misma razón por la que no tiene SELECT sobre las tablas.
  select jsonb_build_object(
           'sesiones', count(*),
           'ml',       coalesce(sum(ml_servidos), 0),
           'centavos', coalesce(sum(costo_centavos), 0),
           -- El costo se congela al liquidar, igual que el precio. Usamos ese
           -- snapshot y no el costo de hoy: si mañana sube el barril, la
           -- ganancia de ayer no cambia.
           'costo_centavos', coalesce(sum(costo_producto_centavos), 0))
    into v_con
    from public.sesiones
   where estado = 'cerrada' and cerrada_en >= v_desde and cerrada_en < v_hasta;

  -- Quién hizo qué. Sin esto el arqueo dice que falta plata pero no dónde
  -- mirar; con esto se ve el turno de cada uno por separado.
  select coalesce(jsonb_agg(f order by f->>'nombre'), '[]'::jsonb) into v_gente
    from (
      select jsonb_build_object(
               'nombre',      coalesce(pe.nombre, 'sin identificar'),
               'cargas',      coalesce(sum(m.centavos) filter (where m.tipo = 'carga'), 0),
               'devoluciones',coalesce(-sum(m.centavos) filter (where m.tipo = 'devolucion'), 0),
               'ajustes',     coalesce(sum(m.centavos) filter (where m.tipo = 'ajuste'), 0),
               'operaciones', count(*)) as f
        from public.movimientos m
        left join public.personal pe on pe.user_id = m.hecho_por
       where m.creado_en >= v_desde and m.creado_en < v_hasta
         and m.tipo in ('carga', 'devolucion', 'ajuste')
       group by coalesce(pe.nombre, 'sin identificar')
    ) t;

  -- El pasivo: saldo cargado que todavía nadie se tomó. NO es ganancia.
  select coalesce(sum(saldo_centavos), 0) into v_circ from public.tarjetas;

  -- Tarjetas que quedaron trabadas con una sesión abierta. Si el arqueo no las
  -- muestra, el que cierra la caja se va a su casa sin saber que mañana hay
  -- tres tarjetas que no se pueden usar.
  select count(*) into v_colg from public.sesiones where estado = 'abierta';

  -- Lo que ve cualquiera del personal: el cajón, que es lo que tiene que
  -- cuadrar al cerrar el turno.
  v_res := jsonb_build_object(
    'ok', true,
    'es_admin', public.es_admin(),
    'desde', v_desde, 'hasta', v_hasta,
    'cargas_centavos',       coalesce((v_mov->'carga'->>'centavos')::bigint, 0),
    'cargas_cantidad',       coalesce((v_mov->'carga'->>'cantidad')::int, 0),
    'devoluciones_centavos', coalesce(-(v_mov->'devolucion'->>'centavos')::bigint, 0),
    'devoluciones_cantidad', coalesce((v_mov->'devolucion'->>'cantidad')::int, 0),
    'ajustes_centavos',      coalesce((v_mov->'ajuste'->>'centavos')::bigint, 0),
    'ajustes_cantidad',      coalesce((v_mov->'ajuste'->>'cantidad')::int, 0),
    -- Lo que tiene que haber de más en el cajón por operaciones de tarjeta.
    'neto_caja_centavos',    coalesce((v_mov->'carga'->>'centavos')::bigint, 0)
                             + coalesce((v_mov->'devolucion'->>'centavos')::bigint, 0),
    'sesiones_abiertas',     v_colg);

  if not public.es_admin() then
    return v_res;
  end if;

  return v_res || jsonb_build_object(
    'consumo',               v_con,
    'margen_centavos',       (v_con->>'centavos')::bigint - (v_con->>'costo_centavos')::bigint,
    'saldo_en_circulacion_centavos', v_circ,
    'por_persona',           v_gente);
end;
$$;

comment on function public.arqueo(timestamptz, timestamptz) is
  'Cierre de caja de un período: cargas, devoluciones, ajustes, consumo con margen y saldo en circulación.';


-- ── Permisos ────────────────────────────────────────────────────────────────
revoke all on function public.caja_devolver_tarjeta(text, text)     from public, anon, authenticated;
revoke all on function public.arqueo(timestamptz, timestamptz)      from public, anon, authenticated;

grant execute on function public.caja_devolver_tarjeta(text, text)  to authenticated;
grant execute on function public.arqueo(timestamptz, timestamptz)   to authenticated;

do $$ begin raise notice '✅ 14-devoluciones.sql aplicado'; end $$;
