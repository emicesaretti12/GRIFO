-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — El cliente se identifica con un código QR
--
-- Correr después de todos los anteriores (01 … 28). Idempotente.
--
-- Las tarjetas NFC se van. El cliente llega a la canilla con un QR, y hay dos
-- formas de tener uno:
--
--   · CON CELULAR: entra a su app con nombre y DNI, carga saldo y la app le
--     muestra un QR que se renueva solo cada minuto.
--   · SIN CELULAR: va a la caja, da su DNI y su nombre, paga, y se lleva un
--     ticket impreso con un QR que vale hasta que cierra el bar esa noche.
--
-- La tablet de la canilla lee el QR con la cámara. Lo que viaja en el QR no es
-- plata ni un DNI: es un código al azar que el servidor sabe a qué cuenta
-- pertenece y hasta cuándo vale.
--
--   Es un token de sesión, no una contraseña. Se puede vencer, se puede anular,
--   y robarlo sirve por poco tiempo.
--
-- ── Dos cuentas distintas a propósito ───────────────────────────────────────
-- Una cuenta de APP solo se mueve desde el celular que la creó. Una cuenta de
-- TICKET solo se mueve con el papel. Aunque sean del mismo DNI, no se mezclan.
--
-- Si se mezclaran, alguien podría registrar en la app el DNI de otra persona,
-- esperar a que esa persona cargue plata en la caja, y tomársela. Separadas,
-- la plata que entra por la caja solo sale con el ticket que el cajero le dio
-- en la mano a quien pagó.
--
--   Es no compartir la sesión entre dos métodos de login que no prueban lo
--   mismo. Cada credencial abre solo lo que se pagó con ella.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Guarda de orden ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'tablet_abrir_sesion')
  or not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'grifos'
                    and column_name = 'ultimo_evento') then
    raise exception
      E'FALTAN ARCHIVOS ANTERIORES.\n\n'
      'Este archivo va después de 26-sesion-activa.sql y 28-que-esta-haciendo.sql.\n'
      'Corré primero los que falten, en orden, y recién después este.';
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- LA JORNADA: el día de un bar no termina a medianoche
-- ═════════════════════════════════════════════════════════════════════════════
-- Lo que se sirve a las 2 de la mañana es de la noche anterior. La jornada va
-- de 6:00 a 6:00, **hora de Argentina**.
--
-- La zona va explícita porque la base corre en UTC: `date_trunc('day', now())`
-- corta a las 21:00 de acá, en pleno turno. El podio de la pantalla se
-- reiniciaba a esa hora.
--
--   Es el bug de comparar fechas sin zona horaria. Anda en la máquina del que
--   lo escribió y falla donde corre.
create or replace function public.inicio_jornada(p_momento timestamptz default now())
returns timestamptz
language sql stable
set search_path = ''
as $$
  select (date_trunc('day',
            (p_momento at time zone 'America/Argentina/Buenos_Aires') - interval '6 hours')
          + interval '6 hours') at time zone 'America/Argentina/Buenos_Aires'
$$;

comment on function public.inicio_jornada(timestamptz) is
  'Las 6:00 (hora de Argentina) que abren la jornada a la que pertenece ese momento.';

revoke all on function public.inicio_jornada(timestamptz) from public, anon, authenticated;
grant execute on function public.inicio_jornada(timestamptz) to authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- TABLAS
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Clientes ────────────────────────────────────────────────────────────────
-- La identidad. El saldo sigue viviendo en `tarjetas` (que ahora es una
-- billetera sin plástico): acá va de quién es.
create table if not exists public.clientes (
  uid               text primary key references public.tarjetas(uid),
  dni               text not null check (dni ~ '^[0-9]{7,8}$'),
  nombre            text not null,
  tipo              text not null check (tipo in ('app', 'ticket')),
  -- SHA-256 del secreto que guarda el celular. NULL = sin celular vinculado.
  -- Solo las cuentas de app lo usan.
  dispositivo_hash  text,
  dispositivo_en    timestamptz,
  creado_en         timestamptz not null default now(),
  creado_por        uuid references auth.users(id),
  unique (dni, tipo)
);

comment on table public.clientes is
  'De quién es cada billetera. Una por DNI y por tipo: la de app y la de ticket no se mezclan.';

alter table public.clientes enable row level security;
revoke all on table public.clientes from anon, authenticated;
grant all on table public.clientes to service_role;
grant select on table public.clientes to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'clientes' and policyname = 'admin_lee_clientes') then
    create policy admin_lee_clientes on public.clientes
      for select to authenticated using (public.es_admin());
  end if;
end $$;


-- ── Pases ───────────────────────────────────────────────────────────────────
-- Lo que viaja adentro del QR. Se guarda el hash, igual que el token de la
-- canilla: un dump de la base no sirve para fabricar un QR.
--
-- La excepción es el pase de ticket, que también guarda el código: hay que
-- poder reimprimir el mismo QR si el cliente carga plata dos veces en la noche.
-- Vale unas horas y por lo que quede en esa billetera.
create table if not exists public.pases (
  id            bigint generated always as identity primary key,
  uid           text not null references public.tarjetas(uid),
  origen        text not null check (origen in ('app', 'ticket')),
  codigo_hash   text not null unique,
  codigo        text,
  -- Seis dígitos que el cliente le dicta al cajero para cargar efectivo en su
  -- app. Prueba que tiene el celular en la mano, sin lector de por medio.
  codigo_corto  text,
  creado_en     timestamptz not null default now(),
  vence_en      timestamptz not null,
  usado_en      timestamptz,
  revocado_en   timestamptz,
  creado_por    uuid references auth.users(id)
);

create index if not exists pases_uid_idx on public.pases (uid, origen, vence_en desc);
create unique index if not exists pases_codigo_corto_idx
  on public.pases (codigo_corto) where (codigo_corto is not null);

alter table public.pases enable row level security;
revoke all on table public.pases from anon, authenticated;
grant all on table public.pases to service_role;


-- ── De dónde salió la plata ─────────────────────────────────────────────────
-- Hasta acá todo era efectivo. Con débito, transferencia y Mercado Pago, el
-- cierre de caja necesita saber qué parte de las cargas está en el cajón y qué
-- parte en el banco.
alter table public.movimientos add column if not exists medio_pago text;

do $$
begin
  alter table public.movimientos drop constraint if exists movimientos_medio_check;
  alter table public.movimientos add constraint movimientos_medio_check
    check (medio_pago is null or medio_pago in
           ('efectivo', 'debito', 'credito', 'transferencia', 'mercadopago'));
end $$;

comment on column public.movimientos.medio_pago is
  'Cómo se pagó una carga. NULL en cargas viejas (eran en efectivo) y en lo que no es carga.';


-- ── Una billetera habilita al menos un mililitro ────────────────────────────
-- Con `ml_minimos = 0`, un saldo de cero abría sesión con `ml_maximos = 0`. Y
-- el ESP32 lee un límite de cero pulsos como "sin límite": la válvula quedaba
-- abierta hasta el failsafe de tres minutos, sin cobrar.
--
--   Es el cero que significa "ilimitado" en un lado y "nada" en el otro. Se
--   cierra de los dos lados: acá no se puede configurar, y el firmware nuevo
--   trata el cero como nada.
update public.grifos set ml_minimos = 1 where ml_minimos < 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'grifos_ml_minimos_positivo') then
    alter table public.grifos add constraint grifos_ml_minimos_positivo
      check (ml_minimos >= 1);
  end if;
end $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- PIEZAS INTERNAS (no se le dan a nadie)
-- ═════════════════════════════════════════════════════════════════════════════

-- "12.345.678" → "12345678". NULL si no es un DNI.
create or replace function public._dni_limpio(p_dni text)
returns text language sql immutable set search_path = ''
as $$
  select case when d ~ '^[0-9]{7,8}$' then d end
    from (select regexp_replace(coalesce(p_dni, ''), '[^0-9]', '', 'g') as d) x
$$;

-- "  José   PÉREZ " → "jose perez". Para comparar nombres sin pelearse con
-- las mayúsculas, los acentos ni los espacios.
create or replace function public._nombre_norm(p_nombre text)
returns text language sql immutable set search_path = ''
as $$
  select trim(regexp_replace(
           translate(lower(coalesce(p_nombre, '')),
                     'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
           '[^a-z0-9]+', ' ', 'g'))
$$;

-- ¿El nombre que tipearon es de la misma persona? Alcanza con que compartan una
-- palabra de tres letras o más ("Emi Cesaretti" contra "Emiliano Cesaretti").
-- No es una contraseña: es la segunda mitad de "nombre y DNI".
create or replace function public._nombre_coincide(p_a text, p_b text)
returns boolean language sql immutable set search_path = ''
as $$
  select exists (
    select 1
      from unnest(string_to_array(public._nombre_norm(p_a), ' ')) a,
           unnest(string_to_array(public._nombre_norm(p_b), ' ')) b
     where length(a) >= 3 and length(b) >= 3
       and (a like b || '%' or b like a || '%'))
$$;

create or replace function public._hash(p_texto text)
returns text language sql immutable set search_path = ''
as $$ select encode(sha256(convert_to(coalesce(p_texto, ''), 'UTF8')), 'hex') $$;

-- 32 caracteres hexa al azar (128 bits), en mayúsculas: el modo alfanumérico
-- del QR los empaqueta más chico y el código se lee mejor impreso.
create or replace function public._codigo_nuevo()
returns text language sql volatile set search_path = ''
as $$ select upper(replace(gen_random_uuid()::text, '-', '')) $$;

-- Lo que leyó la cámara → el código pelado. Acepta "GRIFO:XXXX" y "XXXX".
create or replace function public._codigo_limpio(p_texto text)
returns text language sql immutable set search_path = ''
as $$
  select case when c ~ '^[0-9A-F]{32}$' then c end
    from (select regexp_replace(upper(trim(coalesce(p_texto, ''))), '^GRIFO:', '') as c) x
$$;

-- La cuenta de app de este DNI, solo si el celular es el vinculado.
create or replace function public._cliente_app(p_dni text, p_dispositivo text)
returns public.clientes
language sql stable security definer set search_path = ''
as $$
  select c.*
    from public.clientes c
   where c.dni = public._dni_limpio(p_dni)
     and c.tipo = 'app'
     and c.dispositivo_hash is not null
     and length(coalesce(p_dispositivo, '')) >= 32
     and c.dispositivo_hash = public._hash(p_dispositivo)
$$;

-- Crea la billetera y su cliente. El uid ya no sale de un plástico: es al azar.
create or replace function public._cliente_crear(
  p_dni text, p_nombre text, p_tipo text, p_dispositivo_hash text, p_por uuid
)
returns public.clientes
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid text;
  v_c   public.clientes;
begin
  v_uid := 'QR' || substr(public._codigo_nuevo(), 1, 14);

  insert into public.tarjetas (uid, saldo_centavos, nota, asignada_en, asignada_por)
  values (v_uid, 0, p_nombre, now(), p_por);

  insert into public.clientes (uid, dni, nombre, tipo, dispositivo_hash, dispositivo_en, creado_por)
  values (v_uid, p_dni, p_nombre, p_tipo, p_dispositivo_hash,
          case when p_dispositivo_hash is not null then now() end, p_por)
  returning * into v_c;

  return v_c;
end $$;

-- Carga plata y deja asentado con qué se pagó y quién la cargó. Es la única
-- puerta por la que entra saldo desde ahora: caja y Mercado Pago pasan por acá.
create or replace function public._cargar(
  p_uid text, p_centavos bigint, p_referencia text, p_clave text, p_medio text, p_por uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v jsonb;
begin
  v := public.cargar_saldo(p_uid, p_centavos, p_referencia, p_clave);

  if coalesce((v->>'ok')::boolean, false)
     and not coalesce((v->>'repetida')::boolean, false) then
    update public.movimientos
       set medio_pago = p_medio, hecho_por = p_por
     where id = (v->>'movimiento_id')::bigint;
  end if;

  return v;
end $$;

-- El pase de ticket de esta noche. Si ya hay uno vigente lo devuelve tal cual
-- (el cliente que carga dos veces se queda con un solo QR); si no, o si se
-- pidió renovar, crea uno nuevo y anula los anteriores.
create or replace function public._pase_de_ticket(p_uid text, p_renovar boolean, p_por uuid)
returns public.pases
language plpgsql security definer set search_path = ''
as $$
declare
  v_p      public.pases;
  v_codigo text;
begin
  if not p_renovar then
    select * into v_p from public.pases
     where uid = p_uid and origen = 'ticket'
       and revocado_en is null and vence_en > now() and codigo is not null
     order by vence_en desc limit 1;
    if found then return v_p; end if;
  end if;

  update public.pases set revocado_en = now()
   where uid = p_uid and origen = 'ticket' and revocado_en is null;

  v_codigo := public._codigo_nuevo();
  insert into public.pases (uid, origen, codigo_hash, codigo, vence_en, creado_por)
  values (p_uid, 'ticket', public._hash(v_codigo), v_codigo,
          -- Hasta que cierra el bar: las 6:00 que terminan esta jornada.
          public.inicio_jornada(now()) + interval '24 hours', p_por)
  returning * into v_p;

  return v_p;
end $$;

-- La ficha que ve el cajero. Una sola forma para las dos búsquedas (por DNI y
-- por el código de la app), así la pantalla dibuja lo mismo.
create or replace function public._ficha_cliente(p_c public.clientes)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true, 'existe', true,
    'uid', t.uid, 'dni', p_c.dni, 'nombre', p_c.nombre, 'tipo', p_c.tipo,
    'saldo_centavos', t.saldo_centavos,
    'bloqueada', t.bloqueada, 'bloqueada_motivo', t.bloqueada_motivo,
    'celular_vinculado', p_c.dispositivo_hash is not null,
    'movimientos', coalesce((
      select jsonb_agg(m order by m.creado_en desc)
        from (select id, tipo, centavos, saldo_resultante, referencia, motivo,
                     medio_pago, creado_en
                from public.movimientos
               where uid = t.uid
               order by creado_en desc limit 15) m), '[]'::jsonb),
    'sesion_abierta', (
      select jsonb_build_object('id', s.id, 'grifo_id', s.grifo_id,
                                'abierta_en', s.abierta_en, 'ml_maximos', s.ml_maximos)
        from public.sesiones s
       where s.uid = t.uid and s.estado = 'abierta' limit 1),
    'pase', (
      select jsonb_build_object('codigo', p.codigo, 'vence_en', p.vence_en)
        from public.pases p
       where p.uid = t.uid and p.origen = 'ticket' and p.codigo is not null
         and p.revocado_en is null and p.vence_en > now()
       order by p.vence_en desc limit 1))
    from public.tarjetas t
   where t.uid = p_c.uid
$$;

revoke all on function public._dni_limpio(text)                         from public, anon, authenticated;
revoke all on function public._nombre_norm(text)                        from public, anon, authenticated;
revoke all on function public._nombre_coincide(text, text)              from public, anon, authenticated;
revoke all on function public._hash(text)                               from public, anon, authenticated;
revoke all on function public._codigo_nuevo()                           from public, anon, authenticated;
revoke all on function public._codigo_limpio(text)                      from public, anon, authenticated;
revoke all on function public._cliente_app(text, text)                  from public, anon, authenticated;
revoke all on function public._cliente_crear(text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public._cargar(text, bigint, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public._pase_de_ticket(text, boolean, uuid)      from public, anon, authenticated;
revoke all on function public._ficha_cliente(public.clientes)           from public, anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- LA APP DEL CLIENTE — rol anon, y encima con el secreto de su celular
-- ═════════════════════════════════════════════════════════════════════════════
-- El cliente no tiene usuario de Supabase. Entra con nombre y DNI, y el celular
-- guarda un secreto al azar que el servidor conoce solo por su hash. Es el
-- mismo trato que el token de la canilla: la anon key sola no abre nada.
--
-- Una cuenta queda atada al primer celular que la abrió. Desde otro celular,
-- nombre y DNI no alcanzan: lo habilita la caja, mirando el documento. Sin eso,
-- saber el DNI de alguien sería tener su saldo.

-- ── Entrar (o registrarse: es el mismo gesto) ───────────────────────────────
create or replace function public.cliente_entrar(
  p_dni text, p_nombre text, p_dispositivo text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_dni    text := public._dni_limpio(p_dni);
  v_nombre text := trim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_c      public.clientes;
  v_nueva  boolean := false;
begin
  if v_dni is null then
    return jsonb_build_object('ok', false, 'motivo', 'dni_invalido');
  end if;
  if length(v_nombre) < 2 then
    return jsonb_build_object('ok', false, 'motivo', 'falta_nombre');
  end if;
  if length(v_nombre) > 60 then
    return jsonb_build_object('ok', false, 'motivo', 'nombre_muy_largo');
  end if;
  if length(coalesce(p_dispositivo, '')) < 32 then
    return jsonb_build_object('ok', false, 'motivo', 'dispositivo_invalido');
  end if;

  select * into v_c from public.clientes
   where dni = v_dni and tipo = 'app' for update;

  if not found then
    begin
      v_c := public._cliente_crear(v_dni, v_nombre, 'app', public._hash(p_dispositivo), null);
      v_nueva := true;
    exception when unique_violation then
      -- Dos toques al botón: el otro pedido la creó primero. Se sigue como si
      -- ya existiera.
      select * into v_c from public.clientes where dni = v_dni and tipo = 'app' for update;
    end;
  end if;

  if not v_nueva then
    if v_c.dispositivo_hash is null then
      -- Sin celular vinculado (la caja lo liberó): acá sí pesa el nombre.
      if not public._nombre_coincide(v_nombre, v_c.nombre) then
        return jsonb_build_object('ok', false, 'motivo', 'nombre_no_coincide');
      end if;
      update public.clientes
         set dispositivo_hash = public._hash(p_dispositivo), dispositivo_en = now()
       where uid = v_c.uid;
    elsif v_c.dispositivo_hash is distinct from public._hash(p_dispositivo) then
      return jsonb_build_object('ok', false, 'motivo', 'otro_dispositivo');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true, 'nueva', v_nueva, 'dni', v_c.dni, 'nombre', v_c.nombre,
    'saldo_centavos', (select saldo_centavos from public.tarjetas where uid = v_c.uid));
end $$;


-- ── Lo que muestra la pantalla principal de la app ──────────────────────────
create or replace function public.cliente_estado(p_dni text, p_dispositivo text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_c public.clientes := public._cliente_app(p_dni, p_dispositivo);
  v_t public.tarjetas;
begin
  if v_c.uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'sesion_invalida');
  end if;

  select * into v_t from public.tarjetas where uid = v_c.uid;

  return jsonb_build_object(
    'ok', true, 'dni', v_c.dni, 'nombre', v_c.nombre,
    'saldo_centavos', v_t.saldo_centavos,
    'bloqueada', v_t.bloqueada,
    'movimientos', coalesce((
      select jsonb_agg(x order by x.creado_en desc)
        from (select m.id, m.tipo, m.centavos, m.medio_pago, m.creado_en,
                     s.ml_servidos, g.nombre as canilla
                from public.movimientos m
                left join public.sesiones s on s.id = m.sesion_id
                left join public.grifos g   on g.id = s.grifo_id
               where m.uid = v_c.uid
               order by m.creado_en desc limit 12) x), '[]'::jsonb),
    'sirviendo', (
      select jsonb_build_object('canilla', g.nombre, 'ml', s.ml_parcial,
                                'ml_maximos', s.ml_maximos)
        from public.sesiones s join public.grifos g on g.id = s.grifo_id
       where s.uid = v_c.uid and s.estado = 'abierta' limit 1));
end $$;


-- ── El QR ───────────────────────────────────────────────────────────────────
-- Vale un minuto y medio. La app pide uno nuevo cada minuto, así que el que
-- está en pantalla siempre tiene aire: una captura de pantalla no le sirve a
-- nadie al rato.
create or replace function public.cliente_generar_pase(p_dni text, p_dispositivo text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_c      public.clientes := public._cliente_app(p_dni, p_dispositivo);
  v_codigo text;
  v_corto  text;
  v_vence  timestamptz := now() + interval '90 seconds';
begin
  if v_c.uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'sesion_invalida');
  end if;
  if (select bloqueada from public.tarjetas where uid = v_c.uid) then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_bloqueada');
  end if;

  -- Limpieza al paso: la tabla no crece con los QR de toda la noche. Los
  -- vencidos sueltan su código corto enseguida y se borran a los diez minutos
  -- (ese rato alcanza para decirle "venció" y no "no existe" al que llega tarde).
  update public.pases set codigo_corto = null
   where origen = 'app' and codigo_corto is not null and vence_en < now();
  delete from public.pases
   where origen = 'app' and vence_en < now() - interval '10 minutes';

  v_codigo := public._codigo_nuevo();

  -- Seis dígitos, únicos entre los que están vivos. Con pocos QR vivos a la
  -- vez, chocar es rarísimo; igual se reintenta.
  for i in 1..8 loop
    v_corto := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.pases (uid, origen, codigo_hash, codigo_corto, vence_en)
      values (v_c.uid, 'app', public._hash(v_codigo), v_corto, v_vence);
      exit;
    exception when unique_violation then
      v_corto := null;
    end;
  end loop;

  if v_corto is null then
    return jsonb_build_object('ok', false, 'motivo', 'reintentar');
  end if;

  return jsonb_build_object(
    'ok', true, 'codigo', 'GRIFO:' || v_codigo, 'codigo_corto', v_corto,
    'vence_en', v_vence, 'segundos', 90,
    'saldo_centavos', (select saldo_centavos from public.tarjetas where uid = v_c.uid));
end $$;


-- ── Salir: desvincula ESTE celular ──────────────────────────────────────────
-- Para pasarse a otro teléfono sin ir a la caja: se sale del viejo y se entra
-- en el nuevo con nombre y DNI.
create or replace function public.cliente_salir(p_dni text, p_dispositivo text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_c public.clientes := public._cliente_app(p_dni, p_dispositivo);
begin
  if v_c.uid is null then
    return jsonb_build_object('ok', true);   -- ya estaba afuera
  end if;
  update public.clientes set dispositivo_hash = null, dispositivo_en = null
   where uid = v_c.uid;
  update public.pases set revocado_en = now()
   where uid = v_c.uid and origen = 'app' and revocado_en is null;
  return jsonb_build_object('ok', true);
end $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- LA TABLET DE LA CANILLA
-- ═════════════════════════════════════════════════════════════════════════════

-- ── tablet_abrir_sesion, con dos arreglos ───────────────────────────────────
-- 1. Comparaba el uid crudo contra el guardado: "a1b2" contra "A1B2" daba
--    "canilla ocupada" para el mismo cliente.
-- 2. Una sesión que nadie atiende trababa la canilla hasta que pasara el
--    barrido de las abandonadas (15 minutos). Si lleva dos minutos abierta sin
--    que el ESP32 reporte ni un mililitro, el ESP32 ya la soltó (él mismo
--    cierra a los 30 s si nadie abre el grifo) o no la vio nunca. Se libera.
--    Queda 'abandonada', que sigue aceptando el cierre tardío de la cola.
create or replace function public.tablet_abrir_sesion(
  p_uid   text,
  p_grifo int,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     text := upper(trim(coalesce(p_uid, '')));
  v_ocupada record;
begin
  select s.id, s.uid, s.abierta_en, s.ml_parcial, s.visto_en, t.nota
    into v_ocupada
    from public.sesiones s
    join public.tarjetas t on t.uid = s.uid
   where s.grifo_id = p_grifo
     and s.estado = 'abierta'
   limit 1;

  if found and v_ocupada.uid is distinct from v_uid then
    if v_ocupada.abierta_en < now() - interval '120 seconds'
       and v_ocupada.visto_en is null and coalesce(v_ocupada.ml_parcial, 0) = 0 then
      -- Solo si quien pide trae el token de la canilla: sin esto, cualquiera
      -- podría soltar sesiones ajenas.
      if exists (select 1 from public.grifos
                  where id = p_grifo and token_hash = public._hash(p_token)) then
        update public.sesiones set estado = 'abandonada' where id = v_ocupada.id;
      else
        return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
      end if;
    else
      return jsonb_build_object(
        'ok', false, 'motivo', 'canilla_ocupada',
        'cliente', split_part(coalesce(v_ocupada.nota, ''), ' ', 1));
    end if;
  end if;

  return public.abrir_sesion(v_uid, p_grifo, p_token);
end $$;

-- Ya no la llama la pantalla: entra por el QR. Se le saca a los de afuera para
-- que el token de una canilla más el uid de una billetera no alcancen para
-- abrirle una sesión a nadie.
revoke all on function public.tablet_abrir_sesion(text, int, text)
  from public, anon, authenticated;


-- ── Lo que llama la pantalla cuando la cámara lee un QR ─────────────────────
create or replace function public.tablet_abrir_sesion_qr(
  p_codigo text,
  p_grifo  int,
  p_token  text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g      public.grifos%rowtype;
  v_codigo text := public._codigo_limpio(p_codigo);
  v_p      public.pases;
  v_r      jsonb;
begin
  -- Primero el token. Sin el de la canilla no se puede ni preguntar si un
  -- código existe: nadie prueba códigos al voleo desde su casa.
  select * into v_g from public.grifos where id = p_grifo;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'grifo_desconocido');
  end if;
  if v_g.token_hash is null or v_g.token_hash is distinct from public._hash(p_token) then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;

  if v_codigo is null then
    return jsonb_build_object('ok', false, 'motivo', 'qr_desconocido');
  end if;

  select * into v_p from public.pases where codigo_hash = public._hash(v_codigo);
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'qr_desconocido');
  end if;
  if v_p.revocado_en is not null then
    return jsonb_build_object('ok', false, 'motivo', 'qr_anulado', 'origen', v_p.origen);
  end if;
  if v_p.vence_en <= now() then
    return jsonb_build_object('ok', false, 'motivo', 'qr_vencido', 'origen', v_p.origen);
  end if;

  -- La canilla tiene que estar viva. Si el ESP32 no late hace dos minutos, la
  -- sesión quedaría abierta sin que nadie abra la válvula: el cliente esperando
  -- frente a un grifo que no va a dar nada, y la canilla trabada para el resto.
  if v_g.ultimo_latido is null or v_g.ultimo_latido < now() - interval '120 seconds' then
    return jsonb_build_object('ok', false, 'motivo', 'canilla_sin_conexion');
  end if;

  v_r := public.tablet_abrir_sesion(v_p.uid, p_grifo, p_token);

  if coalesce((v_r->>'ok')::boolean, false) then
    update public.pases set usado_en = coalesce(usado_en, now()) where id = v_p.id;
  end if;

  return v_r || jsonb_build_object('origen', v_p.origen);
end $$;

revoke all on function public.tablet_abrir_sesion_qr(text, int, text)
  from public, anon, authenticated;
-- A los dos: la pantalla puede correr en un navegador donde alguien inició
-- sesión en la gestión, y ahí Supabase la trata como `authenticated`.
grant execute on function public.tablet_abrir_sesion_qr(text, int, text)
  to anon, authenticated;


-- ── pantalla_estado: nombre, canilla viva y podio por jornada ───────────────
-- Tres cambios sobre la versión de 10-pantallas.sql:
--   · `grifo.en_linea`: la pantalla deja de invitar a servir en una canilla
--     cuyo ESP32 está apagado.
--   · `sesion.nombre` y el podio muestran el primer nombre. El uid de una
--     billetera ya no está impreso en ningún plástico: sus últimos cuatro
--     caracteres no le dicen nada a nadie.
--   · El podio cuenta desde las 6:00 de Argentina, no desde las 0:00 UTC.
create or replace function public.pantalla_estado(p_grifo int, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g       public.grifos%rowtype;
  v_s       public.sesiones%rowtype;
  v_t       public.tarjetas%rowtype;
  v_ult     public.sesiones%rowtype;
  v_uid_cli text;
  v_veces   int;
  v_ml_tot  bigint;
begin
  select * into v_g from public.grifos where id = p_grifo;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'grifo_desconocido');
  end if;

  if v_g.token_hash is null
     or v_g.token_hash is distinct from public._hash(p_token) then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;

  select * into v_s from public.sesiones
   where grifo_id = p_grifo and estado = 'abierta'
   order by abierta_en desc limit 1;

  if found then
    select * into v_t from public.tarjetas where uid = v_s.uid;
  else
    -- Sin sesión abierta mostramos el ticket de la última tirada por un rato,
    -- así el cliente alcanza a ver cuánto sirvió y cuánto le quedó.
    select * into v_ult from public.sesiones
     where grifo_id = p_grifo and estado = 'cerrada'
       and cerrada_en > now() - interval '25 seconds'
     order by cerrada_en desc limit 1;
  end if;

  v_uid_cli := coalesce(v_s.uid, v_ult.uid);
  if v_uid_cli is not null then
    select count(*), coalesce(sum(ml_servidos), 0)
      into v_veces, v_ml_tot
      from public.sesiones
     where uid = v_uid_cli and estado = 'cerrada';
  end if;

  return jsonb_build_object(
    'ok', true,
    'ahora', now(),
    'grifo', jsonb_build_object(
      'id',      v_g.id,
      'nombre',  v_g.nombre,
      'estilo',  v_g.estilo,
      'descripcion', v_g.descripcion,
      'abv',     v_g.abv,
      'ibu',     v_g.ibu,
      'color',   coalesce(v_g.color, '#c8811f'),
      'imagen_url', v_g.imagen_url,
      'precio_litro_centavos', v_g.precio_litro_centavos,
      'ml_vaso', v_g.ml_vaso,
      'activo',  v_g.activo,
      'listo',   v_g.activo and v_g.token_hash is not null,
      'en_linea', v_g.ultimo_latido is not null
                  and v_g.ultimo_latido > now() - interval '120 seconds'
    ),

    'cliente', case when v_uid_cli is null then null else jsonb_build_object(
      'veces',      v_veces,
      'ml_total',   v_ml_tot,
      'es_primera', v_veces = 0
    ) end,

    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tarjeta', coalesce(nullif(split_part(trim(t.nota), ' ', 1), ''),
                                   '····' || right(r.uid, 4)),
               'ml',      r.ml,
               'veces',   r.veces
             ) order by r.ml desc)
        from (
          select uid, sum(ml_servidos)::int as ml, count(*)::int as veces
            from public.sesiones
           where grifo_id = p_grifo and estado = 'cerrada'
             and cerrada_en >= public.inicio_jornada(now())
           group by uid
           order by sum(ml_servidos) desc
           limit 3
        ) r
        left join public.tarjetas t on t.uid = r.uid
    ), '[]'::jsonb),
    'sesion', case when v_s.id is null then null else jsonb_build_object(
      'id',             v_s.id,
      'tarjeta',        '····' || right(v_s.uid, 4),
      -- Solo el primer nombre: la pantalla está a la vista de todo el bar.
      'nombre',         nullif(split_part(trim(coalesce(v_t.nota, '')), ' ', 1), ''),
      'saldo_centavos', coalesce(v_t.saldo_centavos, v_s.saldo_inicial_centavos),
      'ml_maximos',     v_s.ml_maximos,
      'ml_parcial',     v_s.ml_parcial,
      'abierta_en',     v_s.abierta_en,
      'visto_en',       v_s.visto_en
    ) end,
    'ultima', case when v_ult.id is null then null else jsonb_build_object(
      'ml_servidos',    v_ult.ml_servidos,
      'costo_centavos', v_ult.costo_centavos,
      'saldo_final_centavos', v_ult.saldo_final_centavos,
      'tarjeta',        '····' || right(v_ult.uid, 4),
      'cerrada_en',     v_ult.cerrada_en
    ) end
  );
end;
$$;

revoke all on function public.pantalla_estado(int, text) from public, anon, authenticated;
grant execute on function public.pantalla_estado(int, text) to anon, authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- LA CAJA — personal logueado
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Buscar por DNI: la cuenta de ticket ─────────────────────────────────────
create or replace function public.caja_buscar_cliente(p_dni text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_dni text := public._dni_limpio(p_dni);
  v_c   public.clientes;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if v_dni is null then
    return jsonb_build_object('ok', false, 'motivo', 'dni_invalido');
  end if;

  select * into v_c from public.clientes where dni = v_dni and tipo = 'ticket';
  if not found then
    -- No es un error: es alguien que viene por primera vez.
    return jsonb_build_object('ok', true, 'existe', false, 'dni', v_dni,
      'tiene_app', exists (select 1 from public.clientes where dni = v_dni and tipo = 'app'));
  end if;

  return public._ficha_cliente(v_c) || jsonb_build_object(
    'tiene_app', exists (select 1 from public.clientes where dni = v_dni and tipo = 'app'));
end $$;


-- ── Buscar por el código de la app ──────────────────────────────────────────
-- El cliente tiene la app y quiere pagar en efectivo. Le dicta al cajero los
-- seis dígitos que ve debajo de su QR: eso prueba que el celular es suyo, y la
-- plata va a la cuenta de ese celular y a ninguna otra.
create or replace function public.caja_buscar_por_codigo(p_codigo text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_corto text := regexp_replace(coalesce(p_codigo, ''), '[^0-9]', '', 'g');
  v_c     public.clientes;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if length(v_corto) <> 6 then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_invalido');
  end if;

  select c.* into v_c
    from public.pases p join public.clientes c on c.uid = p.uid
   where p.codigo_corto = v_corto and p.origen = 'app'
     and p.revocado_en is null and p.vence_en > now();
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_vencido');
  end if;

  return public._ficha_cliente(v_c);
end $$;


-- ── Vender: alta + carga + ticket, en un solo paso ──────────────────────────
-- Es lo que pasa en el mostrador con alguien que no tiene celular: da el DNI y
-- el nombre, paga, y se lleva el ticket con su QR.
--
-- Todo en una transacción: no puede quedar la plata cobrada y el QR sin emitir.
--
-- `p_clave` la genera la pantalla una vez por venta. Si el cajero aprieta dos
-- veces, o la red se corta y reintenta, la segunda llamada devuelve el mismo
-- resultado sin cargar de nuevo.
create or replace function public.caja_vender(
  p_dni text, p_nombre text, p_centavos bigint, p_medio text, p_clave text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_dni    text := public._dni_limpio(p_dni);
  v_nombre text := trim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_yo     uuid := (select auth.uid());
  v_c      public.clientes;
  v_carga  jsonb;
  v_p      public.pases;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if v_dni is null then
    return jsonb_build_object('ok', false, 'motivo', 'dni_invalido');
  end if;
  if p_centavos is null or p_centavos <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'monto_invalido');
  end if;
  if p_medio is null or p_medio not in ('efectivo', 'debito', 'credito', 'transferencia', 'mercadopago') then
    return jsonb_build_object('ok', false, 'motivo', 'medio_invalido');
  end if;
  if coalesce(trim(p_clave), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'falta_clave');
  end if;

  select * into v_c from public.clientes
   where dni = v_dni and tipo = 'ticket' for update;

  if not found then
    if length(v_nombre) < 2 then
      return jsonb_build_object('ok', false, 'motivo', 'falta_nombre');
    end if;
    if length(v_nombre) > 60 then
      return jsonb_build_object('ok', false, 'motivo', 'nombre_muy_largo');
    end if;
    begin
      v_c := public._cliente_crear(v_dni, v_nombre, 'ticket', null, v_yo);
    exception when unique_violation then
      select * into v_c from public.clientes where dni = v_dni and tipo = 'ticket' for update;
    end;
  elsif length(v_nombre) >= 2 and v_nombre is distinct from v_c.nombre then
    -- El cajero corrigió el nombre: vale el que tiene el documento adelante.
    if length(v_nombre) > 60 then
      return jsonb_build_object('ok', false, 'motivo', 'nombre_muy_largo');
    end if;
    update public.clientes set nombre = v_nombre where uid = v_c.uid;
    update public.tarjetas set nota = v_nombre where uid = v_c.uid;
    v_c.nombre := v_nombre;
  end if;

  if (select bloqueada from public.tarjetas where uid = v_c.uid) then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_bloqueada');
  end if;

  v_carga := public._cargar(v_c.uid, p_centavos, 'caja', 'venta:' || trim(p_clave), p_medio, v_yo);
  if not coalesce((v_carga->>'ok')::boolean, false) then
    return v_carga;
  end if;

  v_p := public._pase_de_ticket(v_c.uid, false, v_yo);

  return jsonb_build_object(
    'ok', true,
    'repetida', coalesce((v_carga->>'repetida')::boolean, false),
    'uid', v_c.uid, 'dni', v_c.dni, 'nombre', v_c.nombre,
    'cargado_centavos', p_centavos, 'medio', p_medio,
    'saldo_centavos', (select saldo_centavos from public.tarjetas where uid = v_c.uid),
    'movimiento_id', (v_carga->>'movimiento_id')::bigint,
    'pase', jsonb_build_object('codigo', 'GRIFO:' || v_p.codigo, 'vence_en', v_p.vence_en));
end $$;


-- ── Cargar a una cuenta que ya está en pantalla ─────────────────────────────
-- Para la cuenta de app (encontrada por su código) y para recargar un ticket.
-- No emite pase: la app tiene el suyo, y el ticket se pide aparte.
create or replace function public.caja_cargar(
  p_uid text, p_centavos bigint, p_medio text, p_clave text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid text := upper(trim(coalesce(p_uid, '')));
  v_r   jsonb;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if p_centavos is null or p_centavos <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'monto_invalido');
  end if;
  if p_medio is null or p_medio not in ('efectivo', 'debito', 'credito', 'transferencia', 'mercadopago') then
    return jsonb_build_object('ok', false, 'motivo', 'medio_invalido');
  end if;
  if coalesce(trim(p_clave), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'falta_clave');
  end if;
  -- Acá no se dan de alta billeteras: esa puerta es `caja_vender`.
  if not exists (select 1 from public.tarjetas where uid = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_desconocida');
  end if;
  if (select bloqueada from public.tarjetas where uid = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_bloqueada');
  end if;

  v_r := public._cargar(v_uid, p_centavos, 'caja', 'venta:' || trim(p_clave), p_medio,
                        (select auth.uid()));
  if coalesce((v_r->>'ok')::boolean, false) then
    v_r := v_r || jsonb_build_object('cargado_centavos', p_centavos, 'medio', p_medio);
  end if;
  return v_r;
end $$;


-- ── El ticket de esta noche: reimprimir o anular y dar uno nuevo ────────────
create or replace function public.caja_emitir_pase(p_dni text, p_renovar boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_dni text := public._dni_limpio(p_dni);
  v_c   public.clientes;
  v_p   public.pases;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  select * into v_c from public.clientes
   where dni = v_dni and tipo = 'ticket' for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'cliente_desconocido');
  end if;
  if (select bloqueada from public.tarjetas where uid = v_c.uid) then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_bloqueada');
  end if;

  v_p := public._pase_de_ticket(v_c.uid, coalesce(p_renovar, false), (select auth.uid()));

  return jsonb_build_object(
    'ok', true, 'uid', v_c.uid, 'dni', v_c.dni, 'nombre', v_c.nombre,
    'saldo_centavos', (select saldo_centavos from public.tarjetas where uid = v_c.uid),
    'pase', jsonb_build_object('codigo', 'GRIFO:' || v_p.codigo, 'vence_en', v_p.vence_en));
end $$;


-- ── Habilitar un celular nuevo ──────────────────────────────────────────────
-- El cliente cambió de teléfono o borró los datos del navegador. El cajero mira
-- el DNI y suelta el vínculo: el próximo que entre con ese nombre y DNI queda
-- como dueño. Los QR que tuviera el celular viejo dejan de valer.
create or replace function public.caja_habilitar_celular(p_dni text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_dni text := public._dni_limpio(p_dni);
  v_c   public.clientes;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  select * into v_c from public.clientes where dni = v_dni and tipo = 'app' for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'cliente_desconocido');
  end if;

  update public.clientes set dispositivo_hash = null, dispositivo_en = null
   where uid = v_c.uid;
  update public.pases set revocado_en = now()
   where uid = v_c.uid and origen = 'app' and revocado_en is null;

  return jsonb_build_object('ok', true, 'dni', v_c.dni, 'nombre', v_c.nombre);
end $$;


-- ── Devolver el saldo ───────────────────────────────────────────────────────
-- La de 14-devoluciones.sql borraba el nombre: la tarjeta de plástico volvía a
-- la pila. Una billetera de cliente no vuelve a ninguna pila: conserva el
-- nombre, y lo que se anula es el ticket que anda dando vueltas.
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
  v_cliente  boolean;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  v_uid := upper(trim(coalesce(p_uid, '')));
  if v_uid = '' then
    return jsonb_build_object('ok', false, 'motivo', 'uid_invalido');
  end if;

  perform 1 from public.tarjetas where uid = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_desconocida');
  end if;

  select id into v_abierta
    from public.sesiones
   where uid = v_uid and estado = 'abierta'
   limit 1;
  if v_abierta is not null then
    return jsonb_build_object('ok', false, 'motivo', 'sesion_abierta',
      'detalle', 'Está sirviendo en una canilla. Esperá a que termine.',
      'sesion_id', v_abierta);
  end if;

  select saldo_centavos, nota into v_saldo, v_nota
    from public.tarjetas where uid = v_uid;
  v_cliente := exists (select 1 from public.clientes where uid = v_uid);

  -- El ticket deja de valer: se le devolvió la plata, no puede seguir abriendo
  -- canillas con el papel.
  update public.pases set revocado_en = now()
   where uid = v_uid and origen = 'ticket' and revocado_en is null;

  if v_saldo = 0 then
    if not v_cliente then
      update public.tarjetas set nota = null, actualizada_en = now() where uid = v_uid;
    end if;
    return jsonb_build_object('ok', true, 'uid', v_uid, 'devuelto_centavos', 0,
                              'saldo_centavos', 0, 'nada_que_devolver', true);
  end if;

  update public.tarjetas
     set saldo_centavos = 0,
         nota           = case when v_cliente then nota else null end,
         actualizada_en = now()
   where uid = v_uid;

  insert into public.movimientos (uid, tipo, centavos, saldo_resultante,
                                  referencia, motivo, hecho_por, medio_pago)
  values (v_uid, 'devolucion', -v_saldo, 0,
          coalesce(nullif(trim(v_nota), ''), 'devolución'),
          nullif(trim(coalesce(p_motivo, '')), ''), (select auth.uid()), 'efectivo')
  returning id into v_mov;

  return jsonb_build_object('ok', true, 'uid', v_uid,
                            'devuelto_centavos', v_saldo,
                            'saldo_centavos', 0,
                            'cliente', v_nota,
                            'movimiento_id', v_mov);
end;
$$;


-- ── El padrón, para el admin ────────────────────────────────────────────────
create or replace function public.admin_listar_cuentas(
  p_buscar text default null, p_filtro text default 'todas'
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_b text := nullif(trim(coalesce(p_buscar, '')), '');
begin
  if not public.es_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  return jsonb_build_object('ok', true,
    -- Sobre TODAS las billeteras, no sobre la página que se muestra: el saldo
    -- en circulación es una deuda del bar y no puede depender del filtro.
    'total_centavos', (select coalesce(sum(saldo_centavos), 0) from public.tarjetas),
    'con_saldo',      (select count(*) from public.tarjetas where saldo_centavos > 0),
    'bloqueadas',     (select count(*) from public.tarjetas where bloqueada),
    'cuentas', coalesce((
      select jsonb_agg(x order by x.actualizada_en desc)
        from (
          select t.uid, c.dni, coalesce(c.nombre, t.nota) as nombre,
                 coalesce(c.tipo, 'tarjeta') as tipo,
                 t.saldo_centavos, t.bloqueada, t.bloqueada_motivo, t.actualizada_en,
                 c.dispositivo_hash is not null as celular_vinculado
            from public.tarjetas t
            left join public.clientes c on c.uid = t.uid
           where (v_b is null
                  or c.dni like '%' || regexp_replace(v_b, '[^0-9]', '', 'g') || '%'
                     and regexp_replace(v_b, '[^0-9]', '', 'g') <> ''
                  or public._nombre_norm(coalesce(c.nombre, t.nota))
                     like '%' || public._nombre_norm(v_b) || '%'
                     and public._nombre_norm(v_b) <> ''
                  or t.uid like '%' || upper(v_b) || '%')
             and (p_filtro is distinct from 'con-saldo'  or t.saldo_centavos > 0)
             and (p_filtro is distinct from 'bloqueadas' or t.bloqueada)
           order by t.actualizada_en desc
           limit 500) x), '[]'::jsonb));
end $$;


-- ── Cierre de caja: por medio de pago y con la hora de acá ──────────────────
-- Dos cambios sobre el de 14-devoluciones.sql:
--   · El período por defecto arranca a las 6:00 de Argentina (antes, de UTC).
--   · "Tiene que haber en el cajón" cuenta solo el EFECTIVO. Lo que entró por
--     débito, transferencia o Mercado Pago está en el banco, y sumarlo hacía
--     que el cajón "faltara" todas las noches.
create or replace function public.arqueo(
  p_desde timestamptz default null,
  p_hasta timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_desde  timestamptz;
  v_hasta  timestamptz;
  v_mov    jsonb;
  v_medios jsonb;
  v_efvo   bigint;
  v_con    jsonb;
  v_gente  jsonb;
  v_res    jsonb;
  v_circ   bigint;
  v_colg   int;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  v_desde := coalesce(p_desde, public.inicio_jornada(now()));
  v_hasta := coalesce(p_hasta, now());

  if v_hasta <= v_desde then
    return jsonb_build_object('ok', false, 'motivo', 'rango_invalido');
  end if;

  select coalesce(jsonb_object_agg(tipo, fila), '{}'::jsonb) into v_mov
    from (
      select tipo,
             jsonb_build_object('cantidad', count(*), 'centavos', sum(centavos)) as fila
        from public.movimientos
       where creado_en >= v_desde and creado_en < v_hasta
       group by tipo
    ) t;

  -- Las cargas, separadas por cómo se pagaron. Una carga vieja sin medio era
  -- efectivo: no había otra cosa.
  select coalesce(jsonb_object_agg(medio, fila), '{}'::jsonb),
         coalesce(sum(centavos) filter (where medio = 'efectivo'), 0)
    into v_medios, v_efvo
    from (
      select coalesce(medio_pago, 'efectivo') as medio,
             sum(centavos) as centavos,
             jsonb_build_object('cantidad', count(*), 'centavos', sum(centavos)) as fila
        from public.movimientos
       where creado_en >= v_desde and creado_en < v_hasta and tipo = 'carga'
       group by coalesce(medio_pago, 'efectivo')
    ) t;

  select jsonb_build_object(
           'sesiones', count(*),
           'ml',       coalesce(sum(ml_servidos), 0),
           'centavos', coalesce(sum(costo_centavos), 0),
           'costo_centavos', coalesce(sum(costo_producto_centavos), 0))
    into v_con
    from public.sesiones
   where estado = 'cerrada' and cerrada_en >= v_desde and cerrada_en < v_hasta;

  select coalesce(jsonb_agg(f order by f->>'nombre'), '[]'::jsonb) into v_gente
    from (
      select jsonb_build_object(
               'nombre',      coalesce(pe.nombre, case when m.hecho_por is null
                                                        then 'App (Mercado Pago)'
                                                        else 'sin identificar' end),
               'cargas',      coalesce(sum(m.centavos) filter (where m.tipo = 'carga'), 0),
               'efectivo',    coalesce(sum(m.centavos) filter (where m.tipo = 'carga'
                                and coalesce(m.medio_pago, 'efectivo') = 'efectivo'), 0),
               'devoluciones',coalesce(-sum(m.centavos) filter (where m.tipo = 'devolucion'), 0),
               'ajustes',     coalesce(sum(m.centavos) filter (where m.tipo = 'ajuste'), 0),
               'operaciones', count(*)) as f
        from public.movimientos m
        left join public.personal pe on pe.user_id = m.hecho_por
       where m.creado_en >= v_desde and m.creado_en < v_hasta
         and m.tipo in ('carga', 'devolucion', 'ajuste')
       group by coalesce(pe.nombre, case when m.hecho_por is null
                                         then 'App (Mercado Pago)'
                                         else 'sin identificar' end)
    ) t;

  select coalesce(sum(saldo_centavos), 0) into v_circ from public.tarjetas;
  select count(*) into v_colg from public.sesiones where estado = 'abierta';

  v_res := jsonb_build_object(
    'ok', true,
    'es_admin', public.es_admin(),
    'desde', v_desde, 'hasta', v_hasta,
    'cargas_centavos',       coalesce((v_mov->'carga'->>'centavos')::bigint, 0),
    'cargas_cantidad',       coalesce((v_mov->'carga'->>'cantidad')::int, 0),
    'cargas_por_medio',      v_medios,
    'efectivo_centavos',     v_efvo,
    'devoluciones_centavos', coalesce(-(v_mov->'devolucion'->>'centavos')::bigint, 0),
    'devoluciones_cantidad', coalesce((v_mov->'devolucion'->>'cantidad')::int, 0),
    'ajustes_centavos',      coalesce((v_mov->'ajuste'->>'centavos')::bigint, 0),
    'ajustes_cantidad',      coalesce((v_mov->'ajuste'->>'cantidad')::int, 0),
    -- Lo que tiene que haber en el cajón: el efectivo que entró menos lo que
    -- se devolvió (las devoluciones salen siempre en efectivo).
    'neto_caja_centavos',    v_efvo
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


-- ═════════════════════════════════════════════════════════════════════════════
-- PERMISOS
-- ═════════════════════════════════════════════════════════════════════════════
revoke all on function public.cliente_entrar(text, text, text)        from public, anon, authenticated;
revoke all on function public.cliente_estado(text, text)              from public, anon, authenticated;
revoke all on function public.cliente_generar_pase(text, text)        from public, anon, authenticated;
revoke all on function public.cliente_salir(text, text)               from public, anon, authenticated;
revoke all on function public.caja_buscar_cliente(text)               from public, anon, authenticated;
revoke all on function public.caja_buscar_por_codigo(text)            from public, anon, authenticated;
revoke all on function public.caja_vender(text, text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.caja_cargar(text, bigint, text, text)   from public, anon, authenticated;
revoke all on function public.caja_emitir_pase(text, boolean)         from public, anon, authenticated;
revoke all on function public.caja_habilitar_celular(text)            from public, anon, authenticated;
revoke all on function public.caja_devolver_tarjeta(text, text)       from public, anon, authenticated;
revoke all on function public.admin_listar_cuentas(text, text)        from public, anon, authenticated;
revoke all on function public.arqueo(timestamptz, timestamptz)        from public, anon, authenticated;

-- La app del cliente. A los dos roles por lo mismo que la pantalla: el celular
-- de un mozo puede tener abierta la gestión en el mismo navegador.
grant execute on function public.cliente_entrar(text, text, text)     to anon, authenticated;
grant execute on function public.cliente_estado(text, text)           to anon, authenticated;
grant execute on function public.cliente_generar_pase(text, text)     to anon, authenticated;
grant execute on function public.cliente_salir(text, text)            to anon, authenticated;

-- La caja y el admin: cualquier logueado puede intentar, la función decide.
grant execute on function public.caja_buscar_cliente(text)            to authenticated;
grant execute on function public.caja_buscar_por_codigo(text)         to authenticated;
grant execute on function public.caja_vender(text, text, bigint, text, text) to authenticated;
grant execute on function public.caja_cargar(text, bigint, text, text) to authenticated;
grant execute on function public.caja_emitir_pase(text, boolean)      to authenticated;
grant execute on function public.caja_habilitar_celular(text)         to authenticated;
grant execute on function public.caja_devolver_tarjeta(text, text)    to authenticated;
grant execute on function public.admin_listar_cuentas(text, text)     to authenticated;
grant execute on function public.arqueo(timestamptz, timestamptz)     to authenticated;

do $$ begin raise notice '✅ 29-qr.sql aplicado'; end $$;
