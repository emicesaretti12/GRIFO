-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Pruebas de barriles y ajustes de saldo
-- Corre en transacción y hace ROLLBACK: no deja rastro.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='barriles') then
    raise exception E'FALTA CORRER 12-barriles.sql PRIMERO.';
  end if;
end $$;

insert into public.grifos (id, nombre, precio_litro_centavos, costo_litro_centavos,
                           pulsos_por_litro, ml_minimos, ml_vaso, activo)
values (931, 'test-barril', 400000, 150000, 452.700, 50, 500, true);

insert into public.tarjetas (uid, saldo_centavos) values ('BARR0001', 3000000);

insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666', 'admin.barril@grifo.local'),
  ('77777777-7777-7777-7777-777777777777', 'cajero.barril@grifo.local')
on conflict (id) do nothing;
insert into public.personal (user_id, nombre, rol) values
  ('66666666-6666-6666-6666-666666666666', 'Admin', 'admin'),
  ('77777777-7777-7777-7777-777777777777', 'Cajero', 'cajero')
on conflict (user_id) do update set rol = excluded.rol, activo = true;

do $$
declare
  v      jsonb;
  t931   text;
  v_ses  bigint;
  n      int;
  ADMIN  text := '{"sub":"66666666-6666-6666-6666-666666666666"}';
  CAJERO text := '{"sub":"77777777-7777-7777-7777-777777777777"}';
begin
  t931 := public.rotar_token_grifo(931) ->> 'token';

  -- ══ 1. Solo el admin cambia barriles ═════════════════════════════════════
  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;
  v := public.admin_cambiar_barril(931, 50);
  assert v->>'motivo' = 'no_autorizado',      '1a: un cajero no cambia barriles. ' || v::text;
  reset role;

  perform set_config('request.jwt.claims', ADMIN, true);
  set local role authenticated;
  v := public.admin_cambiar_barril(931, 0);
  assert v->>'motivo' = 'litros_invalidos',   '1b: cero litros. ' || v::text;
  v := public.admin_cambiar_barril(9999, 50);
  assert v->>'motivo' = 'grifo_desconocido',  '1c: grifo inexistente. ' || v::text;

  -- ══ 2. Poner un barril de 50 litros ══════════════════════════════════════
  v := public.admin_cambiar_barril(931, 50, 7500000, 'IPA lote 12');
  assert (v->>'ok')::boolean,                 '2a: deberia instalar. ' || v::text;
  assert v->'anterior' = 'null'::jsonb,       '2b: no habia barril antes. ' || v::text;

  v := public.estado_barriles();
  assert jsonb_array_length(v) >= 1,          '2c: deberia haber un barril. ' || v::text;
  reset role;

  -- ══ 3. Servir descuenta del barril ═══════════════════════════════════════
  v := public.abrir_sesion('BARR0001', 931, t931);
  v_ses := (v->>'sesion_id')::bigint;
  v := public.cerrar_sesion(v_ses, 2000, 905, t931);
  assert (v->>'ok')::boolean,                 '3a: deberia cerrar. ' || v::text;

  assert (select ml_servidos from public.barriles
           where grifo_id = 931 and agotado_en is null) = 2000,
         '3b: el barril tendria que haber bajado 2000 ml';

  -- Y la tirada queda atada a ESE barril: cambiar de barril no puede reescribir
  -- la historia de las tiradas viejas
  assert (select barril_id from public.sesiones where id = v_ses) is not null,
         '3c: la sesion tendria que quedar atada al barril';

  -- ══ 4. Un reintento de cierre NO descuenta dos veces ═════════════════════
  v := public.cerrar_sesion(v_ses, 2000, 905, t931);
  assert (v->>'repetida')::boolean,           '4a: deberia ser repetida. ' || v::text;
  assert (select ml_servidos from public.barriles
           where grifo_id = 931 and agotado_en is null) = 2000,
         '4b: el reintento NO tiene que volver a descontar del barril';

  -- ══ 5. El estado del barril, como lo mira la barra ═══════════════════════
  perform set_config('request.jwt.claims', ADMIN, true);
  set local role authenticated;
  v := public.estado_barriles()->0;
  assert (v->>'ml_restantes')::bigint = 48000,       '5a: restantes. ' || v::text;
  assert (v->>'restante_pct')::numeric = 96.0,       '5b: porcentaje. ' || v::text;
  -- 48000 ml restantes / vaso de 500 ml = 96 vasos
  assert (v->>'vasos')::int = 96,                    '5c: vasos que quedan. ' || v::text;

  -- ══ 6. Cambiar el barril cierra el anterior y reporta el aprovechamiento ══
  v := public.admin_cambiar_barril(931, 30, 4500000, 'Rubia lote 3');
  assert (v->>'ok')::boolean,                        '6a: deberia cambiar. ' || v::text;
  assert (v->'anterior'->>'ml_servidos')::bigint = 2000, '6b: el anterior. ' || v::text;
  assert (v->'anterior'->>'aprovechado_pct')::numeric = 4.0, '6c: aprovechado. ' || v::text;

  -- Un solo barril activo por canilla, garantizado por indice
  select count(*) into n from public.barriles where grifo_id = 931 and agotado_en is null;
  assert n = 1, '6d: tendria que haber UN solo barril activo (hay ' || n || ')';

  -- El barril nuevo arranca en cero
  v := public.estado_barriles()->0;
  assert (v->>'ml_servidos')::bigint = 0,            '6e: el nuevo arranca vacio. ' || v::text;
  reset role;

  -- ══ 7. Ajustes de saldo ══════════════════════════════════════════════════
  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;
  v := public.admin_ajustar_saldo('BARR0001', -100000, 'error de carga');
  assert v->>'motivo' = 'no_autorizado',      '7a: un cajero no ajusta. ' || v::text;
  reset role;

  perform set_config('request.jwt.claims', ADMIN, true);
  set local role authenticated;

  -- El motivo es obligatorio: un ajuste sin explicacion es un agujero
  v := public.admin_ajustar_saldo('BARR0001', -100000, '   ');
  assert v->>'motivo' = 'falta_motivo',       '7b: sin motivo. ' || v::text;
  v := public.admin_ajustar_saldo('BARR0001', 0, 'nada');
  assert v->>'motivo' = 'monto_invalido',     '7c: monto cero. ' || v::text;
  v := public.admin_ajustar_saldo('NOEXISTE', 1000, 'x');
  assert v->>'motivo' = 'tarjeta_desconocida','7d: tarjeta inexistente. ' || v::text;

  -- Devolver plata cargada de mas
  v := public.admin_ajustar_saldo('BARR0001', -500000, 'se cargo de mas por error');
  assert (v->>'ok')::boolean,                 '7e: deberia ajustar. ' || v::text;
  -- 3000000 - 800000 (2000 ml a 400000/L) - 500000 = 1700000
  assert (v->>'saldo_centavos')::bigint = 1700000, '7f: saldo. ' || v::text;

  -- Y queda asentado como AJUSTE, no disfrazado de carga
  assert (select tipo from public.movimientos where id = (v->>'movimiento_id')::bigint) = 'ajuste',
         '7g: tendria que quedar como ajuste';
  assert (select motivo from public.movimientos where id = (v->>'movimiento_id')::bigint)
         = 'se cargo de mas por error', '7h: el motivo tiene que quedar guardado';
  assert (select hecho_por from public.movimientos where id = (v->>'movimiento_id')::bigint)
         = '66666666-6666-6666-6666-666666666666', '7i: firmado por quien lo hizo';

  -- Un ajuste negativo no puede dejar la tarjeta en rojo
  v := public.admin_ajustar_saldo('BARR0001', -99999999, 'intento de dejarla negativa');
  assert v->>'motivo' = 'saldo_insuficiente', '7j: no puede quedar negativa. ' || v::text;
  reset role;

  -- ══ 8. El libro mayor sigue cuadrando con los ajustes ════════════════════
  assert (select coalesce(sum(centavos), 0) from public.movimientos where uid = 'BARR0001')
         + 3000000   -- el saldo inicial se cargo directo en el insert de arriba
         = (select saldo_centavos from public.tarjetas where uid = 'BARR0001'),
         '8: el libro mayor no cuadra despues de los ajustes';

  -- ══ 9. anon no llega a nada de esto ══════════════════════════════════════
  begin
    set local role anon;
    perform public.admin_cambiar_barril(931, 50);
    reset role;
    raise exception 'AGUJERO: la anon key puede cambiar barriles';
  exception when insufficient_privilege then reset role; end;

  begin
    set local role anon;
    perform public.admin_ajustar_saldo('BARR0001', 1000000, 'x');
    reset role;
    raise exception 'AGUJERO GRAVISIMO: la anon key puede ajustar saldos';
  exception when insufficient_privilege then reset role; end;

  raise notice 'TODAS LAS PRUEBAS DE BARRILES PASARON';
end $$;

select '✅ TODAS LAS PRUEBAS DE BARRILES PASARON' as resultado;

rollback;
