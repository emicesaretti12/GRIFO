-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Pruebas de convivencia con SEN POS
--
-- Comprueba que el sistema de canillas y el POS, sobre la MISMA base, no se
-- pisan:
--   1. Lo que cobra la caja de canillas entra al turno de caja del POS, y el
--      arqueo ciego del POS cierra en cero.
--   2. Una devolución de saldo sale del cajón de ese turno.
--   3. La billetera de la app del POS pide un QR y la tablet abre la canilla.
--   4. El control de integridad del POS no encuentra nada roto.
--
-- Si el POS no está instalado, no hace nada. Corre en transacción con
-- ROLLBACK: no deja rastro.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if to_regprocedure('public.pos_abrir_turno(bigint,bigint)') is null then
    raise notice 'SEN POS no está instalado: no hay nada que probar acá.';
  end if;
end $$;

insert into auth.users (id, email) values
  ('88888888-8888-8888-8888-888888888881', 'cajera.pos@grifo.local'),
  ('88888888-8888-8888-8888-888888888882', 'gerente.pos@grifo.local'),
  ('88888888-8888-8888-8888-888888888883', 'cliente.app@grifo.local')
on conflict (id) do nothing;
insert into public.personal (user_id, nombre, rol) values
  ('88888888-8888-8888-8888-888888888881', 'Cata', 'cajero'),
  ('88888888-8888-8888-8888-888888888882', 'Gabi', 'admin')
on conflict (user_id) do update set rol = excluded.rol, activo = true;

insert into public.grifos (id, nombre, precio_litro_centavos, pulsos_por_litro, ml_minimos, activo)
values (961, 'test-con-pos', 400000, 452.700, 50, true)
on conflict (id) do nothing;

do $$
declare
  v       jsonb;
  t961    text;
  v_turno bigint;
  v_uid   text;
  v_app   text;
  n       bigint;
  CAJERA  text := '{"sub":"88888888-8888-8888-8888-888888888881"}';
  GERENTE text := '{"sub":"88888888-8888-8888-8888-888888888882"}';
  CLIENTE text := '{"sub":"88888888-8888-8888-8888-888888888883"}';
begin
  if to_regprocedure('public.pos_abrir_turno(bigint,bigint)') is null then
    return;
  end if;

  t961 := public.rotar_token_grifo(961) ->> 'token';
  perform public.canilla_latido(961, t961);

  -- Sin turnos abiertos de antes: esta prueba mira solo el suyo.
  execute 'update public.turnos_caja set estado = ''cerrado'', cerrado_en = now() where estado = ''abierto''';
  execute 'insert into public.cajas (nombre) select ''Caja de prueba'' where not exists (select 1 from public.cajas where activa)';

  -- ══ 1. Lo que cobra la caja de canillas entra al turno del POS ═══════════
  perform set_config('request.jwt.claims', CAJERA, true);
  set local role authenticated;

  v := public.caja_vender('29111222', 'Ana Prueba', 800000, 'efectivo', 'pos-1');
  assert v->>'motivo' = 'sin_turno_abierto', '1a: sin turno no se cobra. ' || v::text;

  execute 'select public.pos_abrir_turno(1000000)' into v;    -- $ 10.000 de cambio
  assert (v->>'ok')::boolean, '1b: abre el turno. ' || v::text;
  v_turno := (v->>'turno_id')::bigint;

  v := public.caja_vender('29111222', 'Ana Prueba', 800000, 'efectivo', 'pos-2');
  assert (v->>'ok')::boolean, '1c: vende en efectivo. ' || v::text;
  v_uid := v->>'uid';
  v := public.caja_vender('29111222', 'Ana Prueba', 300000, 'debito', 'pos-3');
  assert (v->>'ok')::boolean, '1d: vende con débito. ' || v::text;
  v := public.caja_vender('29111222', 'Ana Prueba', 200000, 'mercadopago', 'pos-4');
  assert (v->>'ok')::boolean, '1e: vende con el QR de Mercado Pago del mostrador. ' || v::text;
  -- El reintento de la misma venta no asienta dos veces en el turno.
  v := public.caja_vender('29111222', 'Ana Prueba', 800000, 'efectivo', 'pos-2');
  assert (v->>'repetida')::boolean, '1f: repetida. ' || v::text;
  reset role;

  execute 'select count(*) from public.caja_movimientos where turno_id = $1 and tipo = ''carga_billetera'''
     into n using v_turno;
  assert n = 3, '1g: tres cargas en el turno, sin duplicar. Hay ' || n;
  execute 'select count(*) from public.caja_movimientos where turno_id = $1 and tipo = ''carga_billetera'' and medio = ''qr_mp'''
     into n using v_turno;
  assert n = 1, '1h: Mercado Pago del mostrador figura como qr_mp en el POS';
  assert (select medio_pago from public.movimientos where clave_idempotencia = 'venta:pos-4') = 'mercadopago',
         '1i: y como mercadopago en el libro de las canillas';

  -- ══ 2. La devolución sale del cajón del turno ════════════════════════════
  perform set_config('request.jwt.claims', CAJERA, true);
  set local role authenticated;
  v := public.caja_devolver_tarjeta(v_uid, 'se va');
  assert (v->>'ok')::boolean and (v->>'devuelto_centavos')::bigint = 1300000,
         '2a: devuelve todo. ' || v::text;
  reset role;
  execute 'select coalesce(sum(centavos), 0) from public.caja_movimientos where turno_id = $1 and tipo = ''egreso'''
     into n using v_turno;
  assert n = 1300000, '2b: la devolución es un egreso del turno. Hay ' || n;

  -- El arqueo ciego cierra en cero: en el cajón hay cambio + efectivo − devolución.
  --   10.000 + 8.000 − 13.000 = 5.000 en efectivo; 3.000 en débito; 2.000 en QR.
  perform set_config('request.jwt.claims', CAJERA, true);
  set local role authenticated;
  execute 'select public.pos_cerrar_turno($1)' into v
    using '{"efectivo": 500000, "debito": 300000, "qr_mp": 200000}'::jsonb;
  reset role;
  assert (v->>'ok')::boolean, '2c: cierra el turno. ' || v::text;
  assert (v->>'diferencia_centavos')::bigint = 0,
         '2d: AGUJERO: el arqueo del POS no cuadra con lo que cobró la caja de canillas. ' || v::text;

  -- ══ 3. La billetera de la app del POS abre una canilla con su QR ═════════
  perform set_config('request.jwt.claims', CLIENTE, true);
  set local role authenticated;
  v := public.app_generar_pase();
  assert v->>'motivo' = 'sin_billetera', '3a: sin registrarse no hay QR. ' || v::text;
  execute 'select public.app_registrar(''Lu Cliente'')' into v;
  assert (v->>'ok')::boolean, '3b: se registra en la app del POS. ' || v::text;
  v_app := v->>'uid';
  v := public.app_generar_pase();
  assert (v->>'ok')::boolean and v->>'codigo' ~ '^GRIFO:[0-9A-F]{32}$' and v->>'codigo_corto' ~ '^\d{6}$',
         '3c: QR temporal. ' || v::text;
  reset role;

  -- Sin saldo, la tablet no abre.
  v := public.tablet_abrir_sesion_qr(v->>'codigo', 961, t961);
  assert v->>'motivo' = 'sin_saldo', '3d: sin saldo no abre. ' || v::text;

  -- La caja la encuentra por el código de 6 números y le carga, dentro del turno.
  perform set_config('request.jwt.claims', CAJERA, true);
  set local role authenticated;
  execute 'select public.pos_abrir_turno(0)' into v;
  perform set_config('request.jwt.claims', CLIENTE, true);
  v := public.app_generar_pase();
  perform set_config('request.jwt.claims', CAJERA, true);
  v := public.caja_buscar_por_codigo(v->>'codigo_corto');
  assert (v->>'ok')::boolean and v->>'uid' = v_app, '3e: la caja encuentra la billetera del POS por el código. ' || v::text;
  v := public.caja_cargar(v_app, 500000, 'efectivo', 'pos-app-1');
  assert (v->>'ok')::boolean, '3f: le carga. ' || v::text;

  perform set_config('request.jwt.claims', CLIENTE, true);
  v := public.app_generar_pase();
  reset role;
  v := public.tablet_abrir_sesion_qr(v->>'codigo', 961, t961);
  assert (v->>'ok')::boolean and v->>'origen' = 'app',
         '3g: la billetera del POS abre la canilla. ' || v::text;
  assert public.pantalla_estado(961, t961)->'sesion'->>'nombre' = 'Lu',
         '3g2: la pantalla la saluda por el nombre que puso en la app del POS';
  v := public.cerrar_sesion((v->>'sesion_id')::bigint, 300, 136, t961);
  assert (v->>'ok')::boolean and (v->>'costo_centavos')::bigint = 120000, '3h: cobra. ' || v::text;

  -- Lo ve en su billetera del POS: saldo y tirada.
  perform set_config('request.jwt.claims', CLIENTE, true);
  set local role authenticated;
  execute 'select public.app_mi_billetera()' into v;
  reset role;
  assert (v->>'saldo_centavos')::bigint = 380000
     and jsonb_array_length(v->'tiradas') = 1, '3i: la billetera del POS lo muestra. ' || v::text;

  -- ══ 4. El control de integridad del POS no encuentra nada roto ══════════
  perform set_config('request.jwt.claims', GERENTE, true);
  set local role authenticated;
  execute 'select public.pos_verificar_integridad()' into v;
  reset role;
  -- Solo se miran los hallazgos de lo que hizo esta prueba (en una base de
  -- verdad puede haber tarjetas viejas de prueba sin movimiento inicial).
  assert not exists (
    select 1 from jsonb_array_elements(v) e
     where e->>'detalle' like '%' || v_uid || '%' or e->>'detalle' like '%' || v_app || '%'
        or e->>'control' in ('caja', 'turnos', 'pagos_online')),
    '4: AGUJERO: el POS encuentra algo descuadrado. ' || v::text;
end $$;

select '✅ TODAS LAS PRUEBAS DE CONVIVENCIA CON EL POS PASARON' as resultado;

rollback;
