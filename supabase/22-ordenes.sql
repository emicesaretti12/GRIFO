-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — órdenes para la canilla
--
-- El agujero que tapa: hoy la app **mira** la canilla pero no puede **tocarla**.
-- Todo lo que hay que hacerle hay que hacerlo con el cuerpo: ir hasta ahí,
-- desenchufar, enchufar, o peor, con una notebook y el cable.
--
-- ── Por qué la canilla pregunta y el servidor no avisa ──────────────────────
-- Lo natural sería que el servidor le mande la orden a la canilla. No se puede:
-- el ESP32 está detrás del router del bar, sin IP pública y sin puerto abierto.
-- Nadie de afuera puede iniciar una conversación con él.
--
-- Así que se da vuelta: el servidor deja la orden anotada y **la canilla la
-- busca** en cada latido, que ya estaba pasando igual.
--
--   Es exactamente la diferencia entre un webhook y un polling. Cuando el que
--   tiene que recibir no es alcanzable, el que recibe pregunta.
--
-- ── Solo lo que únicamente el aparato puede hacer ───────────────────────────
-- "Bloquear la canilla" NO es una orden: `abrir_sesion` ya chequea `activo`, así
-- que desactivarla surte efecto en el servidor al instante, aunque el ESP32
-- esté apagado. Una orden para eso sería más lenta y menos confiable.
--
--   Si el servidor puede resolverlo solo, mandárselo al dispositivo es agregar
--   un punto de falla a cambio de nada.
--
-- Quedan tres, que son las que de verdad necesitan manos del otro lado:
--   · reiniciar      — la canilla quedó rara y no hay nadie en el bar
--   · wifi           — cambiarle la red sin ir hasta ahí
--   · olvidar_wifi   — borrarle la red para que levante el portal
-- ═════════════════════════════════════════════════════════════════════════════

create table if not exists public.ordenes_canilla (
  id           bigint generated always as identity primary key,
  grifo_id     int    not null references public.grifos(id) on delete cascade,
  tipo         text   not null check (tipo in ('reiniciar', 'wifi', 'olvidar_wifi')),

  -- Para 'wifi': { "ssid": "...", "pass": "..." }.
  --
  -- Apenas la orden se aplica o se cancela, se le saca la CLAVE y se deja el
  -- SSID. No es lo mismo: el SSID es dato operativo — querés poder mirar el
  -- historial y ver a qué red se le dijo que se conectara. La clave no la
  -- necesita ver nadie nunca más.
  --
  --   Es guardar en el log qué usuario intentó entrar, y no su contraseña.
  datos        jsonb  not null default '{}'::jsonb,

  creada_en    timestamptz not null default now(),
  creada_por   uuid,
  entregada_en timestamptz,   -- la canilla la recibió
  aplicada_en  timestamptz,   -- la canilla confirmó haberla ejecutado
  cancelada_en timestamptz
);

comment on table public.ordenes_canilla is
  'Cosas que solo el ESP32 puede hacer. La canilla las busca en cada latido: '
  'esta detras del router del bar y nadie puede iniciarle una conexion.';

-- El indice cubre la unica consulta caliente: "la proxima orden sin aplicar de
-- esta canilla". Parcial, porque las ya aplicadas son la mayoria y no se miran.
create index if not exists ordenes_pendientes_idx
  on public.ordenes_canilla (grifo_id, id)
  where aplicada_en is null and cancelada_en is null;

-- ── La marca de agua ────────────────────────────────────────────────────────
-- Hasta que numero de orden reconocio la canilla. Es el mismo patron que la
-- cola de cierres del firmware: indices que solo suben, y todo lo que quedo
-- atras se da por hecho.
--
--   Es un offset de consumidor. No hace falta un ACK por mensaje: alcanza con
--   "voy por el N", y eso sobrevive a que el aparato se reinicie a la mitad.
alter table public.grifos add column if not exists ultima_orden bigint not null default 0;

alter table public.ordenes_canilla enable row level security;
revoke all on table public.ordenes_canilla from public, anon, authenticated;


-- ── canilla_latido, ahora con órdenes ───────────────────────────────────────
-- Se cuelga del latido y no de una llamada nueva a propósito: ya había una
-- conversación cada tanto, y agregarle un campo no cuesta nada. Una petición
-- aparte costaría otro handshake y otra ronda, multiplicado por canillas y por
-- minutos del año.
--
--   Es devolver el dato en la respuesta que ya estabas haciendo, en vez de
--   agregar un endpoint para pedirlo.
drop function if exists public.canilla_latido(int, text, text, int, int, text);

create or replace function public.canilla_latido(
  p_grifo        int,
  p_token        text,
  p_firmware     text   default null,
  p_pendientes   int    default null,
  p_senal        int    default null,
  p_ip           text   default null,
  p_ultima_orden bigint default null
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
         ultima_orden       = greatest(ultima_orden, coalesce(p_ultima_orden, 0))
   where id = p_grifo;

  -- Todo lo que quedo por debajo de la marca de agua se da por aplicado, y se
  -- le borran los datos. Si la canilla dice "voy por la 7", la 5 y la 6 estan
  -- hechas: no hace falta que las confirme una por una.
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
  public.canilla_latido(int, text, text, int, int, text, bigint)
  from public, anon, authenticated;
grant execute on function
  public.canilla_latido(int, text, text, int, int, text, bigint)
  to anon;


-- ── admin_ordenar ───────────────────────────────────────────────────────────
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

  if p_tipo not in ('reiniciar', 'wifi', 'olvidar_wifi') then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_desconocido');
  end if;

  if not exists (select 1 from public.grifos where id = p_grifo) then
    return jsonb_build_object('ok', false, 'motivo', 'grifo_desconocido');
  end if;

  -- Un SSID vacio dejaria la canilla sin red y sin respaldo valido. Se corta
  -- aca y no en el firmware: es mas barato no mandar una orden rota que
  -- mandarla y esperar que del otro lado la rechacen bien.
  if p_tipo = 'wifi' and coalesce(p_datos->>'ssid', '') = '' then
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

revoke all on function public.admin_ordenar(int, text, jsonb) from public, anon;
grant execute on function public.admin_ordenar(int, text, jsonb) to authenticated;


create or replace function public.admin_cancelar_orden(p_orden bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede cancelar ordenes.'
      using errcode = '42501';
  end if;

  update public.ordenes_canilla
     set cancelada_en = now(), datos = datos - 'pass'
   where id = p_orden and aplicada_en is null and cancelada_en is null;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ya_no_se_puede');
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_cancelar_orden(bigint) from public, anon;
grant execute on function public.admin_cancelar_orden(bigint) to authenticated;


-- ── admin_listar_ordenes ────────────────────────────────────────────────────
-- Devuelve el SSID pero **nunca la clave**. Saber a qué red se le dijo que se
-- conecte es información operativa; la clave no la necesita ver nadie desde la
-- app, ni siquiera quien la escribió.
--
--   Es mostrar el nombre de usuario en el log de auditoría y no la contraseña.
create or replace function public.admin_listar_ordenes(p_grifo int default null)
returns table (
  id           bigint,
  grifo_id     int,
  grifo        text,
  tipo         text,
  ssid         text,
  creada_en    timestamptz,
  entregada_en timestamptz,
  aplicada_en  timestamptz,
  cancelada_en timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede ver las ordenes.'
      using errcode = '42501';
  end if;

  return query
    select o.id, o.grifo_id, g.nombre, o.tipo,
           nullif(o.datos->>'ssid', ''),
           o.creada_en, o.entregada_en, o.aplicada_en, o.cancelada_en
      from public.ordenes_canilla o
      join public.grifos g on g.id = o.grifo_id
     where p_grifo is null or o.grifo_id = p_grifo
     order by o.id desc
     limit 50;
end $$;

revoke all on function public.admin_listar_ordenes(int) from public, anon;
grant execute on function public.admin_listar_ordenes(int) to authenticated;
