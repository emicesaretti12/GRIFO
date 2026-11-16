-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Pruebas de la carga por Mercado Pago (la mitad que vive en la base)
-- Corre en transacción y hace ROLLBACK: no deja rastro.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'pago_acreditar') then
    raise exception E'FALTA CORRER 31-mercadopago.sql PRIMERO.';
  end if;
end $$;

insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666661', 'admin.mp@grifo.local')
on conflict (id) do nothing;
insert into public.personal (user_id, nombre, rol) values
  ('66666666-6666-6666-6666-666666666661', 'Ana', 'admin')
on conflict (user_id) do update set rol = excluded.rol, activo = true, nombre = excluded.nombre;

do $$
declare
  v      jsonb;
  n      int;
  v_pago uuid;
  v_otro uuid;
  v_uid  text;
  T0     timestamptz := now();
  CEL    text := repeat('d', 64);
  CEL2   text := repeat('e', 64);
  ADMIN  text := '{"sub":"66666666-6666-6666-6666-666666666661"}';
begin
  v := public.cliente_entrar('31222333', 'Sofi Mendez', CEL);
  assert (v->>'ok')::boolean, '0: alta del cliente. ' || v::text;
  select uid into v_uid from public.clientes_qr where dni = '31222333' and tipo = 'app';
  v := public.cliente_entrar('32444555', 'Tomi Ruiz', CEL2);

  -- ══ 1. Nadie de afuera toca los pagos ════════════════════════════════════
  -- Si la app pudiera llamar a pago_acreditar, cualquiera se cargaría saldo
  -- gratis desde la consola del navegador.
  set local role anon;
  begin
    perform public.pago_acreditar(gen_random_uuid(), '1', 100000);
    raise exception '1a: AGUJERO GRAVE: anon puede acreditarse un pago';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.pago_crear('31222333', CEL, 100000);
    raise exception '1b: AGUJERO: anon crea pagos sin pasar por la función del servidor';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform set_config('request.jwt.claims', ADMIN, true);
  set local role authenticated;
  begin
    perform public.pago_acreditar(gen_random_uuid(), '1', 100000);
    raise exception '1c: AGUJERO GRAVE: un logueado puede acreditarse un pago';
  exception when insufficient_privilege then null;
  end;
  reset role;

  set local role service_role;

  -- ══ 2. Crear el intento: solo el dueño de la cuenta, y con un monto sano ═
  v := public.pago_crear('31222333', repeat('x', 64), 500000);
  assert v->>'motivo' = 'sesion_invalida',      '2a: otro celular. ' || v::text;
  v := public.pago_crear('31222333', CEL, 50000);
  assert v->>'motivo' = 'monto_fuera_de_rango', '2b: menos del mínimo. ' || v::text;
  v := public.pago_crear('31222333', CEL, 99999900);
  assert v->>'motivo' = 'monto_fuera_de_rango', '2c: más del máximo. ' || v::text;
  v := public.pago_crear('31222333', CEL, 500050);
  assert v->>'motivo' = 'monto_fuera_de_rango', '2d: con centavos sueltos. ' || v::text;

  v := public.pago_crear('31222333', CEL, 500000);
  assert (v->>'ok')::boolean and v->>'nombre' = 'Sofi Mendez', '2e: crea. ' || v::text;
  v_pago := (v->>'pago_id')::uuid;
  v := public.pago_anotar_preferencia(v_pago, 'pref-123');
  assert (v->>'ok')::boolean, '2f: anota la preferencia. ' || v::text;

  -- Crear el intento no mueve un centavo.
  assert (select saldo_centavos from public.tarjetas where uid = v_uid) = 0,
         '2g: AGUJERO: crear el pago ya dio saldo';

  -- ══ 3. Mercado Pago confirmó: se acredita ════════════════════════════════
  v := public.pago_acreditar(gen_random_uuid(), 'MP-1', 500000);
  assert v->>'motivo' = 'pago_desconocido', '3a: pago que no existe. ' || v::text;
  v := public.pago_acreditar(v_pago, '', 500000);
  assert v->>'motivo' = 'datos_invalidos',  '3b: sin id de Mercado Pago. ' || v::text;

  v := public.pago_acreditar(v_pago, 'MP-1', 500000);
  assert (v->>'ok')::boolean and not (v->>'repetida')::boolean
     and (v->>'saldo_centavos')::bigint = 500000, '3c: acredita. ' || v::text;

  -- ══ 4. El aviso llega tres veces: se acredita UNA ════════════════════════
  v := public.pago_acreditar(v_pago, 'MP-1', 500000);
  assert (v->>'ok')::boolean and (v->>'repetida')::boolean, '4a: repetida. ' || v::text;
  v := public.pago_acreditar(v_pago, 'MP-1', 500000);
  assert (select saldo_centavos from public.tarjetas where uid = v_uid) = 500000,
         '4b: AGUJERO GRAVE: el mismo pago acreditó más de una vez';
  select count(*) into n from public.movimientos
   where uid = v_uid and tipo = 'carga' and medio_pago = 'mercadopago'
     and hecho_por is null and clave_idempotencia = 'mp:MP-1';
  assert n = 1, '4c: un solo asiento, marcado como Mercado Pago';

  -- ══ 5. Pagó dos veces la misma preferencia: son dos cobros, dos cargas ═══
  v := public.pago_acreditar(v_pago, 'MP-2', 500000);
  assert (v->>'ok')::boolean and (v->>'saldo_centavos')::bigint = 1000000,
         '5: el segundo cobro también se acredita. ' || v::text;

  -- ══ 6. Un rechazo tardío no pisa un pago aprobado ════════════════════════
  v := public.pago_rechazar(v_pago, 'cc_rejected_insufficient_amount');
  assert not (v->>'cambio')::boolean, '6a: no des-aprueba. ' || v::text;
  assert (select estado from public.recargas_mp where id = v_pago) = 'aprobado', '6b: sigue aprobado';

  v := public.pago_crear('31222333', CEL, 300000);
  v_otro := (v->>'pago_id')::uuid;
  v := public.pago_rechazar(v_otro, 'cc_rejected_other_reason');
  assert (v->>'cambio')::boolean, '6c: un pendiente sí se rechaza. ' || v::text;
  assert (select saldo_centavos from public.tarjetas where uid = v_uid) = 1000000,
         '6d: un rechazo no mueve saldo';

  -- ══ 7. Cada uno ve solo sus pagos ════════════════════════════════════════
  v := public.pago_estado('31222333', CEL, v_pago);
  assert v->>'estado' = 'aprobado' and (v->>'saldo_centavos')::bigint = 1000000,
         '7a: el dueño lo ve. ' || v::text;
  v := public.pago_estado('32444555', CEL2, v_pago);
  assert v->>'motivo' = 'pago_desconocido', '7b: AGUJERO: ve el pago de otro. ' || v::text;

  -- ══ 8. Freno a los intentos en ráfaga ════════════════════════════════════
  for i in 1..8 loop
    v := public.pago_crear('31222333', CEL, 100000);
  end loop;
  assert (v->>'ok')::boolean, '8a: los primeros diez pasan. ' || v::text;
  v := public.pago_crear('31222333', CEL, 100000);
  assert v->>'motivo' = 'demasiados_intentos', '8b: el once no. ' || v::text;

  reset role;

  -- ══ 9. En el cierre de caja, Mercado Pago no está en el cajón ════════════
  perform set_config('request.jwt.claims', ADMIN, true);
  set local role authenticated;
  v := public.arqueo(T0 - interval '1 second', now() + interval '1 second');
  assert (v->'cargas_por_medio'->'mercadopago'->>'centavos')::bigint = 1000000,
         '9a: figura como Mercado Pago. ' || v::text;
  assert (v->>'neto_caja_centavos')::bigint = 0,
         '9b: AGUJERO: el cajón "debe" plata que entró por Mercado Pago. ' || v::text;
  reset role;

  -- ══ 10. El cliente lo ve en su app ═══════════════════════════════════════
  v := public.cliente_estado('31222333', CEL);
  assert (v->>'saldo_centavos')::bigint = 1000000
     and v->'movimientos'->0->>'medio_pago' = 'mercadopago',
         '10: saldo y movimiento en la app. ' || v::text;
end $$;

select '✅ TODAS LAS PRUEBAS DE MERCADO PAGO PASARON' as resultado;

rollback;
