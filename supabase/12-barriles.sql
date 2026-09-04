-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Barriles y ajustes de saldo
--
-- Correr después de 01, 02, 07 y 10.
--
-- Dos cosas que le faltaban al sistema para poder operar un bar:
--
--   1. SABER CUÁNTO QUEDA EN EL BARRIL. Ya medimos cada mL que sale; lo único
--      que faltaba era atribuirlo al barril que está puesto. Con eso el sistema
--      avisa cuándo pedir el próximo en vez de que se corte un viernes.
--
--   2. PODER CORREGIR UN ERROR DE CARGA. Si el cajero pone $10.000 donde iban
--      $1.000, hoy la única salida es editar la tabla a mano: sin motivo, sin
--      quién y sin rastro. Un ajuste con nombre y apellido es la diferencia
--      entre un sistema auditable y una planilla.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Guarda de orden ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'grifos'
       and column_name = 'costo_litro_centavos'
  ) then
    raise exception
      E'FALTAN ARCHIVOS ANTERIORES.\n\n'
      'Corré en este orden:\n'
      '   01-schema.sql -> 02-funciones.sql -> 07-personal.sql -> 10-pantallas.sql\n'
      'y recién después este.';
  end if;
end $$;


-- ── Barriles ────────────────────────────────────────────────────────────────
create table if not exists public.barriles (
  id             bigint generated always as identity primary key,
  grifo_id       int    not null references public.grifos(id),
  litros         numeric(7,2) not null check (litros > 0),
  ml_servidos    bigint not null default 0,
  costo_centavos bigint,                    -- lo que costó ESTE barril
  nota           text,
  instalado_por  uuid references auth.users(id),
  instalado_en   timestamptz not null default now(),
  agotado_en     timestamptz                -- null = es el que está puesto
);

comment on table public.barriles is
  'Un barril por canilla a la vez. ml_servidos lo acumula un trigger cuando se liquida cada sesión.';

-- Un solo barril activo por canilla, garantizado por índice y no por un if.
create unique index if not exists barriles_uno_activo_por_grifo
  on public.barriles (grifo_id) where (agotado_en is null);

create index if not exists barriles_grifo_idx on public.barriles (grifo_id, instalado_en desc);

-- De qué barril salió cada tirada. Sin esto, cambiar un barril reescribiría la
-- historia: las tiradas viejas pasarían a contar contra el barril nuevo.
alter table public.sesiones add column if not exists barril_id bigint references public.barriles(id);

alter table public.barriles enable row level security;
revoke all on table public.barriles from anon, authenticated;
grant select on table public.barriles to authenticated;
grant all    on table public.barriles to service_role;

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='barriles' and policyname='admin_lee_barriles') then
    create policy admin_lee_barriles on public.barriles
      for select to authenticated using (public.es_admin());
  end if;
end $$;


-- ── El consumo descuenta del barril, por trigger ────────────────────────────
-- Va como trigger y no dentro de cerrar_sesion a propósito: el stock es una
-- CONSECUENCIA de que una sesión se liquide, no parte del cobro. Así la función
-- que mueve plata no se mezcla con la que lleva el inventario, y volver a correr
-- 02-funciones.sql no puede pisar esta lógica.
create or replace function public.barril_descontar()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_barril bigint;
begin
  if new.estado = 'cerrada' and old.estado is distinct from 'cerrada'
     and coalesce(new.ml_servidos, 0) > 0 then

    select id into v_barril from public.barriles
     where grifo_id = new.grifo_id and agotado_en is null
     limit 1;

    if v_barril is not null then
      update public.barriles
         set ml_servidos = ml_servidos + new.ml_servidos
       where id = v_barril;
      new.barril_id := v_barril;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tr_barril_descontar on public.sesiones;
create trigger tr_barril_descontar
  before update on public.sesiones
  for each row execute function public.barril_descontar();


-- ── Cambiar el barril ───────────────────────────────────────────────────────
create or replace function public.admin_cambiar_barril(
  p_grifo int, p_litros numeric, p_costo_centavos bigint default null, p_nota text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_viejo public.barriles%rowtype;
  v_id    bigint;
begin
  if not public.es_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if p_litros is null or p_litros <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'litros_invalidos');
  end if;
  if not exists (select 1 from public.grifos where id = p_grifo) then
    return jsonb_build_object('ok', false, 'motivo', 'grifo_desconocido');
  end if;

  -- Cerramos el que estaba, si había
  update public.barriles set agotado_en = now()
   where grifo_id = p_grifo and agotado_en is null
   returning * into v_viejo;

  insert into public.barriles (grifo_id, litros, costo_centavos, nota, instalado_por)
  values (p_grifo, p_litros, p_costo_centavos, p_nota, (select auth.uid()))
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'barril_id', v_id, 'litros', p_litros,
    -- Cuánto se aprovechó del anterior: si sistemáticamente sobra o falta, la
    -- calibración de esa canilla está mal medida.
    'anterior', case when v_viejo.id is null then null else jsonb_build_object(
      'id', v_viejo.id,
      'litros', v_viejo.litros,
      'ml_servidos', v_viejo.ml_servidos,
      'aprovechado_pct', round((v_viejo.ml_servidos / (v_viejo.litros * 1000)) * 100, 1)
    ) end
  );
end;
$$;


-- ── Estado de los barriles ──────────────────────────────────────────────────
create or replace function public.estado_barriles()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x->>'restante_pct'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'grifo_id',     g.id,
               'grifo',        g.nombre,
               'color',        coalesce(g.color, '#c8811f'),
               'activo',       g.activo,
               'barril_id',    b.id,
               'litros',       b.litros,
               'ml_servidos',  b.ml_servidos,
               'ml_restantes', greatest(0, (b.litros * 1000)::bigint - b.ml_servidos),
               'restante_pct', case when b.litros > 0
                                    then greatest(0, round(100 - (b.ml_servidos / (b.litros * 10)), 1))
                                    else 0 end,
               'instalado_en', b.instalado_en,
               -- Vasos que quedan, que es como lo piensa el que atiende la barra
               'vasos',        case when g.ml_vaso > 0
                                    then greatest(0, ((b.litros * 1000)::bigint - b.ml_servidos) / g.ml_vaso)
                                    else 0 end
             ) as x
        from public.grifos g
        join public.barriles b on b.grifo_id = g.id and b.agotado_en is null
       where public.es_admin()
    ) t;
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- AJUSTES DE SALDO
-- ═════════════════════════════════════════════════════════════════════════════

-- El libro mayor pasa a aceptar un tercer tipo. Un ajuste NO se disfraza de
-- carga: tiene que poder distinguirse en el arqueo y en los reportes.
do $$
begin
  alter table public.movimientos drop constraint if exists movimientos_tipo_check;
  alter table public.movimientos add constraint movimientos_tipo_check
    check (tipo in ('carga', 'consumo', 'ajuste'));
end $$;

alter table public.movimientos add column if not exists motivo text;

-- Corrige el saldo de una tarjeta, para arriba o para abajo.
-- SOLO ADMIN, y con motivo obligatorio: un ajuste sin explicación es un agujero
-- por donde se va la plata sin que nadie pueda reconstruir qué pasó.
create or replace function public.admin_ajustar_saldo(
  p_uid text, p_centavos bigint, p_motivo text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   text;
  v_saldo bigint;
  v_mov   bigint;
begin
  if not public.es_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  v_uid := upper(trim(coalesce(p_uid, '')));
  if v_uid = '' then
    return jsonb_build_object('ok', false, 'motivo', 'uid_invalido');
  end if;
  if p_centavos is null or p_centavos = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'monto_invalido');
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'falta_motivo');
  end if;

  perform 1 from public.tarjetas where uid = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_desconocida');
  end if;

  select saldo_centavos into v_saldo from public.tarjetas where uid = v_uid;

  -- Un ajuste negativo no puede dejar la tarjeta en rojo. Si querés sacarle más
  -- de lo que tiene, el saldo queda en cero: la deuda no se registra acá.
  if p_centavos < 0 and (v_saldo + p_centavos) < 0 then
    return jsonb_build_object('ok', false, 'motivo', 'saldo_insuficiente',
      'detalle', 'La tarjeta tiene ' || (v_saldo / 100.0)::text ||
                 ' y el ajuste la dejaría en negativo.');
  end if;

  update public.tarjetas
     set saldo_centavos = saldo_centavos + p_centavos,
         actualizada_en = now()
   where uid = v_uid
   returning saldo_centavos into v_saldo;

  insert into public.movimientos (uid, tipo, centavos, saldo_resultante, referencia, motivo, hecho_por)
  values (v_uid, 'ajuste', p_centavos, v_saldo, 'ajuste manual', trim(p_motivo), (select auth.uid()))
  returning id into v_mov;

  return jsonb_build_object('ok', true, 'uid', v_uid,
                            'saldo_centavos', v_saldo, 'movimiento_id', v_mov);
end;
$$;


-- ── Permisos ────────────────────────────────────────────────────────────────
revoke all on function public.admin_cambiar_barril(int, numeric, bigint, text) from public, anon, authenticated;
revoke all on function public.estado_barriles()                                from public, anon, authenticated;
revoke all on function public.admin_ajustar_saldo(text, bigint, text)          from public, anon, authenticated;
revoke all on function public.barril_descontar()                               from public, anon, authenticated;

grant execute on function public.admin_cambiar_barril(int, numeric, bigint, text) to authenticated;
grant execute on function public.estado_barriles()                               to authenticated;
grant execute on function public.admin_ajustar_saldo(text, bigint, text)         to authenticated;
