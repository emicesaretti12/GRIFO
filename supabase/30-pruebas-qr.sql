-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Pruebas del QR: app del cliente, ticket de caja y tablet
-- Corre en transacción y hace ROLLBACK: no deja rastro.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'tablet_abrir_sesion_qr') then
    raise exception E'FALTA CORRER 29-qr.sql PRIMERO.';
  end if;
end $$;

insert into public.grifos (id, nombre, precio_litro_centavos, pulsos_por_litro,
                           ml_minimos, ml_vaso, activo)
values (951, 'test-qr',  400000, 12820, 50, 473, true),
       (952, 'test-qr2', 400000, 12820, 50, 473, true);

insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777771', 'admin.qr@grifo.local'),
  ('77777777-7777-7777-7777-777777777772', 'cajero.qr@grifo.local')
on conflict (id) do nothing;
insert into public.personal (user_id, nombre, rol) values
  ('77777777-7777-7777-7777-777777777771', 'Ana',  'admin'),
  ('77777777-7777-7777-7777-777777777772', 'Beto', 'cajero')
on conflict (user_id) do update set rol = excluded.rol, activo = true, nombre = excluded.nombre;

do $$
declare
  v       jsonb;
  w       jsonb;
  n       int;
  t951    text;
  t952    text;
  v_qr    text;
  v_qr2   text;
  v_corto text;
  v_uid   text;
  v_ses   bigint;
  T0      timestamptz := now();
  ADMIN   text := '{"sub":"77777777-7777-7777-7777-777777777771"}';
  CAJERO  text := '{"sub":"77777777-7777-7777-7777-777777777772"}';
  CEL_A   text := repeat('a', 64);
  CEL_B   text := repeat('b', 64);
  CEL_MAL text := repeat('c', 64);
begin
  t951 := public.rotar_token_grifo(951) ->> 'token';
  t952 := public.rotar_token_grifo(952) ->> 'token';

  -- ══ 1. La jornada va de 6 a 6, hora de Argentina ═════════════════════════
  assert public.inicio_jornada('2026-11-14 02:00:00-03') = '2026-11-13 06:00:00-03',
         '1a: las 2 AM son de la noche anterior';
  assert public.inicio_jornada('2026-11-14 07:00:00-03') = '2026-11-14 06:00:00-03',
         '1b: las 7 AM ya son del día nuevo';
  -- El caso que estaba roto: las 22:00 de acá son la 1:00 UTC del día siguiente.
  assert public.inicio_jornada('2026-11-14 22:00:00-03') = '2026-11-14 06:00:00-03',
         '1c: las 22 hs no pueden caer en la jornada de mañana';

  -- ══ 2. Entrar a la app: nombre y DNI ═════════════════════════════════════
  v := public.cliente_entrar('123', 'Emi Cesaretti', CEL_A);
  assert v->>'motivo' = 'dni_invalido',         '2a: DNI corto. ' || v::text;
  v := public.cliente_entrar('30111222', ' ', CEL_A);
  assert v->>'motivo' = 'falta_nombre',         '2b: sin nombre. ' || v::text;
  v := public.cliente_entrar('30111222', 'Emi Cesaretti', 'corto');
  assert v->>'motivo' = 'dispositivo_invalido', '2c: secreto corto. ' || v::text;

  -- Acepta el DNI con puntos, como lo escribe la gente.
  v := public.cliente_entrar('30.111.222', '  Emi   Cesaretti ', CEL_A);
  assert (v->>'ok')::boolean and (v->>'nueva')::boolean, '2d: alta. ' || v::text;
  assert v->>'dni' = '30111222',                '2e: guarda el DNI limpio. ' || v::text;
  assert v->>'nombre' = 'Emi Cesaretti',        '2f: guarda el nombre prolijo. ' || v::text;
  assert (v->>'saldo_centavos')::bigint = 0,    '2g: nace en cero. ' || v::text;

  -- El mismo celular vuelve a entrar: es la misma cuenta, no otra.
  v := public.cliente_entrar('30111222', 'emi', CEL_A);
  assert (v->>'ok')::boolean and not (v->>'nueva')::boolean, '2h: reingreso. ' || v::text;
  select count(*) into n from public.clientes where dni = '30111222' and tipo = 'app';
  assert n = 1, '2i: no puede haber dos cuentas de app para un DNI';

  -- ══ 3. Otro celular con el mismo DNI NO entra ════════════════════════════
  -- Es el agujero que tapa el vínculo: saber el DNI de alguien no es tener su
  -- saldo.
  v := public.cliente_entrar('30111222', 'Emi Cesaretti', CEL_B);
  assert v->>'motivo' = 'otro_dispositivo', '3a: AGUJERO: entró desde otro celular. ' || v::text;
  v := public.cliente_estado('30111222', CEL_B);
  assert v->>'motivo' = 'sesion_invalida',  '3b: AGUJERO: lee el saldo ajeno. ' || v::text;
  v := public.cliente_generar_pase('30111222', CEL_B);
  assert v->>'motivo' = 'sesion_invalida',  '3c: AGUJERO: genera un QR ajeno. ' || v::text;

  -- ══ 4. El QR de la app ═══════════════════════════════════════════════════
  v := public.cliente_generar_pase('30111222', CEL_A);
  assert (v->>'ok')::boolean,                        '4a: genera. ' || v::text;
  v_qr := v->>'codigo';
  v_corto := v->>'codigo_corto';
  assert v_qr ~ '^GRIFO:[0-9A-F]{32}$',              '4b: formato del QR. ' || v_qr;
  assert v_corto ~ '^[0-9]{6}$',                     '4c: seis dígitos. ' || v_corto;
  assert (v->>'vence_en')::timestamptz > now() + interval '60 seconds'
     and (v->>'vence_en')::timestamptz <= now() + interval '91 seconds', '4d: vale 90 s';
  -- En la base queda el hash, no el código.
  select count(*) into n from public.pases
   where codigo_hash = public._hash(substr(v_qr, 7)) and codigo is null;
  assert n = 1, '4e: el pase de app no puede guardar el código en claro';

  -- ══ 5. La tablet: primero el token, siempre ══════════════════════════════
  v := public.tablet_abrir_sesion_qr(v_qr, 951, 'token-trucho');
  assert v->>'motivo' = 'token_invalido',   '5a: sin token no se prueba nada. ' || v::text;
  v := public.tablet_abrir_sesion_qr('GRIFO:' || repeat('0', 32), 951, t951);
  assert v->>'motivo' = 'qr_desconocido',   '5b: código inventado. ' || v::text;
  v := public.tablet_abrir_sesion_qr('https://cualquier.cosa/qr', 951, t951);
  assert v->>'motivo' = 'qr_desconocido',   '5c: un QR que no es nuestro. ' || v::text;

  -- La canilla nunca latió: no se abre una sesión que nadie va a atender.
  v := public.tablet_abrir_sesion_qr(v_qr, 951, t951);
  assert v->>'motivo' = 'canilla_sin_conexion', '5d: canilla muerta. ' || v::text;
  w := public.pantalla_estado(951, t951);
  assert not (w->'grifo'->>'en_linea')::boolean, '5e: la pantalla tiene que saberlo';

  perform public.canilla_latido(951, t951);
  perform public.canilla_latido(952, t952);
  w := public.pantalla_estado(951, t951);
  assert (w->'grifo'->>'en_linea')::boolean,    '5f: después del latido está en línea';

  -- Viva, pero el cliente no tiene plata.
  v := public.tablet_abrir_sesion_qr(v_qr, 951, t951);
  assert v->>'motivo' = 'sin_saldo',            '5g: sin saldo. ' || v::text;

  -- ══ 6. La caja: nadie sin login ══════════════════════════════════════════
  v := public.caja_vender('28999111', 'Juan Perez', 500000, 'efectivo', 'k1');
  assert v->>'motivo' = 'no_autorizado', '6a: sin login no se vende. ' || v::text;
  v := public.caja_buscar_cliente('28999111');
  assert v->>'motivo' = 'no_autorizado', '6b: sin login no se busca. ' || v::text;
  v := public.caja_buscar_por_codigo(v_corto);
  assert v->>'motivo' = 'no_autorizado', '6c: sin login no se busca por código. ' || v::text;

  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;

  -- ══ 7. Cargar efectivo a la app, con el código que dicta el cliente ══════
  v := public.caja_buscar_por_codigo('000000');
  assert v->>'motivo' = 'codigo_vencido', '7a: código que no existe. ' || v::text;
  v := public.caja_buscar_por_codigo(v_corto);
  assert (v->>'ok')::boolean and v->>'dni' = '30111222' and v->>'tipo' = 'app',
         '7b: encuentra la cuenta de app. ' || v::text;
  v_uid := v->>'uid';

  v := public.caja_cargar(v_uid, 1000000, 'tarjeta de regalo', 'k-app-1');
  assert v->>'motivo' = 'medio_invalido', '7c: medio inventado. ' || v::text;
  v := public.caja_cargar('NOEXISTE', 1000000, 'efectivo', 'k-app-1');
  assert v->>'motivo' = 'tarjeta_desconocida', '7d: acá no se dan altas. ' || v::text;
  v := public.caja_cargar(v_uid, 1000000, 'efectivo', 'k-app-1');
  assert (v->>'ok')::boolean and (v->>'saldo_centavos')::bigint = 1000000, '7e: carga. ' || v::text;
  -- El cajero apretó dos veces: no se carga dos veces.
  v := public.caja_cargar(v_uid, 1000000, 'efectivo', 'k-app-1');
  assert (v->>'ok')::boolean and (v->>'repetida')::boolean, '7f: idempotente. ' || v::text;
  reset role;
  assert (select saldo_centavos from public.tarjetas where uid = v_uid) = 1000000,
         '7g: AGUJERO: cargó dos veces';
  select count(*) into n from public.movimientos
   where uid = v_uid and tipo = 'carga' and medio_pago = 'efectivo'
     and hecho_por = '77777777-7777-7777-7777-777777777772';
  assert n = 1, '7h: la carga queda firmada y con su medio';

  -- ══ 8. Ahora sí: el QR abre la canilla ═══════════════════════════════════
  v := public.tablet_abrir_sesion_qr(v_qr, 951, t951);
  assert (v->>'ok')::boolean,               '8a: abre. ' || v::text;
  assert v->>'origen' = 'app',              '8b: dice de dónde vino. ' || v::text;
  v_ses := (v->>'sesion_id')::bigint;
  -- La cámara lee el mismo QR varias veces por segundo: no abre otra sesión.
  v := public.tablet_abrir_sesion_qr(v_qr, 951, t951);
  assert (v->>'ok')::boolean and (v->>'sesion_id')::bigint = v_ses, '8c: reanuda. ' || v::text;
  -- El ESP32 la ve con el nombre.
  w := public.canilla_sesion_activa(951, t951) -> 'sesion';
  assert (w->>'sesion_id')::bigint = v_ses and w->>'cliente' = 'Emi Cesaretti',
         '8d: el sondeo de la canilla. ' || w::text;
  -- Y la pantalla saluda por el primer nombre, sin mostrar el resto.
  w := public.pantalla_estado(951, t951) -> 'sesion';
  assert w->>'nombre' = 'Emi',              '8e: solo el primer nombre. ' || w::text;
  -- En otra canilla, el mismo cliente no puede abrir a la vez.
  v := public.tablet_abrir_sesion_qr(v_qr, 952, t952);
  assert v->>'motivo' = 'sesion_abierta_en_otro_grifo', '8f: dos canillas a la vez. ' || v::text;

  -- ══ 9. La caja con alguien sin celular: DNI, nombre, plata y ticket ══════
  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;

  v := public.caja_buscar_cliente('28.999.111');
  assert (v->>'ok')::boolean and not (v->>'existe')::boolean, '9a: cliente nuevo. ' || v::text;

  v := public.caja_vender('28999111', '', 500000, 'efectivo', 'k-tk-1');
  assert v->>'motivo' = 'falta_nombre',   '9b: alta sin nombre. ' || v::text;
  v := public.caja_vender('28999111', 'Juan Perez', 0, 'efectivo', 'k-tk-1');
  assert v->>'motivo' = 'monto_invalido', '9c: monto cero. ' || v::text;
  v := public.caja_vender('28999111', 'Juan Perez', 500000, 'efectivo', '');
  assert v->>'motivo' = 'falta_clave',    '9d: sin clave no hay idempotencia. ' || v::text;

  v := public.caja_vender('28999111', 'Juan Perez', 500000, 'debito', 'k-tk-1');
  assert (v->>'ok')::boolean,                              '9e: vende. ' || v::text;
  assert (v->>'saldo_centavos')::bigint = 500000,          '9f: saldo. ' || v::text;
  v_qr2 := v->'pase'->>'codigo';
  assert v_qr2 ~ '^GRIFO:[0-9A-F]{32}$',                   '9g: trae el QR del ticket. ' || v::text;
  -- Vale hasta que cierra el bar: las 6:00 que terminan esta jornada.
  assert (v->'pase'->>'vence_en')::timestamptz = public.inicio_jornada(now()) + interval '24 hours',
         '9h: vence a las 6 AM. ' || v::text;

  -- Reintento con la misma clave: mismo resultado, sin cobrar de nuevo.
  v := public.caja_vender('28999111', 'Juan Perez', 500000, 'debito', 'k-tk-1');
  assert (v->>'ok')::boolean and (v->>'repetida')::boolean, '9i: idempotente. ' || v::text;
  assert v->'pase'->>'codigo' = v_qr2,                      '9j: el mismo QR. ' || v::text;

  -- Segunda compra de la noche: suma saldo y conserva el QR que ya tiene.
  v := public.caja_vender('28999111', null, 300000, 'efectivo', 'k-tk-2');
  assert (v->>'ok')::boolean and (v->>'saldo_centavos')::bigint = 800000, '9k: suma. ' || v::text;
  assert v->'pase'->>'codigo' = v_qr2, '9l: un solo QR por noche. ' || v::text;

  v := public.caja_buscar_cliente('28999111');
  assert (v->>'existe')::boolean and v->>'nombre' = 'Juan Perez' and v->>'tipo' = 'ticket',
         '9m: la ficha. ' || v::text;
  assert 'GRIFO:' || (v->'pase'->>'codigo') = v_qr2, '9n: la ficha trae el pase vigente. ' || v::text;
  assert jsonb_array_length(v->'movimientos') = 2, '9o: dos cargas. ' || v::text;

  -- ══ 10. La cuenta de app y la de ticket NO se mezclan ════════════════════
  -- El ataque: registro en la app el DNI de otro, espero a que cargue plata en
  -- la caja, y me la tomo. Separadas, lo que entra por la caja solo sale con
  -- el papel.
  reset role;
  v := public.cliente_entrar('28999111', 'Juan Perez', CEL_MAL);
  assert (v->>'ok')::boolean and (v->>'nueva')::boolean, '10a: el atacante se registra. ' || v::text;
  assert (v->>'saldo_centavos')::bigint = 0, '10b: AGUJERO GRAVE: ve la plata de la caja. ' || v::text;
  v := public.cliente_generar_pase('28999111', CEL_MAL);
  v := public.tablet_abrir_sesion_qr(v->>'codigo', 952, t952);
  assert v->>'motivo' = 'sin_saldo', '10c: AGUJERO GRAVE: sirve con plata ajena. ' || v::text;

  -- ══ 11. El ticket abre la canilla ════════════════════════════════════════
  v := public.tablet_abrir_sesion_qr(v_qr2, 952, t952);
  assert (v->>'ok')::boolean and v->>'origen' = 'ticket', '11a: el ticket sirve. ' || v::text;
  -- Mientras Juan sirve en la 952, Emi no puede abrirla (y viceversa).
  v := public.tablet_abrir_sesion_qr(v_qr2, 951, t951);
  assert v->>'motivo' = 'canilla_ocupada' and v->>'cliente' = 'Emi',
         '11b: canilla ocupada, con el primer nombre. ' || v::text;
  v := public.cerrar_sesion(
         (public.canilla_sesion_activa(952, t952)->'sesion'->>'sesion_id')::bigint,
         473, 6064, t952);
  assert (v->>'ok')::boolean, '11c: cierra. ' || v::text;
  -- 473 ml a $4.000 el litro = $1.892
  assert (v->>'costo_centavos')::bigint = 189200, '11d: cobra lo servido. ' || v::text;

  -- ══ 12. Ticket perdido: se anula y se da otro ════════════════════════════
  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;
  v := public.caja_emitir_pase('28999111', false);
  assert v->'pase'->>'codigo' = v_qr2, '12a: reimprimir da el mismo. ' || v::text;
  v := public.caja_emitir_pase('28999111', true);
  assert (v->>'ok')::boolean and v->'pase'->>'codigo' <> v_qr2, '12b: renovar da otro. ' || v::text;
  reset role;
  w := public.tablet_abrir_sesion_qr(v_qr2, 952, t952);
  assert w->>'motivo' = 'qr_anulado' and w->>'origen' = 'ticket',
         '12c: AGUJERO: el ticket perdido sigue valiendo. ' || w::text;
  v_qr2 := v->'pase'->>'codigo';

  -- ══ 13. Los pases vencen ═════════════════════════════════════════════════
  update public.pases set vence_en = now() - interval '1 second'
   where codigo_hash = public._hash(substr(v_qr2, 7));
  v := public.tablet_abrir_sesion_qr(v_qr2, 952, t952);
  assert v->>'motivo' = 'qr_vencido' and v->>'origen' = 'ticket',
         '13a: el ticket de anoche no sirve. ' || v::text;
  -- Pero la plata sigue siendo del cliente: mañana pide otro ticket.
  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;
  v := public.caja_emitir_pase('28999111', false);
  assert (v->>'ok')::boolean and v->'pase'->>'codigo' <> v_qr2
     and (v->>'saldo_centavos')::bigint = 800000 - 189200,
         '13b: ticket nuevo con el saldo que le quedaba. ' || v::text;
  v_qr2 := v->'pase'->>'codigo';

  -- ══ 14. Devolver el saldo: se va la plata y se anula el ticket ═══════════
  v := public.caja_devolver_tarjeta(v->>'uid', 'se va');
  assert (v->>'ok')::boolean and (v->>'devuelto_centavos')::bigint = 800000 - 189200,
         '14a: devuelve lo que quedaba. ' || v::text;
  reset role;
  assert (select nombre from public.clientes where dni = '28999111' and tipo = 'ticket') = 'Juan Perez'
     and (select nota from public.tarjetas t join public.clientes c using (uid)
           where c.dni = '28999111' and c.tipo = 'ticket') = 'Juan Perez',
         '14b: el cliente conserva su nombre';
  v := public.tablet_abrir_sesion_qr(v_qr2, 952, t952);
  assert v->>'motivo' = 'qr_anulado', '14c: AGUJERO: el ticket devuelto sigue abriendo. ' || v::text;

  -- ══ 15. El cierre de caja cuenta solo el efectivo ════════════════════════
  perform set_config('request.jwt.claims', ADMIN, true);
  set local role authenticated;
  v := public.arqueo(T0 - interval '1 second', now() + interval '1 second');
  assert (v->>'ok')::boolean, '15a: arqueo. ' || v::text;
  -- Cargas: 10.000 efectivo (app) + 5.000 débito + 3.000 efectivo = 18.000
  assert (v->>'cargas_centavos')::bigint = 1800000,                       '15b: total. ' || v::text;
  assert (v->'cargas_por_medio'->'efectivo'->>'centavos')::bigint = 1300000, '15c: efectivo. ' || v::text;
  assert (v->'cargas_por_medio'->'debito'->>'centavos')::bigint = 500000,    '15d: débito. ' || v::text;
  -- En el cajón: 13.000 de efectivo menos los 6.108 devueltos.
  assert (v->>'neto_caja_centavos')::bigint = 1300000 - (800000 - 189200),
         '15e: el débito no está en el cajón. ' || v::text;

  -- ══ 16. El padrón ════════════════════════════════════════════════════════
  v := public.admin_listar_cuentas('28999111', 'todas');
  assert (v->>'ok')::boolean and jsonb_array_length(v->'cuentas') = 2,
         '16a: las dos cuentas del DNI (app y ticket). ' || v::text;
  v := public.admin_listar_cuentas('cesaretti', 'con-saldo');
  assert jsonb_array_length(v->'cuentas') = 1 and v->'cuentas'->0->>'tipo' = 'app',
         '16b: busca por nombre. ' || v::text;
  perform set_config('request.jwt.claims', CAJERO, true);
  v := public.admin_listar_cuentas(null, 'todas');
  assert v->>'motivo' = 'no_autorizado', '16c: el padrón es del admin. ' || v::text;

  -- ══ 17. Celular nuevo: lo habilita la caja ═══════════════════════════════
  v := public.caja_habilitar_celular('30111222');
  assert (v->>'ok')::boolean, '17a: habilita. ' || v::text;
  reset role;
  -- El celular viejo quedó afuera, y sus QR también.
  v := public.cliente_estado('30111222', CEL_A);
  assert v->>'motivo' = 'sesion_invalida', '17b: el viejo ya no entra. ' || v::text;
  -- Con el nombre de otro no alcanza.
  v := public.cliente_entrar('30111222', 'Roberto Gomez', CEL_B);
  assert v->>'motivo' = 'nombre_no_coincide', '17c: nombre y DNI tienen que coincidir. ' || v::text;
  -- Con el propio, sí. Y no hace falta escribirlo idéntico.
  v := public.cliente_entrar('30111222', 'emiliano cesaretti', CEL_B);
  assert (v->>'ok')::boolean and not (v->>'nueva')::boolean, '17d: entra el dueño. ' || v::text;
  -- La sesión de la canilla 951 sigue abierta: el saldo no se movió.
  assert (v->>'saldo_centavos')::bigint = 1000000, '17e: conserva el saldo. ' || v::text;

  -- ══ 18. Salir desvincula el celular ══════════════════════════════════════
  v := public.cliente_salir('30111222', CEL_B);
  assert (v->>'ok')::boolean, '18a: sale. ' || v::text;
  v := public.cliente_estado('30111222', CEL_B);
  assert v->>'motivo' = 'sesion_invalida', '18b: ya no está adentro. ' || v::text;
  v := public.cliente_entrar('30111222', 'Emi Cesaretti', CEL_A);
  assert (v->>'ok')::boolean, '18c: vuelve a entrar desde otro. ' || v::text;

  -- ══ 19. Una sesión que nadie atiende no traba la canilla ═════════════════
  -- La de Emi en la 951 lleva "tres minutos" sin que el ESP32 reporte nada.
  update public.sesiones set abierta_en = now() - interval '3 minutes' where id = v_ses;
  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;
  v := public.caja_vender('27000333', 'Lucia Diaz', 400000, 'transferencia', 'k-tk-9');
  reset role;
  v := public.tablet_abrir_sesion_qr(v->'pase'->>'codigo', 951, t951);
  assert (v->>'ok')::boolean, '19a: la canilla se libera sola. ' || v::text;
  assert (select estado from public.sesiones where id = v_ses) = 'abandonada',
         '19b: la vieja queda abandonada, no cerrada (acepta el cierre tardío)';
  -- Si en cambio el ESP32 venía reportando, no se toca.
  update public.sesiones set abierta_en = now() - interval '3 minutes', visto_en = now(), ml_parcial = 120
   where grifo_id = 951 and estado = 'abierta';
  v := public.cliente_generar_pase('30111222', CEL_A);
  v := public.tablet_abrir_sesion_qr(v->>'codigo', 951, t951);
  assert v->>'motivo' = 'canilla_ocupada' and v->>'cliente' = 'Lucia',
         '19c: AGUJERO: soltó una sesión que se estaba sirviendo. ' || v::text;

  -- ══ 20. El podio muestra nombres ═════════════════════════════════════════
  w := public.pantalla_estado(952, t952) -> 'ranking';
  assert jsonb_array_length(w) = 1 and w->0->>'tarjeta' = 'Juan' and (w->0->>'ml')::int = 473,
         '20: el podio de la jornada, con el primer nombre. ' || w::text;

  -- ══ 21. Una canilla no puede habilitar cero mililitros ═══════════════════
  begin
    update public.grifos set ml_minimos = 0 where id = 951;
    raise exception '21: AGUJERO: ml_minimos = 0 abre sesiones sin límite';
  exception when check_violation then null;
  end;

  -- ══ 22. Permisos: quién puede llamar qué ═════════════════════════════════
  set local role anon;
  begin
    perform public.caja_vender('27000333', 'x', 100, 'efectivo', 'z');
    raise exception '22a: AGUJERO: anon puede vender';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.tablet_abrir_sesion('X', 951, t951);
    raise exception '22b: AGUJERO: anon abre sesión con solo el uid';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public._cargar('X', 100, 'x', 'x', 'efectivo', null);
    raise exception '22c: AGUJERO GRAVE: anon puede cargar saldo';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.clientes limit 1;
    raise exception '22d: AGUJERO: anon lee el padrón';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.pases limit 1;
    raise exception '22e: AGUJERO: anon lee los pases';
  exception when insufficient_privilege then null;
  end;
  -- Lo que sí puede: la app del cliente y la pantalla.
  perform public.cliente_estado('30111222', CEL_A);
  perform public.cliente_generar_pase('30111222', CEL_A);
  perform public.tablet_abrir_sesion_qr('GRIFO:' || repeat('0', 32), 951, 'x');
  reset role;

  -- Un cajero no lee el padrón por la tabla, ni los pases.
  perform set_config('request.jwt.claims', CAJERO, true);
  set local role authenticated;
  select count(*) into n from public.clientes;
  assert n = 0, '22f: AGUJERO: el cajero lee la tabla de clientes';
  begin
    perform 1 from public.pases limit 1;
    raise exception '22g: AGUJERO: un logueado lee los pases';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

select '✅ TODAS LAS PRUEBAS DEL QR PASARON' as resultado;

rollback;
