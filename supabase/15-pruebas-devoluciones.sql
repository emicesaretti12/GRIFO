-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Pruebas de devolución de tarjeta y arqueo de turno
-- Corre en transacción y hace ROLLBACK: no deja rastro.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname='public' and p.proname='caja_devolver_tarjeta') then
    raise exception E'FALTA CORRER 14-devoluciones.sql PRIMERO.';
  end if;
end $$;

insert into public.grifos (id, nombre, precio_litro_centavos, costo_litro_centavos,
                           pulsos_por_litro, ml_minimos, ml_vaso, activo)
values (941, 'test-devol', 400000, 150000, 452.700, 50, 500, true);

insert into public.tarjetas (uid, saldo_centavos, nota) values
  ('DEVO0001', 500000, 'Juan de la mesa 4'),
  ('DEVO0002', 0,      'Ya gastó todo'),
  ('DEVO0003', 800000, 'Sirviendo ahora');

insert into auth.users (id, email) values
  ('88888888-8888-8888-8888-888888888888', 'admin.devol@grifo.local'),
  ('99999999-9999-9999-9999-999999999999', 'cajero.devol@grifo.local')
on conflict (id) do nothing;
insert into public.personal (user_id, nombre, rol) values
  ('88888888-8888-8888-8888-888888888888', 'Ana',  'admin'),
  ('99999999-9999-9999-9999-999999999999', 'Beto', 'cajero')
on conflict (user_id) do update set rol = excluded.rol, activo = true, nombre = excluded.nombre;

do $$
declare
  v      jsonb;
  a      jsonb;
  t941   text;
  v_ses  bigint;
  n      int;
  ADMIN  text := '{"sub":"88888888-8888-8888-8888-888888888888"}';
  CAJERO text := '{"sub":"99999999-9999-9999-9999-999999999999"}';
  T0     timestamptz := now();
begin
  t941 := public.rotar_token_grifo(941) ->> 'token';

  -- ══ 1. Sin sesión de personal, no se devuelve nada ═══════════════════════
  v := public.caja_devolver_tarjeta('DEVO0001');
  assert v->>'motivo' = 'no_autorizado',      '1a: sin login no se devuelve. ' || v::text;

  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;

  v := public.caja_devolver_tarjeta('   ');
  assert v->>'motivo' = 'uid_invalido',       '1b: uid vacio. ' || v::text;
  v := public.caja_devolver_tarjeta('NOEXISTE');
  assert v->>'motivo' = 'tarjeta_desconocida','1c: tarjeta inexistente. ' || v::text;

  -- ══ 2. Devolución normal ═════════════════════════════════════════════════
  v := public.caja_devolver_tarjeta('DEVO0001', 'se va del bar');
  assert (v->>'ok')::boolean,                        '2a: deberia devolver. ' || v::text;
  assert (v->>'devuelto_centavos')::bigint = 500000, '2b: devuelve todo el saldo. ' || v::text;
  assert (v->>'saldo_centavos')::bigint = 0,         '2c: queda en cero. ' || v::text;
  assert v->>'cliente' = 'Juan de la mesa 4',        '2d: informa de quien era. ' || v::text;

  -- Para mirar las tablas directo hay que salir del rol authenticated: con RLS
  -- activo y sin policies, authenticated no ve ni una fila. Que ESO sea así es
  -- justamente lo que prueba 05-permisos.sql.
  reset role;
  assert (select saldo_centavos from public.tarjetas where uid = 'DEVO0001') = 0,
         '2e: la tarjeta tiene que quedar en cero';
  -- La nota se limpia: el nombre del cliente anterior no viaja al proximo.
  assert (select nota from public.tarjetas where uid = 'DEVO0001') is null,
         '2f: la nota tiene que quedar limpia';

  -- Queda asentado en el libro mayor, con tipo propio y firmado.
  select count(*) into n from public.movimientos
   where uid = 'DEVO0001' and tipo = 'devolucion'
     and centavos = -500000 and saldo_resultante = 0
     and motivo = 'se va del bar'
     and hecho_por = '99999999-9999-9999-9999-999999999999';
  assert n = 1, '2g: falta el asiento de devolucion firmado';
  set local role authenticated;

  -- ══ 3. Devolver dos veces no paga dos veces ══════════════════════════════
  v := public.caja_devolver_tarjeta('DEVO0001');
  assert (v->>'ok')::boolean,                        '3a: la segunda no es un error. ' || v::text;
  assert (v->>'devuelto_centavos')::bigint = 0,      '3b: no devuelve de nuevo. ' || v::text;
  assert (v->>'nada_que_devolver')::boolean,         '3c: lo dice explicito. ' || v::text;
  reset role;
  select count(*) into n from public.movimientos
   where uid = 'DEVO0001' and tipo = 'devolucion';
  assert n = 1, '3d: no puede haber dos asientos de devolucion';
  set local role authenticated;

  -- ══ 4. Tarjeta en cero: se limpia igual, sin asiento ═════════════════════
  v := public.caja_devolver_tarjeta('DEVO0002');
  assert (v->>'ok')::boolean,                   '4a: deberia aceptar. ' || v::text;
  assert (v->>'devuelto_centavos')::bigint = 0, '4b: no habia nada. ' || v::text;
  reset role;
  assert (select nota from public.tarjetas where uid = 'DEVO0002') is null,
         '4c: la nota se limpia igual';
  select count(*) into n from public.movimientos where uid = 'DEVO0002';
  assert n = 0, '4d: sin plata no hay asiento';
  set local role authenticated;

  -- ══ 5. Con la tarjeta apoyada en un grifo, NO se devuelve ════════════════
  reset role;
  v := public.abrir_sesion('DEVO0003', 941, t941);
  assert (v->>'ok')::boolean, '5a: deberia abrir sesion. ' || v::text;
  v_ses := (v->>'sesion_id')::bigint;

  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;
  v := public.caja_devolver_tarjeta('DEVO0003');
  assert v->>'motivo' = 'sesion_abierta',      '5b: no se devuelve sirviendo. ' || v::text;
  assert (v->>'sesion_id')::bigint = v_ses,    '5c: dice cual sesion. ' || v::text;
  reset role;
  assert (select saldo_centavos from public.tarjetas where uid = 'DEVO0003') = 800000,
         '5d: el saldo no se toco';

  -- Cerrada la sesion, ahora si.
  v := public.cerrar_sesion(v_ses, 500, 226, t941);   -- 500 ml a $4000/L = $2000
  assert (v->>'ok')::boolean, '5e: deberia cerrar. ' || v::text;

  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;
  v := public.caja_devolver_tarjeta('DEVO0003');
  assert (v->>'ok')::boolean,                        '5f: ahora si. ' || v::text;
  assert (v->>'devuelto_centavos')::bigint = 600000, '5g: 8000 - 2000 = 6000. ' || v::text;

  -- ══ 6. Arqueo: cuadra contra lo que pasó en el turno ═════════════════════
  a := public.arqueo(T0, now() + interval '1 minute');
  assert (a->>'ok')::boolean, '6a: el arqueo deberia salir. ' || a::text;

  -- Se devolvieron 5000 + 6000 = 11000 pesos, en dos asientos.
  assert (a->>'devoluciones_centavos')::bigint = 1100000,
         '6b: total devuelto. ' || a::text;
  assert (a->>'devoluciones_cantidad')::int = 2,
         '6c: dos devoluciones. ' || a::text;

  -- El neto de caja = cargas - devoluciones. Acá no hubo cargas por RPC (el
  -- saldo se sembró con INSERT), así que el neto es negativo: salió plata.
  assert (a->>'neto_caja_centavos')::bigint = -1100000,
         '6d: neto de caja. ' || a::text;

  assert (a->>'sesiones_abiertas')::int = 0, '6e: no quedan sesiones colgadas. ' || a::text;

  -- ══ 7. El cajero cuadra el cajón, pero NO ve cuánto gana el bar ══════════
  -- Misma razón por la que no tiene SELECT sobre las tablas: puede necesitar
  -- cerrar su turno sin por eso tener que saber el margen del negocio.
  assert a->'consumo' is null,                       '7a: el cajero no ve el consumo. ' || a::text;
  assert a->'margen_centavos' is null,               '7b: el cajero no ve el margen. ' || a::text;
  assert a->'saldo_en_circulacion_centavos' is null, '7c: el cajero no ve el pasivo. ' || a::text;
  assert a->'por_persona' is null,                   '7d: el cajero no ve a los demás. ' || a::text;
  assert not (a->>'es_admin')::boolean,              '7e: se declara como no-admin. ' || a::text;

  -- ══ 8. El arqueo valida el rango ═════════════════════════════════════════
  a := public.arqueo(now(), now() - interval '1 hour');
  assert a->>'motivo' = 'rango_invalido', '8: el rango al reves se rechaza. ' || a::text;

  -- ══ 9. El admin sí ve el negocio completo ════════════════════════════════
  perform set_config('request.jwt.claims', ADMIN, true);
  a := public.arqueo(T0, now() + interval '1 minute');
  assert (a->>'ok')::boolean,             '9a: el admin ve el arqueo. ' || a::text;
  assert (a->>'es_admin')::boolean,       '9b: se declara admin. ' || a::text;

  -- El consumo: 500 ml facturados a 2000, con costo 750.
  assert (a->'consumo'->>'ml')::bigint = 500,               '9c: ml servidos. ' || a::text;
  assert (a->'consumo'->>'centavos')::bigint = 200000,      '9d: facturado. ' || a::text;
  assert (a->'consumo'->>'costo_centavos')::bigint = 75000, '9e: costo. ' || a::text;
  assert (a->>'margen_centavos')::bigint = 125000,          '9f: margen. ' || a::text;

  -- Y el desglose por persona: sin esto el arqueo dice que falta plata pero no
  -- dónde mirar.
  assert exists (
    select 1 from jsonb_array_elements(a->'por_persona') e
     where e->>'nombre' = 'Beto' and (e->>'devoluciones')::bigint = 1100000
  ), '9g: las devoluciones tienen que aparecer a nombre de Beto. ' || (a->'por_persona')::text;

  -- ══ 10. anon no llega a nada de esto ═════════════════════════════════════
  reset role;
  begin
    set local role anon;
    perform public.caja_devolver_tarjeta('DEVO0003');
    reset role;
    raise exception 'AGUJERO GRAVISIMO: la anon key puede vaciar tarjetas';
  exception when insufficient_privilege then reset role; end;

  begin
    set local role anon;
    perform public.arqueo();
    reset role;
    raise exception 'AGUJERO: la anon key puede leer la caja del dia';
  exception when insufficient_privilege then reset role; end;

  reset role;
  raise notice 'TODAS LAS PRUEBAS DE DEVOLUCIONES PASARON';
end $$;

select '✅ TODAS LAS PRUEBAS DE DEVOLUCIONES PASARON' as resultado;

rollback;
