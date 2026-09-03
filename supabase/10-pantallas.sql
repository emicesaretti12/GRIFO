-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Pantalla de cada canilla
--
-- Cada canilla tiene su propia pantalla (una tablet, un celular viejo o un
-- monitor) mostrando una página web en modo kiosco. Ese dispositivo se
-- autentica con el MISMO token del grifo que usa el ESP32, así que:
--
--   · no hay credenciales nuevas que administrar,
--   · rotar el token de una canilla desconecta a la vez su ESP32 y su pantalla,
--   · una pantalla no puede espiar lo que pasa en otra canilla.
--
-- La pantalla NO lee tablas: llama a una sola función que devuelve exactamente
-- lo que necesita mostrar, con el UID enmascarado. Es una pantalla a la vista
-- del público: nadie tiene por qué ver el número completo de la tarjeta ajena.
-- ═════════════════════════════════════════════════════════════════════════════


-- ── Guarda de orden ─────────────────────────────────────────────────────────
-- Este archivo necesita columnas que agrega 01-schema.sql. Sin esto, correrlo
-- fuera de orden falla con un "column ... does not exist" que no dice qué hacer.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'grifos'
       and column_name = 'costo_litro_centavos'
  ) then
    raise exception
      E'FALTA CORRER 01-schema.sql PRIMERO.\n\n'
      'A la tabla grifos le falta la columna costo_litro_centavos, que agrega\n'
      'ese archivo. Corré, en este orden:\n'
      '   01-schema.sql  ->  02-funciones.sql  ->  10-pantallas.sql\n'
      'y recién después este.\n\n'
      'Si ya lo corriste, revisá que sea la version nueva del repo (git pull).';
  end if;
end $$;

-- ── Vaso de referencia ──────────────────────────────────────────────────────
-- Contra qué se mide la "punteria" del cliente en la pantalla. Una pinta
-- americana son 473 ml; si el bar usa otro vaso, se cambia por canilla.
alter table public.grifos add column if not exists ml_vaso int not null default 473;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'grifos_vaso_positivo') then
    alter table public.grifos add constraint grifos_vaso_positivo check (ml_vaso > 0);
  end if;
end $$;


-- ── Estado de la canilla, para su pantalla ──────────────────────────────────
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
     or v_g.token_hash is distinct from
        encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') then
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

  -- Historial del cliente que está en la canilla (o del que acaba de servir),
  -- para saludarlo por su historia y no como a un desconocido.
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
      'listo',   v_g.activo and v_g.token_hash is not null
    ),

    -- Historia del cliente. Todo enmascarado: la pantalla es pública.
    'cliente', case when v_uid_cli is null then null else jsonb_build_object(
      'veces',      v_veces,
      'ml_total',   v_ml_tot,
      'es_primera', v_veces = 0
    ) end,

    -- Ranking del día EN ESTA CANILLA. Le da algo para mirar a quien espera, y
    -- un motivo para volver a quien está segundo.
    'ranking', coalesce((
      select jsonb_agg(jsonb_build_object(
               'tarjeta', '····' || right(r.uid, 4),
               'ml',      r.ml,
               'veces',   r.veces
             ) order by r.ml desc)
        from (
          select uid, sum(ml_servidos)::int as ml, count(*)::int as veces
            from public.sesiones
           where grifo_id = p_grifo and estado = 'cerrada'
             and cerrada_en >= date_trunc('day', now())
           group by uid
           order by sum(ml_servidos) desc
           limit 3
        ) r
    ), '[]'::jsonb),
    'sesion', case when v_s.id is null then null else jsonb_build_object(
      'id',             v_s.id,
      -- UID enmascarado: la pantalla está a la vista de todo el bar.
      'tarjeta',        '····' || right(v_s.uid, 4),
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


-- ── Avance en vivo, reportado por el ESP32 ──────────────────────────────────
-- Opcional: si el firmware lo llama cada ~500 ms mientras sirve, la pantalla
-- muestra el vaso llenándose de verdad en vez de una animación inventada.
--
-- NO toca plata ni cambia el estado de la sesión: si esta llamada se pierde,
-- no pasa absolutamente nada. La liquidación sigue siendo cosa de
-- cerrar_sesion, que es la única que mueve saldo.
create or replace function public.reportar_progreso(
  p_sesion_id bigint, p_ml int, p_pulsos int, p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grifo int;
  v_hash  text;
begin
  select grifo_id into v_grifo from public.sesiones
   where id = p_sesion_id and estado = 'abierta';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sesion_desconocida');
  end if;

  select token_hash into v_hash from public.grifos where id = v_grifo;
  if v_hash is null
     or v_hash is distinct from
        encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;

  if p_ml is null or p_ml < 0 then
    return jsonb_build_object('ok', false, 'motivo', 'medicion_invalida');
  end if;

  -- greatest(): el avance nunca retrocede. Si dos reportes llegan desordenados
  -- por la red, el vaso de la pantalla no da un salto para atrás.
  update public.sesiones
     set ml_parcial     = greatest(ml_parcial, p_ml),
         pulsos_parcial = greatest(pulsos_parcial, coalesce(p_pulsos, 0)),
         visto_en       = now()
   where id = p_sesion_id;

  return jsonb_build_object('ok', true);
end;
$$;


drop function if exists public.admin_actualizar_cerveza(int, bigint, text, text, numeric, int, text, text);

-- ── Identidad de la cerveza (admin) ─────────────────────────────────────────
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

  if p_ml_vaso is not null and p_ml_vaso <= 0 then
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


-- ── Permisos ────────────────────────────────────────────────────────────────
revoke all on function public.pantalla_estado(int, text)                    from public, anon, authenticated;
revoke all on function public.reportar_progreso(bigint, int, int, text)     from public, anon, authenticated;
revoke all on function public.admin_actualizar_cerveza(int, bigint, int, text, text, numeric, int, text, text)
                                                                            from public, anon, authenticated;

-- La pantalla y el ESP32 usan la anon key + el token del grifo.
grant execute on function public.pantalla_estado(int, text)                to anon, authenticated;
grant execute on function public.reportar_progreso(bigint, int, int, text) to anon;

grant execute on function public.admin_actualizar_cerveza(int, bigint, int, text, text, numeric, int, text, text)
                                                                           to authenticated;


-- ── Storage: imágenes de las cervezas ───────────────────────────────────────
-- Bucket público de lectura (las pantallas lo consumen sin credenciales) y
-- escritura solo para admins. Se salta si no existe el esquema de storage,
-- para que este archivo también corra en un Postgres pelado de pruebas.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'storage' and table_name = 'buckets') then

    insert into storage.buckets (id, name, public)
    values ('canillas', 'canillas', true)
    on conflict (id) do update set public = true;

    if not exists (select 1 from pg_policies
                    where schemaname = 'storage' and tablename = 'objects'
                      and policyname = 'canillas_lectura_publica') then
      execute $p$
        create policy canillas_lectura_publica on storage.objects
          for select using (bucket_id = 'canillas')
      $p$;
    end if;

    if not exists (select 1 from pg_policies
                    where schemaname = 'storage' and tablename = 'objects'
                      and policyname = 'canillas_escribe_admin') then
      execute $p$
        create policy canillas_escribe_admin on storage.objects
          for all to authenticated
          using (bucket_id = 'canillas' and public.es_admin())
          with check (bucket_id = 'canillas' and public.es_admin())
      $p$;
    end if;
  end if;
end $$;
