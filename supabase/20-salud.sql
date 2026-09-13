-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — salud de las canillas
--
-- El agujero que tapa: hoy, si una canilla se cuelga, se queda sin WiFi o se
-- queda con cierres sin entregar, **nadie se entera hasta que un cliente
-- reclama**. En un bar eso puede ser toda una noche.
--
-- Un sistema que dura años no es uno que no falla: es uno donde **se ve que
-- falló**, temprano y sin que nadie tenga que ir a mirar.
--
--   Es la diferencia entre tener logs y tener alertas. El primero te deja
--   averiguar qué pasó; el segundo te avisa mientras está pasando.
--
-- Cada ESP32 manda un latido cada minuto con su estado. La app muestra cuándo
-- fue el último, y si pasó demasiado tiempo, la canilla aparece caída.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.grifos add column if not exists ultimo_latido      timestamptz;
alter table public.grifos add column if not exists firmware           text;
alter table public.grifos add column if not exists cierres_pendientes int;
alter table public.grifos add column if not exists senal_dbm          int;
alter table public.grifos add column if not exists ip_local           text;

comment on column public.grifos.cierres_pendientes is
  'Cierres que el ESP32 tiene guardados en su flash sin poder entregar. '
  'Si este numero no vuelve a cero, hay ventas sin cobrar esperando.';


-- ── canilla_latido ──────────────────────────────────────────────────────────
-- POST /rest/v1/rpc/canilla_latido
--   { "p_grifo": 1, "p_token": "...", "p_firmware": "etapa6",
--     "p_pendientes": 0, "p_senal": -45, "p_ip": "192.168.0.106" }
--
-- Deliberadamente barata: un update de una fila y nada más. La llama cada
-- canilla cada minuto, para siempre. Si hiciera algo caro, el costo se
-- multiplicaría por la cantidad de canillas y por los minutos del año.
create or replace function public.canilla_latido(
  p_grifo      int,
  p_token      text,
  p_firmware   text default null,
  p_pendientes int  default null,
  p_senal      int  default null,
  p_ip         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_hash text;
begin
  select token_hash into v_hash from public.grifos where id = p_grifo;
  if v_hash is null then
    return jsonb_build_object('ok', false, 'motivo', 'grifo_desconocido');
  end if;

  -- Mismo chequeo de token que abrir_sesion. Un latido tambien es una
  -- afirmacion sobre el estado de una canilla, y no queremos que cualquiera
  -- pueda decir que la canilla 3 esta sana cuando no lo esta.
  if v_hash is distinct from
     encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;

  update public.grifos
     set ultimo_latido      = now(),
         firmware           = coalesce(p_firmware,   firmware),
         cierres_pendientes = coalesce(p_pendientes, cierres_pendientes),
         senal_dbm          = coalesce(p_senal,      senal_dbm),
         ip_local           = coalesce(p_ip,         ip_local)
   where id = p_grifo;

  -- Se devuelve la hora del servidor para que el dispositivo pueda detectar
  -- que su reloj esta corrido. No la usa todavia, pero el dato es gratis.
  return jsonb_build_object('ok', true, 'ahora', now());
end $$;


-- ── Lo que ve el personal ───────────────────────────────────────────────────
-- El permiso de `grifos` es por columna (ver 18-grifos-lectura.sql), y una
-- lista blanca no se actualiza sola: las columnas nuevas nacen sin permiso.
-- Es exactamente el bug que dejo la pantalla de Canillas vacia con la tabla
-- llena. Se extiende explicitamente.
grant select (id, nombre, precio_litro_centavos, pulsos_por_litro,
              ml_minimos, ml_vaso, activo, token_rotado_en,
              estilo, descripcion, abv, ibu, color, imagen_url,
              ultimo_latido, firmware, cierres_pendientes, senal_dbm, ip_local)
  on table public.grifos to authenticated;


-- ── cerrar_sesiones_abandonadas, automatico ─────────────────────────────────
-- Existia desde el principio pero **nadie la llamaba**. Una funcion de limpieza
-- que no esta agendada es una funcion que no existe: las sesiones abandonadas
-- se acumulan, y una tarjeta con una sesion abierta no puede servir en ninguna
-- canilla.
--
-- Se agenda con pg_cron. Si la extension no esta habilitada en el proyecto, el
-- bloque avisa y sigue: hay que prenderla en Supabase -> Database -> Extensions.
do $$
begin
  create extension if not exists pg_cron;

  perform cron.unschedule('grifo-abandonadas')
    where exists (select 1 from cron.job where jobname = 'grifo-abandonadas');

  perform cron.schedule(
    'grifo-abandonadas',
    '*/5 * * * *',
    $cron$ select public.cerrar_sesiones_abandonadas(15) $cron$
  );
  raise notice 'Agendado: cerrar_sesiones_abandonadas cada 5 minutos.';
exception when others then
  raise notice 'No se pudo agendar con pg_cron (%). Habilitala en', sqlerrm;
  raise notice 'Supabase -> Database -> Extensions y volve a correr este archivo.';
end $$;


revoke all on function public.canilla_latido(int, text, text, int, int, text)
  from public, anon, authenticated;
grant execute on function public.canilla_latido(int, text, text, int, int, text)
  to anon;


-- ── El listado de canillas, ahora con salud ─────────────────────────────────
-- Se reemplaza la de 18-grifos-lectura.sql agregando las columnas nuevas. El
-- token sigue sin devolverse, ni para el admin.
--
-- Va un `drop` antes: Postgres no deja cambiar el tipo de retorno de una
-- funcion con `create or replace`, y esta devuelve cinco columnas mas.
drop function if exists public.admin_listar_grifos();

create or replace function public.admin_listar_grifos()
returns table (
  id                     int,
  nombre                 text,
  precio_litro_centavos  bigint,
  costo_litro_centavos   bigint,
  pulsos_por_litro       numeric,
  ml_minimos             int,
  ml_vaso                int,
  activo                 boolean,
  token_rotado_en        timestamptz,
  estilo                 text,
  descripcion            text,
  abv                    numeric,
  ibu                    int,
  color                  text,
  imagen_url             text,
  ultimo_latido          timestamptz,
  firmware               text,
  cierres_pendientes     int,
  senal_dbm              int,
  ip_local               text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede ver el costo de las canillas.'
      using errcode = '42501';
  end if;

  return query
    select g.id, g.nombre, g.precio_litro_centavos, g.costo_litro_centavos,
           g.pulsos_por_litro, g.ml_minimos, g.ml_vaso, g.activo,
           g.token_rotado_en, g.estilo, g.descripcion, g.abv, g.ibu,
           g.color, g.imagen_url,
           g.ultimo_latido, g.firmware, g.cierres_pendientes,
           g.senal_dbm, g.ip_local
      from public.grifos g
     order by g.id;
end $$;

revoke all on function public.admin_listar_grifos() from public;
grant execute on function public.admin_listar_grifos() to authenticated;
