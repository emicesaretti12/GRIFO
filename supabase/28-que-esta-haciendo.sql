-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — que la canilla cuente en qué anda
--
-- En el bar no hay monitor serie. Sin esto, cuando algo falla lo único que se
-- ve desde el celular es "En línea" — que no distingue una canilla esperando
-- clientes de una canilla que rechaza cada tarjeta por un token vencido.
--
-- El latido ya pasa cada 30 segundos y cuesta lo mismo llevar dos campos más.
--
--   Es agregarle el estado al health check. Un "200 OK" dice que el proceso
--   respira; no dice qué está haciendo ni qué fue lo último que le pasó.
-- ═════════════════════════════════════════════════════════════════════════════

alter table public.grifos add column if not exists estado_texto  text;
alter table public.grifos add column if not exists ultimo_evento text;

comment on column public.grifos.estado_texto is
  'En que estado esta la maquina del ESP32 ahora: ESPERANDO, SIRVIENDO...';
comment on column public.grifos.ultimo_evento is
  'Lo ultimo que le paso, en castellano. Es el monitor serie para quien no '
  'tiene una computadora al lado.';

drop function if exists public.canilla_latido(int, text, text, int, int, text, bigint);

create or replace function public.canilla_latido(
  p_grifo        int,
  p_token        text,
  p_firmware     text   default null,
  p_pendientes   int    default null,
  p_senal        int    default null,
  p_ip           text   default null,
  p_ultima_orden bigint default null,
  p_estado       text   default null,
  p_evento       text   default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash  text;
  v_orden public.ordenes_canilla%rowtype;
  v_json  jsonb := null;
begin
  select token_hash into v_hash from public.grifos where id = p_grifo;
  if v_hash is null then
    return jsonb_build_object('ok', false, 'motivo', 'grifo_desconocido');
  end if;

  if v_hash is distinct from
     encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;

  update public.grifos
     set ultimo_latido      = now(),
         firmware           = coalesce(p_firmware,   firmware),
         cierres_pendientes = coalesce(p_pendientes, cierres_pendientes),
         senal_dbm          = coalesce(p_senal,      senal_dbm),
         ip_local           = coalesce(p_ip,         ip_local),
         estado_texto       = coalesce(p_estado,     estado_texto),
         ultimo_evento      = coalesce(p_evento,     ultimo_evento),
         ultima_orden       = greatest(ultima_orden, coalesce(p_ultima_orden, 0))
   where id = p_grifo;

  if coalesce(p_ultima_orden, 0) > 0 then
    update public.ordenes_canilla
       set aplicada_en = coalesce(aplicada_en, now()),
           datos       = datos - 'pass'
     where grifo_id = p_grifo
       and id <= p_ultima_orden
       and aplicada_en is null
       and cancelada_en is null;
  end if;

  select * into v_orden
    from public.ordenes_canilla
   where grifo_id = p_grifo
     and aplicada_en is null
     and cancelada_en is null
     and id > coalesce(p_ultima_orden, 0)
   order by id
   limit 1;

  if found then
    update public.ordenes_canilla
       set entregada_en = coalesce(entregada_en, now())
     where id = v_orden.id;
    v_json := jsonb_build_object('id', v_orden.id, 'tipo', v_orden.tipo,
                                 'datos', v_orden.datos);
  end if;

  return jsonb_build_object('ok', true, 'ahora', now(), 'orden', v_json);
end $$;

revoke all on function
  public.canilla_latido(int, text, text, int, int, text, bigint, text, text)
  from public, anon, authenticated;
grant execute on function
  public.canilla_latido(int, text, text, int, int, text, bigint, text, text)
  to anon;

-- El permiso de `grifos` es por columna y una lista blanca no se actualiza
-- sola: las columnas nuevas nacen sin permiso. Es el bug que dejó la pantalla
-- de Canillas vacía con la tabla llena.
grant select (id, nombre, precio_litro_centavos, pulsos_por_litro,
              ml_minimos, ml_vaso, activo, token_rotado_en,
              estilo, descripcion, abv, ibu, color, imagen_url,
              ultimo_latido, firmware, cierres_pendientes, senal_dbm, ip_local,
              estado_texto, ultimo_evento)
  on table public.grifos to authenticated;

drop function if exists public.admin_listar_grifos();

create or replace function public.admin_listar_grifos()
returns table (
  id                     int,      nombre                 text,
  precio_litro_centavos  bigint,   costo_litro_centavos   bigint,
  pulsos_por_litro       numeric,  ml_minimos             int,
  ml_vaso                int,      activo                 boolean,
  token_rotado_en        timestamptz, estilo              text,
  descripcion            text,     abv                    numeric,
  ibu                    int,      color                  text,
  imagen_url             text,     ultimo_latido          timestamptz,
  firmware               text,     cierres_pendientes     int,
  senal_dbm              int,      ip_local               text,
  estado_texto           text,     ultimo_evento          text
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
           g.color, g.imagen_url, g.ultimo_latido, g.firmware,
           g.cierres_pendientes, g.senal_dbm, g.ip_local,
           g.estado_texto, g.ultimo_evento
      from public.grifos g
     order by g.id;
end $$;

revoke all on function public.admin_listar_grifos() from public;
grant execute on function public.admin_listar_grifos() to authenticated;

do $$ begin raise notice '✅ 28-que-esta-haciendo.sql aplicado'; end $$;
