-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Pruebas de entrega de tarjetas
-- Corre en transacción y hace ROLLBACK: no deja rastro.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'caja_asignar_tarjeta') then
    raise exception E'FALTA CORRER 16-clientes.sql PRIMERO.';
  end if;
end $$;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cajero.alta@grifo.local')
on conflict (id) do nothing;
insert into public.personal (user_id, nombre, rol) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Carla', 'cajero')
on conflict (user_id) do update set rol = excluded.rol, activo = true, nombre = excluded.nombre;

insert into public.tarjetas (uid, saldo_centavos, bloqueada, bloqueada_motivo)
values ('ALTA0009', 0, true, 'se perdió');

do $$
declare
  v      jsonb;
  n      int;
  CAJERO text := '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}';
begin
  -- ══ 1. Sin login no se entrega nada ══════════════════════════════════════
  v := public.caja_asignar_tarjeta('ALTA0001', 'Juan');
  assert v->>'motivo' = 'no_autorizado',    '1: sin login. ' || v::text;

  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;

  -- ══ 2. Validaciones ══════════════════════════════════════════════════════
  v := public.caja_asignar_tarjeta('   ', 'Juan');
  assert v->>'motivo' = 'uid_invalido',     '2a: uid vacio. ' || v::text;
  v := public.caja_asignar_tarjeta('ALTA0001', '   ');
  assert v->>'motivo' = 'falta_nombre',     '2b: nombre vacio. ' || v::text;
  v := public.caja_asignar_tarjeta('ALTA0001', repeat('x', 81));
  assert v->>'motivo' = 'nombre_muy_largo', '2c: nombre larguisimo. ' || v::text;

  -- ══ 3. La tarjeta virgen se da de alta al entregarla ═════════════════════
  -- Las tarjetas no existen en la base hasta que alguien las entrega.
  reset role;
  select count(*) into n from public.tarjetas where uid = 'ALTA0001';
  assert n = 0, '3a: la tarjeta no deberia existir todavia';
  set local role authenticated;

  v := public.caja_asignar_tarjeta('alta0001', '  Juan de la mesa 4  ');
  assert (v->>'ok')::boolean,                    '3b: deberia entregar. ' || v::text;
  assert v->>'uid' = 'ALTA0001',                 '3c: el uid se normaliza a mayusculas. ' || v::text;
  assert v->>'nombre' = 'Juan de la mesa 4',     '3d: el nombre se recorta. ' || v::text;
  assert (v->>'creada')::boolean,                '3e: avisa que la creo. ' || v::text;
  assert v->'nombre_anterior' = 'null'::jsonb,   '3f: no habia nombre antes. ' || v::text;
  assert (v->>'saldo_centavos')::bigint = 0,     '3g: nace en cero. ' || v::text;

  reset role;
  assert (select nota from public.tarjetas where uid = 'ALTA0001') = 'Juan de la mesa 4',
         '3h: el nombre tiene que quedar guardado';
  assert (select asignada_por from public.tarjetas where uid = 'ALTA0001')
         = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
         '3i: tiene que quedar firmada por quien la entrego';
  assert (select asignada_en from public.tarjetas where uid = 'ALTA0001') is not null,
         '3j: tiene que quedar la hora de entrega';
  -- Entregar NO crea plata: la unica puerta al saldo es cargar_saldo.
  select count(*) into n from public.movimientos where uid = 'ALTA0001';
  assert n = 0, '3k: entregar no puede asentar movimientos';
  set local role authenticated;

  -- ══ 4. Reentregar avisa a nombre de quien estaba ═════════════════════════
  v := public.caja_asignar_tarjeta('ALTA0001', 'Marta');
  assert (v->>'ok')::boolean,                        '4a: deberia dejar. ' || v::text;
  assert v->>'nombre_anterior' = 'Juan de la mesa 4','4b: informa el anterior. ' || v::text;
  assert not (v->>'creada')::boolean,                '4c: ya existia. ' || v::text;

  reset role;
  assert (select nota from public.tarjetas where uid = 'ALTA0001') = 'Marta',
         '4d: el nombre nuevo pisa al anterior';
  set local role authenticated;

  -- ══ 5. Una tarjeta bloqueada no se entrega ═══════════════════════════════
  v := public.caja_asignar_tarjeta('ALTA0009', 'Pedro');
  assert v->>'motivo' = 'tarjeta_bloqueada', '5a: no se entrega bloqueada. ' || v::text;
  reset role;
  assert (select nota from public.tarjetas where uid = 'ALTA0009') is null,
         '5b: no le puso el nombre igual';
  set local role authenticated;

  -- ══ 6. Entregar + cargar + devolver, el ciclo completo ═══════════════════
  v := public.caja_asignar_tarjeta('ALTA0002', 'Sofia');
  assert (v->>'ok')::boolean, '6a: entrega. ' || v::text;

  v := public.caja_cargar_saldo('ALTA0002', 500000, 'efectivo');
  assert (v->>'ok')::boolean, '6b: carga. ' || v::text;

  v := public.caja_devolver_tarjeta('ALTA0002');
  assert (v->>'ok')::boolean,                        '6c: devolucion. ' || v::text;
  assert (v->>'devuelto_centavos')::bigint = 500000, '6d: devuelve lo cargado. ' || v::text;
  assert v->>'cliente' = 'Sofia',                    '6e: dice de quien era. ' || v::text;

  reset role;
  assert (select nota from public.tarjetas where uid = 'ALTA0002') is null,
         '6f: la tarjeta vuelve libre a la pila';
  -- La entrega es historial, no estado: no se borra al devolver.
  assert (select asignada_en from public.tarjetas where uid = 'ALTA0002') is not null,
         '6g: la fecha de entrega queda como historial';
  set local role authenticated;

  -- Y se puede volver a entregar al siguiente cliente.
  v := public.caja_asignar_tarjeta('ALTA0002', 'Nicolas');
  assert (v->>'ok')::boolean,                   '6h: reentrega. ' || v::text;
  assert v->'nombre_anterior' = 'null'::jsonb,  '6i: sin dueno tras la devolucion. ' || v::text;

  -- ══ 7. anon no llega ═════════════════════════════════════════════════════
  reset role;
  begin
    set local role anon;
    perform public.caja_asignar_tarjeta('ALTA0003', 'Intruso');
    reset role;
    raise exception 'AGUJERO: la anon key puede dar de alta tarjetas';
  exception when insufficient_privilege then reset role; end;

  reset role;
  raise notice 'TODAS LAS PRUEBAS DE CLIENTES PASARON';
end $$;

select '✅ TODAS LAS PRUEBAS DE CLIENTES PASARON' as resultado;

rollback;
