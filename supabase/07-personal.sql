-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Personal, roles y permisos de la app de gestión
--
-- Correr DESPUÉS de 01 y 02. Idempotente.
--
-- El problema que resuelve: la app de gestión corre en un navegador, así que
-- NO puede usar la service_role (cualquiera abre las devtools y se lleva la
-- llave maestra). Cada persona del personal entra con su propio usuario y la
-- base decide qué puede hacer según su rol.
--
-- Tres anillos de acceso:
--   ESP32          → anon + token del grifo → solo abrir/cerrar sesiones
--   cajero         → su login               → cargar saldo, consultar, bloquear
--   admin          → su login               → todo lo anterior + precios,
--                                             calibración, tokens y reportes
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Quién es quién ──────────────────────────────────────────────────────────
create table if not exists public.personal (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  nombre    text,
  rol       text not null check (rol in ('cajero', 'admin')),
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);

comment on table public.personal is
  'Rol de cada usuario del personal. Sin fila acá, un usuario logueado no puede hacer nada.';

alter table public.personal enable row level security;

-- Quién cargó cada movimiento, para poder auditar la caja.
alter table public.movimientos add column if not exists hecho_por uuid references auth.users(id);

-- Contexto del bloqueo de una tarjeta.
alter table public.tarjetas add column if not exists bloqueada_motivo text;
alter table public.tarjetas add column if not exists bloqueada_por    uuid references auth.users(id);
alter table public.tarjetas add column if not exists bloqueada_en     timestamptz;


-- ── Helpers de rol ──────────────────────────────────────────────────────────
-- SECURITY DEFINER a propósito: si leyeran `personal` con los permisos del que
-- llama, las políticas que usan estas funciones se llamarían a sí mismas.
create or replace function public.mi_rol()
returns text language sql stable security definer set search_path = ''
as $$
  select p.rol from public.personal p
   where p.user_id = (select auth.uid()) and p.activo
$$;

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(public.mi_rol() = 'admin', false) $$;

create or replace function public.es_personal()
returns boolean language sql stable security definer set search_path = ''
as $$ select public.mi_rol() is not null $$;


-- ── Lectura de tablas ───────────────────────────────────────────────────────
-- SOLO el admin lee tablas directo. El cajero no tiene acceso a ninguna: hace
-- todo por RPC, que le devuelve exactamente la tarjeta que consultó y nada más.
--
-- Así el cajero no puede sumarse la facturación del día ni exportarse el
-- padrón de tarjetas, aunque sepa usar la API. La restricción es de la base,
-- no de que la pantalla no tenga el botón.
grant select on table public.tarjetas    to authenticated;
grant select on table public.sesiones    to authenticated;
grant select on table public.movimientos to authenticated;
grant select on table public.personal    to authenticated;

-- En `grifos` el permiso es POR COLUMNA: ni el admin necesita ver token_hash.
grant select (id, nombre, precio_litro_centavos, pulsos_por_litro,
              ml_minimos, activo, token_rotado_en)
  on table public.grifos to authenticated;

do $$
begin
  -- Postgres no tiene "create policy if not exists"
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='tarjetas' and policyname='admin_lee_tarjetas') then
    create policy admin_lee_tarjetas on public.tarjetas for select to authenticated using (public.es_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='sesiones' and policyname='admin_lee_sesiones') then
    create policy admin_lee_sesiones on public.sesiones for select to authenticated using (public.es_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='movimientos' and policyname='admin_lee_movimientos') then
    create policy admin_lee_movimientos on public.movimientos for select to authenticated using (public.es_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='grifos' and policyname='personal_lee_grifos') then
    -- Los grifos sí los ve todo el personal: el cajero necesita saber qué
    -- canilla está activa y a cuánto está el litro para responder preguntas.
    create policy personal_lee_grifos on public.grifos for select to authenticated using (public.es_personal());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='personal' and policyname='veo_mi_ficha') then
    -- Cada uno ve su propia ficha (la app necesita saber qué rol tiene para
    -- dibujar el menú); el admin ve todo el personal.
    create policy veo_mi_ficha on public.personal for select to authenticated
      using (user_id = (select auth.uid()) or public.es_admin());
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- RPC de CAJA — cajero y admin
--
-- Todas chequean el rol adentro. Se le da EXECUTE a `authenticated` (cualquier
-- usuario logueado puede intentar), y la función rebota si no corresponde. Es
-- la misma idea que un middleware de autorización, pero adentro de la base:
-- no hay forma de saltearlo llamando a la API directo.
-- ═════════════════════════════════════════════════════════════════════════════

-- Ficha completa de una tarjeta: saldo, estado, últimos movimientos y si tiene
-- una sesión abierta ahora mismo. Es lo que el cajero ve al apoyar la tarjeta.
create or replace function public.caja_buscar_tarjeta(p_uid text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid text;
  v_t   public.tarjetas%rowtype;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  v_uid := upper(trim(coalesce(p_uid, '')));
  if v_uid = '' then
    return jsonb_build_object('ok', false, 'motivo', 'uid_invalido');
  end if;

  select * into v_t from public.tarjetas where uid = v_uid;
  if not found then
    -- No es un error: es una tarjeta nueva. La primera carga la da de alta.
    return jsonb_build_object('ok', true, 'existe', false, 'uid', v_uid);
  end if;

  return jsonb_build_object(
    'ok',               true,
    'existe',           true,
    'uid',              v_t.uid,
    'saldo_centavos',   v_t.saldo_centavos,
    'bloqueada',        v_t.bloqueada,
    'bloqueada_motivo', v_t.bloqueada_motivo,
    'nota',             v_t.nota,
    'movimientos', coalesce((
      select jsonb_agg(m order by m.creado_en desc)
        from (
          select id, tipo, centavos, saldo_resultante, referencia, creado_en
            from public.movimientos
           where uid = v_uid
           order by creado_en desc
           limit 15
        ) m
    ), '[]'::jsonb),
    'sesion_abierta', (
      select jsonb_build_object('id', s.id, 'grifo_id', s.grifo_id,
                                'abierta_en', s.abierta_en, 'ml_maximos', s.ml_maximos)
        from public.sesiones s
       where s.uid = v_uid and s.estado = 'abierta'
       limit 1
    )
  );
end;
$$;


-- Cargar saldo. Deja asentado QUIÉN lo hizo.
create or replace function public.caja_cargar_saldo(
  p_uid                text,
  p_centavos           bigint,
  p_referencia         text default null,
  p_clave_idempotencia text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v jsonb;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  v := public.cargar_saldo(p_uid, p_centavos, p_referencia, p_clave_idempotencia);

  -- Firmamos el movimiento. Si fue un reintento idempotente no tocamos nada:
  -- el asiento ya lleva la firma de quien lo hizo la primera vez.
  if coalesce((v->>'ok')::boolean, false)
     and not coalesce((v->>'repetida')::boolean, false) then
    update public.movimientos
       set hecho_por = (select auth.uid())
     where id = (v->>'movimiento_id')::bigint;
  end if;

  return v;
end;
$$;


-- Bloquear / desbloquear una tarjeta (se perdió, la robaron, etc.)
create or replace function public.caja_bloquear_tarjeta(
  p_uid text, p_bloquear boolean, p_motivo text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid text;
  v_t   public.tarjetas%rowtype;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  v_uid := upper(trim(coalesce(p_uid, '')));

  update public.tarjetas
     set bloqueada        = p_bloquear,
         bloqueada_motivo = case when p_bloquear then p_motivo else null end,
         bloqueada_por    = case when p_bloquear then (select auth.uid()) else null end,
         bloqueada_en     = case when p_bloquear then now() else null end,
         actualizada_en   = now()
   where uid = v_uid
   returning * into v_t;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_desconocida');
  end if;

  return jsonb_build_object('ok', true, 'uid', v_t.uid, 'bloqueada', v_t.bloqueada);
end;
$$;


-- ═════════════════════════════════════════════════════════════════════════════
-- RPC de ADMINISTRACIÓN — solo admin
-- ═════════════════════════════════════════════════════════════════════════════

-- Actualizar un grifo. Los parámetros en NULL no se tocan, así la app puede
-- mandar solo el campo que el usuario editó.
create or replace function public.admin_actualizar_grifo(
  p_grifo            int,
  p_nombre           text    default null,
  p_precio_litro     bigint  default null,
  p_pulsos_por_litro numeric default null,
  p_ml_minimos       int     default null,
  p_activo           boolean default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_g public.grifos%rowtype;
begin
  if not public.es_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  if p_precio_litro is not null and p_precio_litro <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'precio_invalido');
  end if;
  if p_pulsos_por_litro is not null and p_pulsos_por_litro <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'calibracion_invalida');
  end if;

  -- No dejamos activar un grifo sin token: quedaría "en servicio" pero
  -- incapaz de operar, que es justo la contradicción que evitamos.
  if p_activo is true
     and (select token_hash from public.grifos where id = p_grifo) is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_token',
      'detalle', 'Rotá el token del grifo antes de activarlo.');
  end if;

  update public.grifos
     set nombre                = coalesce(p_nombre, nombre),
         precio_litro_centavos = coalesce(p_precio_litro, precio_litro_centavos),
         pulsos_por_litro      = coalesce(p_pulsos_por_litro, pulsos_por_litro),
         ml_minimos            = coalesce(p_ml_minimos, ml_minimos),
         activo                = coalesce(p_activo, activo)
   where id = p_grifo
   returning * into v_g;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'grifo_desconocido');
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_g.id, 'nombre', v_g.nombre,
    'precio_litro_centavos', v_g.precio_litro_centavos,
    'pulsos_por_litro', v_g.pulsos_por_litro,
    'ml_minimos', v_g.ml_minimos, 'activo', v_g.activo
  );
end;
$$;


-- Rotar el token de un grifo. Devuelve el token en claro UNA sola vez.
create or replace function public.admin_rotar_token(p_grifo int)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not public.es_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  return public.rotar_token_grifo(p_grifo);
end;
$$;


-- Dar de alta / cambiar el rol de alguien del personal.
-- El usuario tiene que existir antes en Supabase Auth (lo invitás desde el
-- panel de Supabase, o se registra). Acá solo le asignamos el rol.
create or replace function public.admin_set_rol(
  p_email text, p_rol text, p_nombre text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.es_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  if p_rol not in ('cajero', 'admin') then
    return jsonb_build_object('ok', false, 'motivo', 'rol_invalido');
  end if;

  select id into v_id from auth.users where lower(email) = lower(trim(p_email));
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_inexistente',
      'detalle', 'Invitá primero al usuario desde Supabase → Authentication.');
  end if;

  insert into public.personal (user_id, nombre, rol)
  values (v_id, p_nombre, p_rol)
  on conflict (user_id) do update
    set rol    = excluded.rol,
        nombre = coalesce(excluded.nombre, public.personal.nombre),
        activo = true;

  return jsonb_build_object('ok', true, 'email', p_email, 'rol', p_rol);
end;
$$;


-- Dar de baja a alguien (no borra: desactiva, así el historial sigue firmado).
create or replace function public.admin_baja_personal(p_email text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.es_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  select id into v_id from auth.users where lower(email) = lower(trim(p_email));
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_inexistente');
  end if;

  if v_id = (select auth.uid()) then
    return jsonb_build_object('ok', false, 'motivo', 'no_podes_darte_de_baja_solo');
  end if;

  update public.personal set activo = false where user_id = v_id;
  return jsonb_build_object('ok', true, 'email', p_email);
end;
$$;


-- ── Permisos ────────────────────────────────────────────────────────────────
revoke all on function public.mi_rol()                                             from public, anon;
revoke all on function public.es_admin()                                           from public, anon;
revoke all on function public.es_personal()                                        from public, anon;
revoke all on function public.caja_buscar_tarjeta(text)                            from public, anon;
revoke all on function public.caja_cargar_saldo(text, bigint, text, text)          from public, anon;
revoke all on function public.caja_bloquear_tarjeta(text, boolean, text)           from public, anon;
revoke all on function public.admin_actualizar_grifo(int, text, bigint, numeric, int, boolean) from public, anon;
revoke all on function public.admin_rotar_token(int)                               from public, anon;
revoke all on function public.admin_set_rol(text, text, text)                       from public, anon;
revoke all on function public.admin_baja_personal(text)                             from public, anon;

grant execute on function public.mi_rol()                                          to authenticated;
grant execute on function public.es_admin()                                        to authenticated;
grant execute on function public.es_personal()                                     to authenticated;
grant execute on function public.caja_buscar_tarjeta(text)                         to authenticated;
grant execute on function public.caja_cargar_saldo(text, bigint, text, text)       to authenticated;
grant execute on function public.caja_bloquear_tarjeta(text, boolean, text)        to authenticated;
grant execute on function public.admin_actualizar_grifo(int, text, bigint, numeric, int, boolean) to authenticated;
grant execute on function public.admin_rotar_token(int)                            to authenticated;
grant execute on function public.admin_set_rol(text, text, text)                    to authenticated;
grant execute on function public.admin_baja_personal(text)                          to authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- EL PRIMER ADMIN — problema del huevo y la gallina
--
-- admin_set_rol requiere ser admin, así que el primero hay que crearlo a mano.
-- Una sola vez, desde el SQL Editor de Supabase (que corre como superusuario):
--
--   1. Supabase → Authentication → Users → Add user (con tu mail)
--   2. Y acá, cambiando el mail:
--
--      insert into public.personal (user_id, nombre, rol)
--      select id, 'Tu Nombre', 'admin' from auth.users
--       where email = 'vos@ejemplo.com'
--      on conflict (user_id) do update set rol = 'admin', activo = true;
--
-- De ahí en adelante, al resto del personal lo das de alta desde la app.
-- ═════════════════════════════════════════════════════════════════════════════
