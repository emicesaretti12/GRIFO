-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Pruebas de la pantalla de canilla, el avance en vivo y el margen
-- Corre en transacción y hace ROLLBACK: no deja rastro.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

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


insert into public.grifos (id, nombre, precio_litro_centavos, costo_litro_centavos,
                           pulsos_por_litro, ml_minimos, activo, estilo, color)
values (921, 'test-pantalla', 400000, 150000, 452.700, 50, true, 'IPA', '#c8811f'),
       (922, 'test-otra',     300000, 100000, 452.700, 50, true, 'Rubia', '#e8b53a');

insert into public.tarjetas (uid, saldo_centavos) values ('PANT0001', 900000);

do $$
declare
  v      jsonb;
  t921   text;
  t922   text;
  v_ses  bigint;
begin
  t921 := public.rotar_token_grifo(921) ->> 'token';
  t922 := public.rotar_token_grifo(922) ->> 'token';

  -- ══ 1. La pantalla necesita el token del grifo ═══════════════════════════
  v := public.pantalla_estado(921, 'inventado');
  assert v->>'motivo' = 'token_invalido',   '1a: token falso. ' || v::text;
  v := public.pantalla_estado(921, t922);
  assert v->>'motivo' = 'token_invalido',   '1b: token de OTRA canilla. ' || v::text;
  v := public.pantalla_estado(9999, t921);
  assert v->>'motivo' = 'grifo_desconocido','1c: grifo inexistente. ' || v::text;

  -- ══ 2. Canilla libre: manda la identidad de la cerveza ═══════════════════
  v := public.pantalla_estado(921, t921);
  assert (v->>'ok')::boolean,                            '2a: deberia responder. ' || v::text;
  assert v->'grifo'->>'nombre' = 'test-pantalla',        '2b: nombre. ' || v::text;
  assert v->'grifo'->>'estilo' = 'IPA',                  '2c: estilo. ' || v::text;
  assert v->'grifo'->>'color' = '#c8811f',               '2d: color. ' || v::text;
  assert (v->'grifo'->>'listo')::boolean,                '2e: deberia estar lista. ' || v::text;
  assert v->'sesion' = 'null'::jsonb,                    '2f: sin sesion abierta. ' || v::text;

  -- ══ 3. Con sesión abierta: saldo y tope, con la tarjeta ENMASCARADA ══════
  v := public.abrir_sesion('PANT0001', 921, t921);
  v_ses := (v->>'sesion_id')::bigint;

  v := public.pantalla_estado(921, t921);
  assert v->'sesion'->>'tarjeta' = '····0001',           '3a: la tarjeta va enmascarada. ' || v::text;
  assert (v->'sesion'->>'saldo_centavos')::bigint = 900000, '3b: saldo. ' || v::text;
  -- 900000 centavos / 400000 por litro = 2.25 L
  assert (v->'sesion'->>'ml_maximos')::int = 2250,       '3c: tope. ' || v::text;
  assert (v->'sesion'->>'ml_parcial')::int = 0,          '3d: arranca en cero. ' || v::text;

  -- ══ 4. Avance en vivo ════════════════════════════════════════════════════
  v := public.reportar_progreso(v_ses, 120, 54, t921);
  assert (v->>'ok')::boolean,                            '4a: deberia aceptar. ' || v::text;
  v := public.pantalla_estado(921, t921);
  assert (v->'sesion'->>'ml_parcial')::int = 120,        '4b: la pantalla ve el avance. ' || v::text;

  -- Un reporte que llega tarde y desordenado NO hace retroceder el vaso
  v := public.reportar_progreso(v_ses, 80, 36, t921);
  v := public.pantalla_estado(921, t921);
  assert (v->'sesion'->>'ml_parcial')::int = 120,        '4c: el avance no retrocede. ' || v::text;

  -- Y necesita el token igual que todo lo demás
  v := public.reportar_progreso(v_ses, 500, 226, t922);
  assert v->>'motivo' = 'token_invalido',                '4d: token de otra canilla. ' || v::text;

  -- El avance en vivo NO mueve plata: es informativo
  assert (select saldo_centavos from public.tarjetas where uid = 'PANT0001') = 900000,
         '4e: reportar progreso no tiene que tocar el saldo';

  -- ══ 5. Al cerrar se calcula el MARGEN ════════════════════════════════════
  --     500 ml a 400000/litro = 200000 cobrados
  --     500 ml a 150000/litro =  75000 de costo  -> margen 125000
  v := public.cerrar_sesion(v_ses, 500, 226, t921);
  assert (v->>'costo_centavos')::bigint = 200000,        '5a: cobrado. ' || v::text;
  assert (select costo_producto_centavos from public.sesiones where id = v_ses) = 75000,
         '5b: costo del producto mal calculado';

  -- ══ 6. La pantalla muestra el ticket un rato después de cerrar ═══════════
  v := public.pantalla_estado(921, t921);
  assert v->'sesion' = 'null'::jsonb,                    '6a: ya no hay sesion abierta. ' || v::text;
  assert (v->'ultima'->>'ml_servidos')::int = 500,       '6b: deberia mostrar el ticket. ' || v::text;
  assert v->'ultima'->>'tarjeta' = '····0001',           '6c: tambien enmascarada. ' || v::text;

  -- Pasado el rato, el ticket desaparece solo
  update public.sesiones set cerrada_en = now() - interval '2 minutes' where id = v_ses;
  v := public.pantalla_estado(921, t921);
  assert v->'ultima' = 'null'::jsonb,                    '6d: el ticket viejo no queda pegado. ' || v::text;

  -- ══ 7. Identidad de la cerveza: solo admin ═══════════════════════════════
  insert into auth.users (id, email) values
    ('44444444-4444-4444-4444-444444444444', 'admin.pant@grifo.local'),
    ('55555555-5555-5555-5555-555555555555', 'cajero.pant@grifo.local')
  on conflict (id) do nothing;
  insert into public.personal (user_id, nombre, rol) values
    ('44444444-4444-4444-4444-444444444444', 'Admin', 'admin'),
    ('55555555-5555-5555-5555-555555555555', 'Cajero', 'cajero')
  on conflict (user_id) do update set rol = excluded.rol, activo = true;

  perform set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555"}', true);
  set local role authenticated;
  v := public.admin_actualizar_cerveza(921, p_costo_litro => 1);
  assert v->>'motivo' = 'no_autorizado',                 '7a: un cajero no toca costos. ' || v::text;
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
  set local role authenticated;
  v := public.admin_actualizar_cerveza(921,
         p_costo_litro => 180000, p_estilo => 'IPA sesionable',
         p_abv => 5.4, p_ibu => 45, p_color => '#b8651f');
  assert (v->>'ok')::boolean,                            '7b: deberia actualizar. ' || v::text;
  assert (v->>'margen_litro_centavos')::bigint = 220000, '7c: margen = precio - costo. ' || v::text;

  v := public.admin_actualizar_cerveza(921, p_color => 'rojo');
  assert v->>'motivo' = 'color_invalido',                '7d: color mal formado. ' || v::text;
  v := public.admin_actualizar_cerveza(921, p_costo_litro => -5);
  assert v->>'motivo' = 'costo_invalido',                '7e: costo negativo. ' || v::text;
  reset role;

  -- ══ 8. anon puede lo de la pantalla, y NADA más ══════════════════════════
  begin
    set local role anon;
    perform public.admin_actualizar_cerveza(921, p_costo_litro => 1);
    reset role;
    raise exception 'AGUJERO: la anon key puede cambiar costos';
  exception when insufficient_privilege then reset role; end;

  begin
    set local role anon;
    perform public.pantalla_estado(921, 'x');
    perform public.reportar_progreso(1, 1, 1, 'x');
    reset role;
  exception when insufficient_privilege then
    reset role;
    raise exception 'ROTO: la pantalla no puede llamar a sus propias funciones';
  end;

  -- ══ 9. Vaso de referencia, historial y ranking ═══════════════════════════
  perform set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
  set local role authenticated;
  v := public.admin_actualizar_cerveza(921, p_ml_vaso => 500);
  assert (v->>'ok')::boolean and (v->>'ml_vaso')::int = 500, '9a: vaso. ' || v::text;
  v := public.admin_actualizar_cerveza(921, p_ml_vaso => 0);
  assert v->>'motivo' = 'vaso_invalido',                 '9b: vaso en cero. ' || v::text;
  reset role;

  v := public.pantalla_estado(921, t921);
  assert (v->'grifo'->>'ml_vaso')::int = 500,            '9c: la pantalla ve el vaso. ' || v::text;

  -- Sin nadie en la canilla no hay cliente del que contar historia
  assert v->'cliente' = 'null'::jsonb,                   '9d: sin sesion no hay cliente. ' || v::text;

  -- Con la tarjeta apoyada si: y ya sirvio una vez en el test 5
  v := public.abrir_sesion('PANT0001', 921, t921);
  assert (v->>'ok')::boolean,                            '9e: deberia abrir. ' || v::text;
  v := public.pantalla_estado(921, t921);
  assert (v->'cliente'->>'veces')::int >= 1,             '9f: historial del cliente. ' || v::text;
  assert (v->'cliente'->>'ml_total')::int >= 500,        '9g: ml acumulados. ' || v::text;
  assert not (v->'cliente'->>'es_primera')::boolean,     '9h: no es su primera. ' || v::text;

  -- Ranking del dia, con la tarjeta enmascarada
  assert jsonb_array_length(v->'ranking') >= 1,          '9i: deberia haber ranking. ' || v::text;
  assert v->'ranking'->0->>'tarjeta' = '····0001',       '9j: ranking enmascarado. ' || v::text;

  -- El ranking es POR CANILLA: la 922 no vio nada todavia
  v := public.pantalla_estado(922, t922);
  assert jsonb_array_length(v->'ranking') = 0,           '9k: el ranking no se mezcla entre canillas. ' || v::text;

  raise notice 'TODAS LAS PRUEBAS DE PANTALLA PASARON';
end $$;

select '✅ TODAS LAS PRUEBAS DE PANTALLA PASARON' as resultado;

rollback;
