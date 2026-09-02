-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Pruebas de roles y permisos de la app de gestión
--
-- Pegar en el editor SQL de Supabase y ejecutar. Corre en una transacción que
-- termina en ROLLBACK: crea sus propios usuarios de prueba y no deja rastro.
--
-- Verifica lo que de verdad importa: que un cajero NO pueda hacer cosas de
-- admin ni leerse las tablas por la API, aunque sepa exactamente cómo pedirlas.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

-- Usuarios de prueba
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'cajero.test@grifo.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin.test@grifo.local'),
  ('33333333-3333-3333-3333-333333333333', 'random.test@grifo.local')
on conflict (id) do nothing;

insert into public.personal (user_id, nombre, rol) values
  ('11111111-1111-1111-1111-111111111111', 'Cajero Test', 'cajero'),
  ('22222222-2222-2222-2222-222222222222', 'Admin Test',  'admin')
on conflict (user_id) do update set rol = excluded.rol, activo = true;
-- El tercero queda logueado pero SIN ficha en personal: no es del personal.

insert into public.grifos (id, nombre, precio_litro_centavos, pulsos_por_litro, ml_minimos, activo)
values (911, 'test-gestion', 300000, 452.700, 50, false)
on conflict (id) do nothing;

do $$
declare
  v      jsonb;
  n      int;
  CAJERO text := '{"sub":"11111111-1111-1111-1111-111111111111"}';
  ADMIN  text := '{"sub":"22222222-2222-2222-2222-222222222222"}';
  RANDOM text := '{"sub":"33333333-3333-3333-3333-333333333333"}';
begin
  -- ══ 1. Un usuario logueado SIN ficha de personal no puede nada ═══════════
  perform set_config('request.jwt.claims', RANDOM, true);
  set local role authenticated;
  v := public.caja_buscar_tarjeta('A1B2C3D4');
  assert v->>'motivo' = 'no_autorizado',        '1a: un random no deberia consultar. ' || v::text;
  v := public.caja_cargar_saldo('A1B2C3D4', 100000);
  assert v->>'motivo' = 'no_autorizado',        '1b: un random no deberia cargar saldo. ' || v::text;
  reset role;

  -- ══ 2. El cajero hace lo suyo ════════════════════════════════════════════
  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;

  assert public.mi_rol() = 'cajero',            '2a: rol mal detectado';
  assert public.es_personal(),                  '2b: deberia ser personal';
  assert not public.es_admin(),                 '2c: NO deberia ser admin';

  v := public.caja_buscar_tarjeta('A1B2C3D4');
  assert (v->>'ok')::boolean,                   '2d: deberia poder consultar. ' || v::text;
  assert (v->>'existe')::boolean,               '2e: la tarjeta existe. ' || v::text;

  -- Tarjeta que no existe: no es error, es una tarjeta nueva
  v := public.caja_buscar_tarjeta('NUEVA0001');
  assert (v->>'ok')::boolean and not (v->>'existe')::boolean,
                                                '2f: tarjeta nueva. ' || v::text;

  v := public.caja_cargar_saldo('NUEVA0001', 300000, 'ticket-test');
  assert (v->>'ok')::boolean,                   '2g: deberia cargar. ' || v::text;
  assert (v->>'tarjeta_creada')::boolean,       '2h: deberia dar de alta la tarjeta. ' || v::text;

  v := public.caja_bloquear_tarjeta('NUEVA0001', true, 'se perdio');
  assert (v->>'ok')::boolean and (v->>'bloqueada')::boolean,
                                                '2i: deberia bloquear. ' || v::text;
  reset role;

  -- El movimiento quedó firmado por el cajero
  assert (select hecho_por from public.movimientos where uid = 'NUEVA0001' and tipo = 'carga')
         = '11111111-1111-1111-1111-111111111111',
         '2j: el movimiento tendria que quedar firmado por quien lo hizo';

  -- ══ 3. El cajero NO puede leerse las tablas por la API ═══════════════════
  --     Esto es lo que impide que se baje el padron de tarjetas o se sume la
  --     facturacion del dia. No alcanza con esconder el boton en la pantalla.
  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;
  select count(*) into n from public.tarjetas;
  assert n = 0,  '3a: el cajero NO tendria que ver filas de tarjetas (vio ' || n || ')';
  select count(*) into n from public.movimientos;
  assert n = 0,  '3b: el cajero NO tendria que ver movimientos (vio ' || n || ')';
  select count(*) into n from public.sesiones;
  assert n = 0,  '3c: el cajero NO tendria que ver sesiones (vio ' || n || ')';
  -- Los grifos SI los ve: necesita saber que canilla esta activa
  select count(*) into n from public.grifos;
  assert n > 0,  '3d: el cajero SI tendria que ver los grifos';
  reset role;

  -- ══ 4. El cajero NO puede hacer cosas de admin ═══════════════════════════
  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;
  v := public.admin_actualizar_grifo(911, p_precio_litro => 1);
  assert v->>'motivo' = 'no_autorizado',        '4a: un cajero no puede tocar precios. ' || v::text;
  v := public.admin_rotar_token(911);
  assert v->>'motivo' = 'no_autorizado',        '4b: un cajero no puede rotar tokens. ' || v::text;
  v := public.admin_set_rol('random.test@grifo.local', 'admin');
  assert v->>'motivo' = 'no_autorizado',        '4c: un cajero no puede hacerse admin. ' || v::text;
  reset role;

  assert (select precio_litro_centavos from public.grifos where id = 911) = 300000,
         '4d: el precio no tendria que haber cambiado';

  -- ══ 5. El admin sí lee las tablas ════════════════════════════════════════
  perform set_config('request.jwt.claims', ADMIN, true);
  set local role authenticated;
  assert public.es_admin(),                     '5a: deberia ser admin';
  select count(*) into n from public.tarjetas;
  assert n > 0,  '5b: el admin tendria que ver las tarjetas';
  select count(*) into n from public.movimientos;
  assert n > 0,  '5c: el admin tendria que ver los movimientos';
  reset role;

  -- ══ 6. El admin administra ═══════════════════════════════════════════════
  perform set_config('request.jwt.claims', ADMIN, true);
  set local role authenticated;

  v := public.admin_actualizar_grifo(911, p_precio_litro => 450000, p_nombre => 'test-renombrado');
  assert (v->>'ok')::boolean,                            '6a: deberia actualizar. ' || v::text;
  assert (v->>'precio_litro_centavos')::bigint = 450000, '6b: precio. ' || v::text;

  v := public.admin_actualizar_grifo(911, p_precio_litro => 0);
  assert v->>'motivo' = 'precio_invalido',               '6c: no deberia aceptar precio 0. ' || v::text;

  -- No se puede activar un grifo sin token: quedaria "en servicio" sin poder operar
  v := public.admin_actualizar_grifo(911, p_activo => true);
  assert v->>'motivo' = 'sin_token',                     '6d: no deberia activar sin token. ' || v::text;

  v := public.admin_rotar_token(911);
  assert (v->>'ok')::boolean and length(v->>'token') = 64, '6e: deberia rotar. ' || v::text;

  -- Ahora sí
  v := public.admin_actualizar_grifo(911, p_activo => true);
  assert (v->>'ok')::boolean and (v->>'activo')::boolean, '6f: ahora si deberia activar. ' || v::text;
  reset role;

  -- ══ 7. Alta y baja de personal ═══════════════════════════════════════════
  perform set_config('request.jwt.claims', ADMIN, true);
  set local role authenticated;

  v := public.admin_set_rol('random.test@grifo.local', 'cajero', 'Nuevo Cajero');
  assert (v->>'ok')::boolean,                   '7a: deberia dar de alta. ' || v::text;

  v := public.admin_set_rol('noexiste@grifo.local', 'cajero');
  assert v->>'motivo' = 'usuario_inexistente',  '7b: motivo. ' || v::text;

  v := public.admin_set_rol('random.test@grifo.local', 'dueño');
  assert v->>'motivo' = 'rol_invalido',         '7c: rol inventado. ' || v::text;

  -- Un admin no puede darse de baja a si mismo y dejar el sistema sin admin
  v := public.admin_baja_personal('admin.test@grifo.local');
  assert v->>'motivo' = 'no_podes_darte_de_baja_solo', '7d: motivo. ' || v::text;

  v := public.admin_baja_personal('random.test@grifo.local');
  assert (v->>'ok')::boolean,                   '7e: deberia dar de baja. ' || v::text;
  reset role;

  -- Dado de baja = como si no fuera del personal
  perform set_config('request.jwt.claims', RANDOM, true);
  set local role authenticated;
  v := public.caja_buscar_tarjeta('A1B2C3D4');
  assert v->>'motivo' = 'no_autorizado',        '7f: un dado de baja no deberia operar. ' || v::text;
  reset role;

  -- ══ 8. anon (el ESP32) sigue sin poder nada de esto ══════════════════════
  begin
    set local role anon;
    perform public.caja_cargar_saldo('A1B2C3D4', 100000);
    reset role;
    raise exception 'AGUJERO GRAVISIMO: la anon key puede cargar saldo';
  exception when insufficient_privilege then reset role; end;

  begin
    set local role anon;
    perform public.admin_rotar_token(911);
    reset role;
    raise exception 'AGUJERO GRAVE: la anon key puede rotar tokens';
  exception when insufficient_privilege then reset role; end;

  raise notice 'TODAS LAS PRUEBAS DE PERSONAL PASARON';
end $$;

select '✅ TODAS LAS PRUEBAS DE PERSONAL PASARON' as resultado;

rollback;
