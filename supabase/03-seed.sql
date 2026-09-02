-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Datos de prueba
--
-- Los valores del grifo 1 y de la tarjeta A1B2C3D4 son EXACTAMENTE los del
-- ejemplo del contrato, así que sirven para reproducirlo tal cual.
-- ═════════════════════════════════════════════════════════════════════════════

insert into public.grifos (id, nombre, precio_litro_centavos, pulsos_por_litro, ml_minimos)
values
  (1, 'IPA',        320000, 452.700, 50),   -- $3200 el litro
  (2, 'Rubia',      280000, 452.700, 50),   -- $2800 el litro
  (3, 'Negra',      350000, 452.700, 50)
on conflict (id) do nothing;

insert into public.tarjetas (uid, saldo_centavos, bloqueada, nota)
values
  ('A1B2C3D4', 850000, false, 'tarjeta del ejemplo del contrato: $8500'),
  ('11223344', 200000, false, 'saldo chico: $2000'),
  ('DEADBEEF',    100, false, 'saldo casi cero, no alcanza al minimo de 50 ml'),
  ('B10QU34D4', 500000, true,  'bloqueada a proposito para probar')
on conflict (uid) do nothing;


-- ═════════════════════════════════════════════════════════════════════════════
-- IMPORTANTE: los grifos arrancan SIN token, y sin token NO OPERAN (falla
-- cerrado). Hay que generar uno por grifo y grabarlo en el ESP32 correspondiente.
--
-- Corré esto y GUARDÁ el token que devuelve: se almacena hasheado y no se
-- puede volver a ver. Si lo perdés, rotás de nuevo y listo.
-- ═════════════════════════════════════════════════════════════════════════════

-- ⚠️ Va COMENTADO a proposito: rotar un token invalida el que ya tenga grabado
-- el ESP32 de ese grifo, y ese grifo deja de funcionar hasta que le cargues el
-- nuevo. Descomenta y corre SOLO la linea del grifo que estas poniendo en
-- marcha (o al que le perdiste el token).

-- select public.rotar_token_grifo(1);
-- select public.rotar_token_grifo(2);
-- select public.rotar_token_grifo(3);
