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

-- Las tarjetas se crean con cargar_saldo, NO escribiendo la tabla a mano.
-- Si le metieramos el saldo inicial directo, ese saldo no quedaria asentado en
-- `movimientos` y el libro mayor no cuadraria con el saldo desde el dia uno.
-- Toda la plata entra por la puerta de entrada, tambien la de prueba.
--
-- El `if not exists` hace que volver a correr el seed no recargue tarjetas que
-- ya existen: no queremos duplicar saldos por correr esto dos veces.
do $$
begin
  if not exists (select 1 from public.tarjetas where uid = 'A1B2C3D4') then
    perform public.cargar_saldo('A1B2C3D4', 850000, 'seed: ejemplo del contrato', 'seed:A1B2C3D4');
  end if;
  if not exists (select 1 from public.tarjetas where uid = '11223344') then
    perform public.cargar_saldo('11223344', 200000, 'seed: saldo chico', 'seed:11223344');
  end if;
  if not exists (select 1 from public.tarjetas where uid = 'DEADBEEF') then
    perform public.cargar_saldo('DEADBEEF', 100, 'seed: casi sin saldo', 'seed:DEADBEEF');
  end if;
  if not exists (select 1 from public.tarjetas where uid = 'B10QU34D4') then
    perform public.cargar_saldo('B10QU34D4', 500000, 'seed: para bloquear', 'seed:B10QU34D4');
    update public.tarjetas set bloqueada = true, nota = 'bloqueada a proposito para probar'
     where uid = 'B10QU34D4';
  end if;
end $$;


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
