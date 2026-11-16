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
grant execute on function public.inicio_jornada(timestamptz) to service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- TABLAS
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Clientes ────────────────────────────────────────────────────────────────
-- La identidad. El saldo sigue viviendo en `tarjetas` (que ahora es una
-- billetera sin plástico): acá va de quién es.
create table if not exists public.clientes_qr (
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

comment on table public.clientes_qr is
  'De quién es cada billetera. Una por DNI y por tipo: la de app y la de ticket no se mezclan.';

alter table public.clientes_qr enable row level security;
revoke all on table public.clientes_qr from anon, authenticated;
grant all on table public.clientes_qr to service_role;
grant select on table public.clientes_qr to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'clientes_qr' and policyname = 'admin_lee_clientes_qr') then
    create policy admin_lee_clientes_qr on public.clientes_qr
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
returns public.clientes_qr
language sql stable security definer set search_path = ''
as $$
  select c.*
    from public.clientes_qr c
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
returns public.clientes_qr
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid text;
  v_c   public.clientes_qr;
begin
  v_uid := 'QR' || substr(public._codigo_nuevo(), 1, 14);

  insert into public.tarjetas (uid, saldo_centavos, nota, asignada_en, asignada_por)
  values (v_uid, 0, p_nombre, now(), p_por);

  insert into public.clientes_qr (uid, dni, nombre, tipo, dispositivo_hash, dispositivo_en, creado_por)
  values (v_uid, p_dni, p_nombre, p_tipo, p_dispositivo_hash,
          case when p_dispositivo_hash is not null then now() end, p_por)
  returning * into v_c;

  return v_c;
end $$;

-- Carga plata y deja asentado con qué se pagó y quién la cargó. Es la única
-- puerta por la que entra saldo desde ahora: caja y Mercado Pago pasan por acá.
-- Cómo se pagó una carga, también las que hizo el POS por su cuenta: esas no
-- llenan `medio_pago`, pero dejan el medio en la referencia ('caja:debito') o
-- en la clave ('mp:…' es Mercado Pago desde su app). Sin nada de eso es una
-- carga vieja, y antes todo era efectivo.
create or replace function public._medio_carga(p_medio text, p_ref text, p_clave text)
returns text language sql immutable set search_path = ''
as $$
  select case
    when p_medio is not null then p_medio
    when p_ref like 'caja:%' then
      case substr(p_ref, 6) when 'qr_mp' then 'mercadopago' else substr(p_ref, 6) end
    when p_clave like 'mp:%' then 'mercadopago'
    else 'efectivo'
  end
$$;

create or replace function public._cargar(
  p_uid text, p_centavos bigint, p_referencia text, p_clave text, p_medio text, p_por uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v jsonb;
begin
  -- ── Con SEN POS: la plata del mostrador entra al turno de caja ────────────
  -- El POS lleva el arqueo de cada turno (ciego: el cajero cuenta sin saber
  -- cuánto debería haber). Una carga cobrada en el mostrador que no pase por
  -- el turno abierto sería plata en el cajón que el POS no espera, y el arqueo
  -- daría sobrante. Por eso, si el POS está instalado, la carga se hace con su
  -- función, que la asienta en el turno, y sin turno abierto no se cobra.
  --
  -- `p_por` nulo es una carga que no pasa por el mostrador (Mercado Pago desde
  -- la app): esa no toca el cajón.
  if p_por is not null
     and to_regprocedure('public.pos_cargar_billetera(text,bigint,text,text)') is not null then
    v := public.pos_cargar_billetera(
           p_uid, p_centavos,
           case p_medio when 'mercadopago' then 'qr_mp' else p_medio end,
           p_clave);
  else
    v := public.cargar_saldo(p_uid, p_centavos, p_referencia, p_clave);
  end if;

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
create or replace function public._ficha_cliente(p_c public.clientes_qr)
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
revoke all on function public._ficha_cliente(public.clientes_qr)           from public, anon, authenticated;


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
  v_c      public.clientes_qr;
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

  select * into v_c from public.clientes_qr
   where dni = v_dni and tipo = 'app' for update;

  if not found then
    begin
      v_c := public._cliente_crear(v_dni, v_nombre, 'app', public._hash(p_dispositivo), null);
      v_nueva := true;
    exception when unique_violation then
      -- Dos toques al botón: el otro pedido la creó primero. Se sigue como si
      -- ya existiera.
      select * into v_c from public.clientes_qr where dni = v_dni and tipo = 'app' for update;
    end;
  end if;

  if not v_nueva then
    if v_c.dispositivo_hash is null then
      -- Sin celular vinculado (la caja lo liberó): acá sí pesa el nombre.
      if not public._nombre_coincide(v_nombre, v_c.nombre) then
        return jsonb_build_object('ok', false, 'motivo', 'nombre_no_coincide');
      end if;
      update public.clientes_qr
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
  v_c public.clientes_qr := public._cliente_app(p_dni, p_dispositivo);
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
  v_c      public.clientes_qr := public._cliente_app(p_dni, p_dispositivo);
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
declare v_c public.clientes_qr := public._cliente_app(p_dni, p_dispositivo);
begin
  if v_c.uid is null then
    -- Ya estaba afuera, o no es su celular. Para la app es lo mismo (sale
    -- igual); para quien prueba DNIs al azar no confirma nada.
    return jsonb_build_object('ok', false, 'motivo', 'sesion_invalida');
  end if;
  update public.clientes_qr set dispositivo_hash = null, dispositivo_en = null
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
  v_c   public.clientes_qr;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if v_dni is null then
    return jsonb_build_object('ok', false, 'motivo', 'dni_invalido');
  end if;

  select * into v_c from public.clientes_qr where dni = v_dni and tipo = 'ticket';
  if not found then
    -- No es un error: es alguien que viene por primera vez.
    return jsonb_build_object('ok', true, 'existe', false, 'dni', v_dni,
      'tiene_app', exists (select 1 from public.clientes_qr where dni = v_dni and tipo = 'app'));
  end if;

  return public._ficha_cliente(v_c) || jsonb_build_object(
    'tiene_app', exists (select 1 from public.clientes_qr where dni = v_dni and tipo = 'app'));
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
  v_c     public.clientes_qr;
  v_uid   text;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if length(v_corto) <> 6 then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_invalido');
  end if;

  select p.uid into v_uid
    from public.pases p
   where p.codigo_corto = v_corto and p.origen = 'app'
     and p.revocado_en is null and p.vence_en > now();
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_vencido');
  end if;

  select * into v_c from public.clientes_qr where uid = v_uid;
  if not found then
    -- Una billetera de la app de SEN POS: no tiene DNI, tiene usuario. Se
    -- arma la ficha con lo que hay (el nombre está en la tarjeta).
    v_c.uid    := v_uid;
    v_c.tipo   := 'app';
    v_c.nombre := coalesce((select nota from public.tarjetas where uid = v_uid), 'Cliente de la app');
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
  v_c      public.clientes_qr;
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

  select * into v_c from public.clientes_qr
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
      select * into v_c from public.clientes_qr where dni = v_dni and tipo = 'ticket' for update;
    end;
  elsif length(v_nombre) >= 2 and v_nombre is distinct from v_c.nombre then
    -- El cajero corrigió el nombre: vale el que tiene el documento adelante.
    if length(v_nombre) > 60 then
      return jsonb_build_object('ok', false, 'motivo', 'nombre_muy_largo');
    end if;
    update public.clientes_qr set nombre = v_nombre where uid = v_c.uid;
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
  v_c   public.clientes_qr;
  v_p   public.pases;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  select * into v_c from public.clientes_qr
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
  v_c   public.clientes_qr;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  select * into v_c from public.clientes_qr where dni = v_dni and tipo = 'app' for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'cliente_desconocido');
  end if;

  update public.clientes_qr set dispositivo_hash = null, dispositivo_en = null
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
  v_turno    bigint;
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
  v_cliente := exists (select 1 from public.clientes_qr where uid = v_uid);

  -- Con SEN POS, la plata que se devuelve sale del cajón del turno abierto: se
  -- asienta como egreso, o el arqueo del POS daría faltante. Sin turno no se
  -- devuelve. Se pregunta ANTES de tocar nada.
  if v_saldo > 0 and to_regprocedure('public._pos_turno_para_asentar()') is not null then
    v_turno := public._pos_turno_para_asentar();
    if v_turno is null then
      return jsonb_build_object('ok', false, 'motivo', 'sin_turno_abierto');
    end if;
  end if;

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

  if v_turno is not null then
    -- Dinámico: sin el POS, la tabla no existe y esta función igual tiene que
    -- poder crearse y correr.
    execute 'insert into public.caja_movimientos (turno_id, tipo, medio, centavos, concepto, referencia, hecho_por)
             values ($1, ''egreso'', ''efectivo'', $2, $3, $4, $5)'
      using v_turno, v_saldo,
            'Devolución de saldo' || coalesce(' a ' || nullif(trim(v_nota), ''), ''),
            'movimiento:' || v_mov, (select auth.uid());
  end if;

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
            left join public.clientes_qr c on c.uid = t.uid
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
  v_efvo   numeric;
  v_con    jsonb;
  v_gente  jsonb;
  v_res    jsonb;
  v_circ   numeric;
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
      select public._medio_carga(medio_pago, referencia, clave_idempotencia) as medio,
             sum(centavos) as centavos,
             jsonb_build_object('cantidad', count(*), 'centavos', sum(centavos)) as fila
        from public.movimientos
       where creado_en >= v_desde and creado_en < v_hasta and tipo = 'carga'
       group by public._medio_carga(medio_pago, referencia, clave_idempotencia)
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
               'nombre',      coalesce(pe.nombre, case when public._medio_carga(m.medio_pago, m.referencia, m.clave_idempotencia) = 'mercadopago'
                                                        then 'App (Mercado Pago)'
                                                        else 'sin identificar' end),
               'cargas',      coalesce(sum(m.centavos) filter (where m.tipo = 'carga'), 0),
               'efectivo',    coalesce(sum(m.centavos) filter (where m.tipo = 'carga'
                                and public._medio_carga(m.medio_pago, m.referencia, m.clave_idempotencia) = 'efectivo'), 0),
               'devoluciones',coalesce(-sum(m.centavos) filter (where m.tipo = 'devolucion'), 0),
               'ajustes',     coalesce(sum(m.centavos) filter (where m.tipo = 'ajuste'), 0),
               'operaciones', count(*)) as f
        from public.movimientos m
        left join public.personal pe on pe.user_id = m.hecho_por
       where m.creado_en >= v_desde and m.creado_en < v_hasta
         and m.tipo in ('carga', 'devolucion', 'ajuste')
       group by coalesce(pe.nombre, case when public._medio_carga(m.medio_pago, m.referencia, m.clave_idempotencia) = 'mercadopago'
                                         then 'App (Mercado Pago)'
                                         else 'sin identificar' end)
    ) t;

  select coalesce(sum(saldo_centavos), 0) into v_circ from public.tarjetas;
  select count(*) into v_colg from public.sesiones where estado = 'abierta';

  v_res := jsonb_build_object(
    'ok', true,
    'es_admin', public.es_admin(),
    'desde', v_desde, 'hasta', v_hasta,
    'cargas_centavos',       coalesce((v_mov->'carga'->>'centavos')::numeric, 0),
    'cargas_cantidad',       coalesce((v_mov->'carga'->>'cantidad')::int, 0),
    'cargas_por_medio',      v_medios,
    'efectivo_centavos',     v_efvo,
    'devoluciones_centavos', coalesce(-(v_mov->'devolucion'->>'centavos')::numeric, 0),
    'devoluciones_cantidad', coalesce((v_mov->'devolucion'->>'cantidad')::int, 0),
    'ajustes_centavos',      coalesce((v_mov->'ajuste'->>'centavos')::numeric, 0),
    'ajustes_cantidad',      coalesce((v_mov->'ajuste'->>'cantidad')::int, 0),
    -- Lo que tiene que haber en el cajón: el efectivo que entró menos lo que
    -- se devolvió (las devoluciones salen siempre en efectivo).
    'neto_caja_centavos',    v_efvo
                             + coalesce((v_mov->'devolucion'->>'centavos')::numeric, 0),
    'sesiones_abiertas',     v_colg);

  if not public.es_admin() then
    return v_res;
  end if;

  return v_res || jsonb_build_object(
    'consumo',               v_con,
    'margen_centavos',       (v_con->>'centavos')::numeric - (v_con->>'costo_centavos')::numeric,
    'saldo_en_circulacion_centavos', v_circ,
    'por_persona',           v_gente);
end;
$$;


-- ── Reabrir una cuenta que ya se tiene a la vista ───────────────────────────
-- Después de cargar, bloquear o devolver, la pantalla de la caja vuelve a
-- pedir la ficha para mostrar el saldo nuevo. No puede hacerlo por el código de
-- la app (dura 90 segundos y para entonces venció), así que la pide por el
-- identificador que ya le dio la búsqueda anterior.
--
-- También es por donde el administrador abre una cuenta desde el padrón.
create or replace function public.caja_ficha(p_uid text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_c public.clientes_qr;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  select * into v_c from public.clientes_qr
   where uid = upper(trim(coalesce(p_uid, '')));
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'cliente_desconocido');
  end if;

  return public._ficha_cliente(v_c) || jsonb_build_object(
    'tiene_app', exists (select 1 from public.clientes_qr
                          where dni = v_c.dni and tipo = 'app'));
end $$;


-- ── El QR para la billetera de la app de SEN POS ───────────────────────────
-- La app del POS (`/billetera`) tiene sus propios usuarios (email y clave) y a
-- cada uno le da una tarjeta virtual en `tarjetas`. Para servirse en una
-- canilla necesita el mismo QR temporal que la app de las canillas: un código
-- fijo (como el número de la tarjeta) se puede fotografiar y usar desde otro
-- celular. Esto se lo da al usuario que inició sesión, para SU tarjeta.
--
-- Mismo formato y misma vida que `cliente_generar_pase`: 90 segundos y un
-- código de 6 números para que la caja lo encuentre.
create or replace function public.app_generar_pase()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    text;
  v_codigo text;
  v_corto  text;
  v_vence  timestamptz := now() + interval '90 seconds';
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;
  if to_regclass('public.app_clientes') is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_billetera');
  end if;

  execute 'select tarjeta_uid from public.app_clientes where user_id = $1'
     into v_uid using (select auth.uid());
  if v_uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_billetera');
  end if;
  if (select bloqueada from public.tarjetas where uid = v_uid) then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_bloqueada');
  end if;

  update public.pases set codigo_corto = null
   where origen = 'app' and codigo_corto is not null and vence_en < now();
  delete from public.pases
   where origen = 'app' and vence_en < now() - interval '10 minutes';

  v_codigo := public._codigo_nuevo();
  for i in 1..8 loop
    v_corto := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.pases (uid, origen, codigo_hash, codigo_corto, vence_en)
      values (v_uid, 'app', public._hash(v_codigo), v_corto, v_vence);
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
    'saldo_centavos', (select saldo_centavos from public.tarjetas where uid = v_uid));
end $$;


-- ═════════════════════════════════════════════════════════════════════════════
-- CONVIVIR CON SEN POS: datos inválidos se rechazan, no revientan
-- ═════════════════════════════════════════════════════════════════════════════
-- Las pruebas del POS llaman a cada función con datos basura y exigen un
-- `{ok: false}` prolijo, nunca un error interno. Estas cuatro del sistema de
-- canillas tiraban error con un nulo, un número gigante o (por la regla nueva
-- de arriba) un mínimo de cero mililitros. Son las mismas funciones, con esos
-- controles agregados.

create or replace function public.admin_crear_grifo(
  p_nombre           text,
  p_precio_litro     bigint,
  p_pulsos_por_litro numeric default 450,
  p_ml_minimos       int     default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id int;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede crear canillas.'
      using errcode = '42501';
  end if;

  if coalesce(btrim(p_nombre), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'falta_nombre_canilla');
  end if;

  if coalesce(p_precio_litro, 0) <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'precio_invalido');
  end if;

  if coalesce(p_pulsos_por_litro, 0) <= 0 or p_pulsos_por_litro >= 1000000 then
    return jsonb_build_object('ok', false, 'motivo', 'calibracion_invalida');
  end if;
  if length(btrim(p_nombre)) > 60 then
    return jsonb_build_object('ok', false, 'motivo', 'nombre_muy_largo');
  end if;
  if p_precio_litro > 100000000000 then
    return jsonb_build_object('ok', false, 'motivo', 'precio_invalido');
  end if;

  -- El id se elige acá y no con un identity porque es el número que el humano
  -- ve y escribe: va en el `secrets.h` del ESP32 y en el nombre de la red del
  -- portal (GRIFO-1). Un salto en la secuencia por un insert fallido dejaría
  -- una canilla "3" al lado de una "5" sin que exista la "4", y eso confunde a
  -- quien tiene que ir a conectarlas.
  --
  -- El lock es sobre la tabla y no hace falta que sea fino: dar de alta una
  -- canilla pasa cuatro veces en la vida del bar.
  lock table public.grifos in exclusive mode;
  select coalesce(max(id), 0) + 1 into v_id from public.grifos;

  insert into public.grifos (id, nombre, precio_litro_centavos,
                             pulsos_por_litro, ml_minimos, activo)
  values (v_id, btrim(p_nombre), p_precio_litro,
          p_pulsos_por_litro, least(greatest(coalesce(p_ml_minimos, 50), 1), 100000),
          -- Nace APAGADA a propósito. Una canilla sin token no puede vender, y
          -- una que figura "en servicio" sin poder servir es una mentira en el
          -- tablero. Se prende cuando está conectada de verdad.
          false);

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

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
  if p_pulsos_por_litro is not null and (p_pulsos_por_litro <= 0 or p_pulsos_por_litro >= 1000000) then
    return jsonb_build_object('ok', false, 'motivo', 'calibracion_invalida');
  end if;
  if p_precio_litro > 100000000000 then
    return jsonb_build_object('ok', false, 'motivo', 'precio_invalido');
  end if;
  -- Cero mililitros abría una sesión sin tope (ver arriba): mínimo uno.
  if p_ml_minimos is not null and (p_ml_minimos < 1 or p_ml_minimos > 100000) then
    return jsonb_build_object('ok', false, 'motivo', 'ml_minimos_invalido');
  end if;
  if p_nombre is not null and (btrim(p_nombre) = '' or length(p_nombre) > 60) then
    return jsonb_build_object('ok', false, 'motivo', 'falta_nombre_canilla');
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

create or replace function public.admin_ordenar(
  p_grifo int,
  p_tipo  text,
  p_datos jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede darle ordenes a una canilla.'
      using errcode = '42501';
  end if;

  if p_tipo is null or p_tipo not in ('reiniciar', 'wifi', 'olvidar_wifi') then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_desconocido');
  end if;

  if not exists (select 1 from public.grifos where id = p_grifo) then
    return jsonb_build_object('ok', false, 'motivo', 'grifo_desconocido');
  end if;

  -- Un SSID vacio dejaria la canilla sin red y sin respaldo valido. Se corta
  -- aca y no en el firmware: es mas barato no mandar una orden rota que
  -- mandarla y esperar que del otro lado la rechacen bien.
  if p_tipo = 'wifi' and (jsonb_typeof(p_datos) is distinct from 'object' or coalesce(p_datos->>'ssid', '') = '') then
    return jsonb_build_object('ok', false, 'motivo', 'falta_ssid');
  end if;

  -- Una orden nueva del mismo tipo reemplaza a la que todavia no se entrego.
  -- Si corregis el SSID porque lo escribiste mal, no queres que la canilla
  -- aplique primero el equivocado y despues el bueno: queres que aplique el
  -- bueno.
  --
  --   Es reemplazar el job encolado en vez de encolar otro al lado.
  -- Y se le borra la clave al cancelarla. Una orden de wifi cancelada es un
  -- secreto que ya no le sirve a nadie: no hay motivo para seguir guardandolo.
  update public.ordenes_canilla
     set cancelada_en = now(),
         datos        = datos - 'pass'
   where grifo_id = p_grifo
     and tipo = p_tipo
     and aplicada_en is null
     and cancelada_en is null;

  insert into public.ordenes_canilla (grifo_id, tipo, datos, creada_por)
  values (p_grifo, p_tipo,
          case when p_tipo = 'wifi' then p_datos else '{}'::jsonb end,
          auth.uid())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

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
  if p_bloquear is null then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

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


create or replace function public.admin_actualizar_cerveza(
  p_grifo       int,
  p_costo_litro bigint  default null,
  p_ml_vaso     int     default null,
  p_estilo      text    default null,
  p_descripcion text    default null,
  p_abv         numeric default null,
  p_ibu         int     default null,
  p_color       text    default null,
  p_imagen_url  text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_g public.grifos%rowtype;
begin
  if not public.es_admin() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  if p_costo_litro is not null and p_costo_litro < 0 then
    return jsonb_build_object('ok', false, 'motivo', 'costo_invalido');
  end if;
  if p_color is not null and p_color <> '' and p_color !~ '^#[0-9A-Fa-f]{6}$' then
    return jsonb_build_object('ok', false, 'motivo', 'color_invalido');
  end if;

  if p_costo_litro > 100000000000 then
    return jsonb_build_object('ok', false, 'motivo', 'costo_invalido');
  end if;
  if p_abv is not null and (p_abv < 0 or p_abv >= 100) then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;
  if p_ibu is not null and (p_ibu < 0 or p_ibu > 1000) then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;
  if length(p_estilo) > 80 or length(p_descripcion) > 400 or length(p_imagen_url) > 2000 then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

  if p_ml_vaso is not null and (p_ml_vaso <= 0 or p_ml_vaso > 100000) then
    return jsonb_build_object('ok', false, 'motivo', 'vaso_invalido');
  end if;

  update public.grifos
     set costo_litro_centavos = coalesce(p_costo_litro, costo_litro_centavos),
         ml_vaso     = coalesce(p_ml_vaso, ml_vaso),
         estilo      = coalesce(p_estilo, estilo),
         descripcion = coalesce(p_descripcion, descripcion),
         abv         = coalesce(p_abv, abv),
         ibu         = coalesce(p_ibu, ibu),
         color       = coalesce(nullif(p_color, ''), color),
         imagen_url  = coalesce(p_imagen_url, imagen_url)
   where id = p_grifo
   returning * into v_g;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'grifo_desconocido');
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_g.id,
    'costo_litro_centavos', v_g.costo_litro_centavos,
    'ml_vaso', v_g.ml_vaso,
    'margen_litro_centavos', v_g.precio_litro_centavos - v_g.costo_litro_centavos,
    'color', v_g.color, 'imagen_url', v_g.imagen_url
  );
end;
$$;

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
  if p_centavos is null or p_centavos = 0 or abs(p_centavos) > 100000000000 then
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

create or replace function public.admin_listar_personal()
returns jsonb language sql stable security definer set search_path = ''
as $$
  -- A quien no es admin, nada (antes, una lista vacía: no filtraba, pero no
  -- dejaba claro que la respuesta era "no").
  select case when public.es_admin() then coalesce(jsonb_agg(x order by x->>'creado_en'), '[]'::jsonb) end
    from (
      select jsonb_build_object(
               'user_id',   p.user_id,
               'email',     u.email,
               'nombre',    p.nombre,
               'rol',       p.rol,
               'activo',    p.activo,
               'creado_en', p.creado_en
             ) as x
        from public.personal p
        join auth.users u on u.id = p.user_id
       where public.es_admin()
    ) t;
$$;

create or replace function public.estado_barriles()
returns jsonb language sql stable security definer set search_path = ''
as $$
  -- A quien no es admin, nada (antes, una lista vacía).
  select case when public.es_admin() then coalesce(jsonb_agg(x order by x->>'restante_pct'), '[]'::jsonb) end
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
-- PERMISOS
-- ═════════════════════════════════════════════════════════════════════════════
revoke all on function public.cliente_entrar(text, text, text)        from public, anon, authenticated;
revoke all on function public.cliente_estado(text, text)              from public, anon, authenticated;
revoke all on function public.cliente_generar_pase(text, text)        from public, anon, authenticated;
revoke all on function public.cliente_salir(text, text)               from public, anon, authenticated;
revoke all on function public.app_generar_pase()                    from public, anon, authenticated;
revoke all on function public._medio_carga(text, text, text)          from public, anon, authenticated;
-- Del sistema de canillas, de antes: es del admin y estaba abierta a anon por
-- los permisos que Supabase da por defecto (adentro igual pedía admin).
revoke all on function public.admin_listar_grifos()                  from public, anon;
revoke all on function public.inicio_jornada(timestamptz)            from public, anon, authenticated;
revoke all on function public.caja_buscar_cliente(text)               from public, anon, authenticated;
revoke all on function public.caja_buscar_por_codigo(text)            from public, anon, authenticated;
revoke all on function public.caja_ficha(text)                        from public, anon, authenticated;
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
-- La billetera de la app de SEN POS: solo con sesión iniciada.
grant execute on function public.app_generar_pase()                  to authenticated;
grant execute on function public.admin_listar_grifos()               to authenticated;
grant execute on function public.inicio_jornada(timestamptz)         to service_role;

-- La caja y el admin: cualquier logueado puede intentar, la función decide.
grant execute on function public.caja_buscar_cliente(text)            to authenticated;
grant execute on function public.caja_buscar_por_codigo(text)         to authenticated;
grant execute on function public.caja_vender(text, text, bigint, text, text) to authenticated;
grant execute on function public.caja_cargar(text, bigint, text, text) to authenticated;
grant execute on function public.caja_emitir_pase(text, boolean)      to authenticated;
grant execute on function public.caja_habilitar_celular(text)         to authenticated;
grant execute on function public.caja_devolver_tarjeta(text, text)    to authenticated;
grant execute on function public.caja_ficha(text)                      to authenticated;
grant execute on function public.admin_listar_cuentas(text, text)     to authenticated;
grant execute on function public.arqueo(timestamptz, timestamptz)     to authenticated;

do $$ begin raise notice '✅ 29-qr.sql aplicado'; end $$;
