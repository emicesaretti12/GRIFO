-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Suite de pruebas del backend
--
-- Pegar TODO en el editor SQL de Supabase y ejecutar.
--
--   · Si sale "TODAS LAS PRUEBAS PASARON", está todo bien.
--   · Si algo falla, corta con un error que dice exactamente qué falló.
--
-- Corre dentro de una transacción que termina en ROLLBACK: crea sus propios
-- datos, los usa y no deja rastro. Se puede correr mil veces, incluso en
-- producción, sin ensuciar nada.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into public.grifos (id, nombre, precio_litro_centavos, pulsos_por_litro, ml_minimos) values
  (901, 'test-ipa',       320000, 452.700, 50),
  (902, 'test-rubia',     280000, 452.700, 50),
  (903, 'test-redondeo',  100001, 452.700,  0);   -- precio feo a propósito

insert into public.tarjetas (uid, saldo_centavos, bloqueada) values
  ('TEST0001', 850000, false),   -- la del ejemplo del contrato
  ('TEST0002',      0, false),   -- sin saldo
  ('TEST0003', 500000, false),   -- para el test de redondeo
  ('TEST0004', 500000, true),    -- bloqueada
  ('TEST0005', 850000, false);   -- para el test de sesión abandonada

do $$
declare
  v          jsonb;
  v2         jsonb;
  v_sesion   bigint;
  v_sesion2  bigint;
begin
  -- ══ 1. abrir_sesion feliz — reproduce el ejemplo del contrato ═════════════
  v := public.abrir_sesion('TEST0001', 901);
  assert (v->>'ok')::boolean,                              '1: deberia abrir. ' || v::text;
  assert (v->>'saldo_centavos')::bigint = 850000,          '1: saldo. ' || v::text;
  assert (v->>'precio_litro_centavos')::bigint = 320000,   '1: precio. ' || v::text;
  assert (v->>'pulsos_por_litro')::numeric = 452.7,        '1: pulsos_por_litro. ' || v::text;
  -- 850000 centavos / 320000 por litro = 2.65625 L -> 2656 mL (trunca, no regala)
  assert (v->>'ml_maximos')::int = 2656,                   '1: ml_maximos. ' || v::text;
  v_sesion := (v->>'sesion_id')::bigint;

  -- ══ 2. Pre-autorización: la misma tarjeta en otro grifo, no ══════════════
  v := public.abrir_sesion('TEST0001', 902);
  assert not (v->>'ok')::boolean,                                  '2: no deberia abrir. ' || v::text;
  assert v->>'motivo' = 'sesion_abierta_en_otro_grifo',             '2: motivo. ' || v::text;

  -- ══ 3. Reintento en el MISMO grifo: devuelve la misma sesión ═════════════
  --     (el ESP32 se reinició, o no le llegó la respuesta)
  v := public.abrir_sesion('TEST0001', 901);
  assert (v->>'ok')::boolean,                              '3: deberia reanudar. ' || v::text;
  assert (v->>'sesion_id')::bigint = v_sesion,             '3: tiene que ser la MISMA sesion. ' || v::text;
  assert (v->>'reanudada')::boolean,                       '3: falta flag reanudada. ' || v::text;

  -- ══ 4. cerrar_sesion — el número exacto del contrato ═════════════════════
  --     473 mL a 320000 centavos/litro = 151360 centavos
  --     850000 - 151360 = 698640
  v := public.cerrar_sesion(v_sesion, 473, 214);
  assert (v->>'ok')::boolean,                              '4: deberia cerrar. ' || v::text;
  assert (v->>'costo_centavos')::bigint = 151360,          '4: costo. ' || v::text;
  assert (v->>'saldo_centavos')::bigint = 698640,          '4: saldo final. ' || v::text;

  -- ══ 5. IDEMPOTENCIA — el invariante que impide cobrar doble ══════════════
  --     El ESP32 no recibió el 200 y reintenta, incluso con otros mL.
  --     Tiene que devolver lo mismo y NO descontar de nuevo.
  v2 := public.cerrar_sesion(v_sesion, 999, 999);
  assert (v2->>'ok')::boolean,                             '5: deberia responder ok. ' || v2::text;
  assert (v2->>'repetida')::boolean,                       '5: falta flag repetida. ' || v2::text;
  assert (v2->>'saldo_centavos')::bigint = 698640,         '5: NO tiene que volver a descontar. ' || v2::text;
  assert (select saldo_centavos from public.tarjetas where uid = 'TEST0001') = 698640,
         '5: el saldo real en la tabla cambio con el reintento';

  -- ══ 6. Sin saldo ═════════════════════════════════════════════════════════
  v := public.abrir_sesion('TEST0002', 901);
  assert not (v->>'ok')::boolean,                          '6: no deberia abrir. ' || v::text;
  assert v->>'motivo' = 'sin_saldo',                       '6: motivo. ' || v::text;

  -- ══ 7. Tarjeta bloqueada ═════════════════════════════════════════════════
  v := public.abrir_sesion('TEST0004', 901);
  assert not (v->>'ok')::boolean,                          '7: no deberia abrir. ' || v::text;
  assert v->>'motivo' = 'tarjeta_bloqueada',               '7: motivo. ' || v::text;

  -- ══ 8. REDONDEO HACIA ARRIBA — nunca regalar por truncamiento ════════════
  --     1 mL a 100001 centavos/litro = 100.001 centavos -> tiene que cobrar 101
  v := public.abrir_sesion('TEST0003', 903);
  assert (v->>'ok')::boolean,                              '8: deberia abrir. ' || v::text;
  v := public.cerrar_sesion((v->>'sesion_id')::bigint, 1, 1);
  assert (v->>'costo_centavos')::bigint = 101,             '8: tiene que redondear PARA ARRIBA. ' || v::text;
  assert (v->>'saldo_centavos')::bigint = 499899,          '8: saldo final. ' || v::text;

  -- ══ 9. Entradas desconocidas ═════════════════════════════════════════════
  v := public.abrir_sesion('NOEXISTE', 901);
  assert v->>'motivo' = 'tarjeta_desconocida',             '9a: motivo. ' || v::text;
  v := public.abrir_sesion('TEST0001', 12345);
  assert v->>'motivo' = 'grifo_desconocido',               '9b: motivo. ' || v::text;
  v := public.cerrar_sesion(999999999, 100, 50);
  assert v->>'motivo' = 'sesion_desconocida',              '9c: motivo. ' || v::text;
  v := public.abrir_sesion('', 901);
  assert v->>'motivo' = 'uid_invalido',                    '9d: motivo. ' || v::text;

  -- ══ 10. El UID se normaliza a mayúsculas ═════════════════════════════════
  v := public.abrir_sesion('  test0001  ', 901);
  assert v->>'motivo' = 'sesion_abierta_en_otro_grifo' or (v->>'ok')::boolean,
         '10: tendria que reconocer la misma tarjeta en minusculas. ' || v::text;

  -- ══ 11. Sesión abandonada: libera la tarjeta pero el cierre tardío cobra ══
  --     Este es el caso de la cola offline en NVS: se cortó el WiFi, pasaron
  --     20 minutos, el mantenimiento la marcó abandonada, y recién ahí el
  --     ESP32 vuelve y drena su cola.
  v := public.abrir_sesion('TEST0005', 902);
  v_sesion2 := (v->>'sesion_id')::bigint;

  update public.sesiones set abierta_en = now() - interval '30 minutes' where id = v_sesion2;
  assert public.cerrar_sesiones_abandonadas(15) >= 1,      '11a: deberia marcar 1 abandonada';
  assert (select estado from public.sesiones where id = v_sesion2) = 'abandonada',
         '11b: tendria que quedar abandonada';

  -- La tarjeta quedó libre para usarse en otro grifo...
  v := public.abrir_sesion('TEST0005', 901);
  assert (v->>'ok')::boolean,                              '11c: la tarjeta tendria que estar libre. ' || v::text;

  -- ...y la sesión vieja TODAVÍA se puede liquidar con los mL reales.
  v := public.cerrar_sesion(v_sesion2, 500, 226);
  assert (v->>'ok')::boolean,                              '11d: el cierre tardio tiene que cobrar. ' || v::text;
  -- 500 mL a 280000/litro = 140000 centavos
  assert (v->>'costo_centavos')::bigint = 140000,          '11e: costo del cierre tardio. ' || v::text;

  -- ══ 12. El saldo nunca queda negativo ════════════════════════════════════
  --     Simulamos un ESP32 roto que reporta 10 litros con saldo para 0.7
  insert into public.tarjetas (uid, saldo_centavos) values ('TEST0006', 1000);
  v := public.abrir_sesion('TEST0006', 903);
  v := public.cerrar_sesion((v->>'sesion_id')::bigint, 10000, 4527);
  assert (v->>'saldo_centavos')::bigint = 0,               '12a: no puede quedar negativo. ' || v::text;
  assert (v->>'costo_centavos')::bigint = 1000,            '12b: cobra hasta donde llega el saldo. ' || v::text;

  raise notice 'TODAS LAS PRUEBAS PASARON';
end $$;

select '✅ TODAS LAS PRUEBAS PASARON' as resultado;

rollback;
