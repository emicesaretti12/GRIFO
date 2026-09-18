-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — pruebas del sondeo de sesión y del alta desde la tablet
-- Termina en ROLLBACK: no deja rastro.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_token text;
  v_r     jsonb;
  v_s     jsonb;
  v_sid   bigint;
begin
  insert into public.grifos (id, nombre, precio_litro_centavos, pulsos_por_litro,
                             ml_minimos, activo)
  values (914, 'test-tablet', 320000, 452.700, 50, true)
  on conflict (id) do update set activo = true, precio_litro_centavos = 320000;

  v_token := public.rotar_token_grifo(914) ->> 'token';

  insert into public.tarjetas (uid, saldo_centavos, nota)
  values ('PRUEBATAB1', 1000000, 'Emi')
  on conflict (uid) do update set saldo_centavos = 1000000, nota = 'Emi';
  insert into public.tarjetas (uid, saldo_centavos, nota)
  values ('PRUEBATAB2', 1000000, 'Otro')
  on conflict (uid) do update set saldo_centavos = 1000000, nota = 'Otro';

  -- ── 1. Sin nadie sirviendo, `sesion` viene nula ───────────────────────────
  v_r := public.canilla_sesion_activa(914, v_token);
  assert (v_r->>'ok')::boolean, '1: fallo el sondeo';
  assert v_r->'sesion' = 'null'::jsonb, '1: aparecio una sesion de la nada';

  -- ── 2. La tablet abre, y el sondeo la ve ──────────────────────────────────
  v_r := public.tablet_abrir_sesion('PRUEBATAB1', 914, v_token);
  assert (v_r->>'ok')::boolean, '2: la tablet no pudo abrir: ' || coalesce(v_r->>'motivo','?');
  v_sid := (v_r->>'sesion_id')::bigint;

  v_s := public.canilla_sesion_activa(914, v_token) -> 'sesion';
  assert v_s is not null and v_s <> 'null'::jsonb, '2: el sondeo no ve la sesion';
  assert (v_s->>'sesion_id')::bigint = v_sid, '2: devolvio otra sesion';
  assert v_s->>'uid' = 'PRUEBATAB1', '2: uid equivocado';

  -- ── 3. Trae lo que el firmware necesita para cortar solo ──────────────────
  -- Es el punto del diseño: con esto el ESP32 convierte el limite a pulsos y de
  -- ahi en adelante no consulta a nadie.
  assert v_s->>'cliente' = 'Emi', '3: no trae el nombre para la bienvenida';
  assert (v_s->>'ml_maximos')::int > 0, '3: sin limite no se puede cortar local';
  assert (v_s->>'pulsos_por_litro')::numeric = 452.700, '3: sin calibracion no hay ml';
  assert (v_s->>'precio_litro_centavos')::bigint = 320000, '3: falta el precio';
  assert (v_s->>'saldo_centavos')::bigint = 1000000, '3: falta el saldo';

  -- ── 4. Una canilla ocupada rechaza a OTRA tarjeta ─────────────────────────
  -- Antes esto lo garantizaba la fisica: una sola tarjeta cabe sobre el lector.
  -- Con la tablet, dos clientes podrian abrir sesion en la misma canilla y el
  -- ESP32 no sabria a cual le esta sirviendo.
  v_r := public.tablet_abrir_sesion('PRUEBATAB2', 914, v_token);
  assert not (v_r->>'ok')::boolean, '4: AGUJERO GRAVE: dos sesiones en una canilla';
  assert v_r->>'motivo' = 'canilla_ocupada', '4: motivo equivocado';
  assert v_r->>'cliente' = 'Emi', '4: no dice quien la esta ocupando';

  -- ── 5. La MISMA tarjeta no es un conflicto: reanuda ───────────────────────
  -- Alguien que vuelve a apoyar su propia tarjeta no es un segundo cliente.
  v_r := public.tablet_abrir_sesion('PRUEBATAB1', 914, v_token);
  assert (v_r->>'ok')::boolean, '5: no dejo reanudar a la misma tarjeta';
  assert (v_r->>'sesion_id')::bigint = v_sid, '5: abrio una sesion nueva en vez de reanudar';

  -- ── 6. Al cerrar, el sondeo deja de devolverla ────────────────────────────
  -- Sin esto el grifo volveria a abrir la valvula para una sesion ya cobrada.
  v_r := public.cerrar_sesion(v_sid, 500, 226, v_token);
  assert (v_r->>'ok')::boolean, '6: no se pudo cerrar';

  v_r := public.canilla_sesion_activa(914, v_token);
  assert v_r->'sesion' = 'null'::jsonb, '6: sigue devolviendo una sesion cerrada';

  -- ── 7. Y ahora la canilla vuelve a estar libre ────────────────────────────
  v_r := public.tablet_abrir_sesion('PRUEBATAB2', 914, v_token);
  assert (v_r->>'ok')::boolean, '7: quedo ocupada despues de cerrar';

  -- ── 8. Un token inventado no puede espiar quien esta sirviendo ────────────
  -- Importa: la respuesta lleva el saldo y el nombre del cliente.
  v_r := public.canilla_sesion_activa(914, 'token-de-mentira');
  assert not (v_r->>'ok')::boolean, '8: acepto un token invalido';
  assert v_r->>'motivo' = 'token_invalido', '8: motivo equivocado';
  assert v_r->'sesion' is null, '8: AGUJERO GRAVE: filtro la sesion igual';

  -- ── 9. Un grifo que no existe ─────────────────────────────────────────────
  v_r := public.canilla_sesion_activa(99999, 'cualquiera');
  assert v_r->>'motivo' = 'grifo_desconocido', '9: motivo equivocado';
end $$;


-- ── 10. El indice unico es una garantia, no una convencion ──────────────────
-- Si alguien inserta a mano salteando las funciones, la base tiene que negarse
-- igual. Un invariante que solo vive en el codigo de la aplicacion no es un
-- invariante.
do $$
declare v_dup boolean := false;
begin
  insert into public.tarjetas (uid, saldo_centavos)
  values ('PRUEBATAB3', 500000) on conflict (uid) do nothing;

  begin
    insert into public.sesiones (uid, grifo_id, saldo_inicial_centavos,
                                 precio_litro_centavos, pulsos_por_litro, ml_maximos)
    values ('PRUEBATAB3', 914, 500000, 320000, 452.700, 1562);
    v_dup := true;
  exception when unique_violation then null;
  end;

  assert not v_dup, '10: AGUJERO GRAVE: la base acepto dos sesiones abiertas en un grifo';
end $$;

select '✅ TODAS LAS PRUEBAS DE SESION ACTIVA PASARON' as resultado;

rollback;
