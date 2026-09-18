-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — la canilla pregunta si tiene alguien esperando
--
-- Con la tarjeta leída por la tablet, el ESP32 ya no ve al cliente. Alguien
-- tiene que avisarle que abra, y no puede ser el servidor: la canilla está
-- detrás del router del bar, sin IP pública.
--
-- Tampoco puede ser la tablet directo, aunque esté en la misma red: la app se
-- sirve por HTTPS y el navegador bloquea una llamada a http://<ip-local>. Es
-- contenido mixto, y no hay bandera que lo habilite en producción.
--
--   Es el problema del webhook que no podés recibir. La solución no es esperar
--   el empujón: es preguntar seguido.
--
-- Así que la canilla pregunta. Y a un segundo, no a treinta: "reiniciate" puede
-- esperar, "abrí que el cliente está parado ahí" no.
--
-- Esta función se llama **una vez por segundo por canilla, para siempre**. Es
-- un select de una fila por índice y nada más. Cualquier cosa que se le agregue
-- se multiplica por los segundos del año.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Una sola sesión abierta por canilla ─────────────────────────────────────
-- Antes esto lo garantizaba la física: una sola tarjeta cabe sobre el lector.
-- Con la tablet, dos clientes podrían abrir sesión en la misma canilla y el
-- ESP32 no tendría forma de saber a cuál de los dos le está sirviendo.
--
--   Es el invariante que estaba sostenido por un detalle de implementación. Al
--   cambiar la implementación hay que escribirlo donde se pueda hacer cumplir.
--
-- Primero se limpia lo que ya pueda existir. Se marcan 'abandonada' y no
-- 'cerrada': abandonada libera la tarjeta sin cobrar, y si el ESP32 todavía
-- tiene ese cierre en su cola, cerrar_sesion lo liquida igual con los mL
-- reales.
update public.sesiones s
   set estado = 'abandonada'
 where s.estado = 'abierta'
   and exists (
     select 1 from public.sesiones o
      where o.grifo_id = s.grifo_id
        and o.estado = 'abierta'
        and o.id > s.id
   );

-- Y este mismo índice es el que sostiene la consulta caliente de abajo: buscar
-- "la sesión abierta de la canilla N" es exactamente lo que indexa. No hace
-- falta otro.
--
--   Es la restricción que sale gratis porque el índice que la hace cumplir era
--   el que igual necesitabas para leer.
create unique index if not exists sesiones_una_abierta_por_grifo
  on public.sesiones (grifo_id)
  where (estado = 'abierta');


create or replace function public.canilla_sesion_activa(
  p_grifo int,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_s    record;
begin
  select token_hash into v_hash from public.grifos where id = p_grifo;
  if v_hash is null then
    return jsonb_build_object('ok', false, 'motivo', 'grifo_desconocido');
  end if;

  -- Mismo chequeo de token que todo lo demás. Sin esto, cualquiera podría
  -- preguntar quién está sirviendo en la canilla 3 y con cuánto saldo.
  if v_hash is distinct from
     encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;

  select s.id, s.uid, s.ml_maximos, s.pulsos_por_litro,
         s.precio_litro_centavos, s.saldo_inicial_centavos, t.nota
    into v_s
    from public.sesiones s
    join public.tarjetas t on t.uid = s.uid
   where s.grifo_id = p_grifo
     and s.estado = 'abierta'
   limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'sesion', null);
  end if;

  -- Los mismos campos que devuelve abrir_sesion, con los mismos nombres. El
  -- firmware los lee con el mismo código en los dos caminos.
  return jsonb_build_object('ok', true, 'sesion', jsonb_build_object(
    'sesion_id',             v_s.id,
    'uid',                   v_s.uid,
    'cliente',               v_s.nota,
    'ml_maximos',            v_s.ml_maximos,
    'pulsos_por_litro',      v_s.pulsos_por_litro,
    'precio_litro_centavos', v_s.precio_litro_centavos,
    'saldo_centavos',        v_s.saldo_inicial_centavos
  ));
end $$;

revoke all on function public.canilla_sesion_activa(int, text)
  from public, anon, authenticated;
grant execute on function public.canilla_sesion_activa(int, text) to anon;


-- ── Lo que llama la tablet ──────────────────────────────────────────────────
-- Es abrir_sesion con un chequeo adelante. Sin esto, el segundo cliente que
-- toque la tarjeta en una canilla ocupada se comería una violación de unicidad
-- cruda (23505), y del otro lado de la pantalla eso es "error inesperado".
--
--   Es traducir el error de la base a algo que le sirva a quien lo lee. El
--   índice garantiza; el mensaje explica.
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
declare v_ocupada record;
begin
  select s.uid, t.nota into v_ocupada
    from public.sesiones s
    join public.tarjetas t on t.uid = s.uid
   where s.grifo_id = p_grifo
     and s.estado = 'abierta'
   limit 1;

  if found then
    -- Si es la MISMA tarjeta, no es un conflicto: es alguien que volvió a
    -- apoyarla. abrir_sesion sabe reanudar esa sesión, así que se lo dejamos.
    if v_ocupada.uid is distinct from p_uid then
      return jsonb_build_object(
        'ok', false, 'motivo', 'canilla_ocupada',
        'cliente', v_ocupada.nota
      );
    end if;
  end if;

  return public.abrir_sesion(p_uid, p_grifo, p_token);
end $$;

revoke all on function public.tablet_abrir_sesion(text, int, text)
  from public, anon, authenticated;
grant execute on function public.tablet_abrir_sesion(text, int, text) to anon;

do $$ begin raise notice '✅ 26-sesion-activa.sql aplicado'; end $$;
