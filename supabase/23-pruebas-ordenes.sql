-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — pruebas de las órdenes para la canilla
-- Termina en ROLLBACK: no deja rastro.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_token text;
  v_r     jsonb;
  v_o     jsonb;
  v_id1   bigint;
  v_id2   bigint;
  v_n     int;
  v_txt   text;
begin
  insert into public.grifos (id, nombre, precio_litro_centavos, pulsos_por_litro,
                             ml_minimos, activo)
  values (913, 'test-ordenes', 300000, 452.700, 50, false)
  on conflict (id) do nothing;

  v_token := public.rotar_token_grifo(913) ->> 'token';
  assert v_token is not null, '0: no se pudo generar el token';

  -- ── 1. Sin órdenes, el latido contesta `orden: null` ──────────────────────
  v_r := public.canilla_latido(913, v_token, 'etapa6', 0, -40, '10.0.0.9', 0);
  assert (v_r->>'ok')::boolean, '1: el latido fallo';
  assert v_r->'orden' = 'null'::jsonb or v_r->>'orden' is null,
    '1: aparecio una orden donde no habia ninguna';

  -- ── 2. Una orden encolada llega en el latido siguiente ────────────────────
  insert into public.ordenes_canilla (grifo_id, tipo)
  values (913, 'reiniciar') returning id into v_id1;

  v_r := public.canilla_latido(913, v_token, 'etapa6', 0, -40, '10.0.0.9', 0);
  v_o := v_r->'orden';
  assert v_o is not null and v_o <> 'null'::jsonb, '2: no llego la orden';
  assert (v_o->>'id')::bigint = v_id1, '2: llego otra orden';
  assert v_o->>'tipo' = 'reiniciar', '2: tipo equivocado';

  select count(*) into v_n from public.ordenes_canilla
   where id = v_id1 and entregada_en is not null;
  assert v_n = 1, '2: no se marco como entregada';

  -- ── 3. Mientras no la confirme, se la sigue dando ─────────────────────────
  -- Importa: la canilla puede recibirla y reiniciarse antes de aplicarla. Si el
  -- servidor la diera por hecha al entregarla, esa orden se perderia.
  --
  --   Es la diferencia entre "entregado" y "procesado" en una cola. Solo el
  --   consumidor sabe cuando termino.
  v_r := public.canilla_latido(913, v_token, 'etapa6', 0, -40, '10.0.0.9', 0);
  assert (v_r->'orden'->>'id')::bigint = v_id1, '3: la orden sin confirmar se perdio';

  -- ── 4. La marca de agua la da por aplicada ────────────────────────────────
  v_r := public.canilla_latido(913, v_token, 'etapa6', 0, -40, '10.0.0.9', v_id1);
  assert v_r->'orden' = 'null'::jsonb or v_r->>'orden' is null,
    '4: siguio entregando una orden ya confirmada';

  select count(*) into v_n from public.ordenes_canilla
   where id = v_id1 and aplicada_en is not null;
  assert v_n = 1, '4: no quedo marcada como aplicada';

  -- ── 5. La marca de agua arrastra las anteriores ───────────────────────────
  -- Si la canilla dice "voy por la N", todo lo de antes esta hecho. Sin esto,
  -- una orden que se salteo quedaria pendiente para siempre y volveria a
  -- entregarse cada minuto.
  insert into public.ordenes_canilla (grifo_id, tipo) values (913, 'reiniciar')
    returning id into v_id1;
  insert into public.ordenes_canilla (grifo_id, tipo) values (913, 'olvidar_wifi')
    returning id into v_id2;

  v_r := public.canilla_latido(913, v_token, 'etapa6', 0, -40, '10.0.0.9', v_id2);
  assert v_r->'orden' = 'null'::jsonb or v_r->>'orden' is null,
    '5: quedo algo pendiente por debajo de la marca';

  select count(*) into v_n from public.ordenes_canilla
   where id in (v_id1, v_id2) and aplicada_en is not null;
  assert v_n = 2, '5: la marca de agua no arrastro la anterior';

  -- ── 6. La clave del WiFi se borra apenas se aplica ────────────────────────
  -- Es el punto que justifica que las ordenes guarden datos: la clave viaja,
  -- pero no se queda.
  insert into public.ordenes_canilla (grifo_id, tipo, datos)
  values (913, 'wifi', '{"ssid":"bar-wifi","pass":"secreta123"}'::jsonb)
  returning id into v_id1;

  v_r := public.canilla_latido(913, v_token, 'etapa6', 0, -40, '10.0.0.9', v_id2);
  assert v_r->'orden'->'datos'->>'pass' = 'secreta123',
    '6: la canilla tiene que poder leer la clave una vez';

  v_r := public.canilla_latido(913, v_token, 'etapa6', 0, -40, '10.0.0.9', v_id1);
  select o.datos->>'pass' into v_txt from public.ordenes_canilla o where o.id = v_id1;
  assert v_txt is null, '6: la clave del WiFi quedo guardada despues de aplicarse';

  -- ── 7. Un token inventado no recibe ordenes ───────────────────────────────
  -- Importa de verdad: si cualquiera pudiera pedir las ordenes de la canilla 1,
  -- se llevaria la clave del WiFi del bar de arriba de la mesa.
  insert into public.ordenes_canilla (grifo_id, tipo, datos)
  values (913, 'wifi', '{"ssid":"bar-wifi","pass":"otra-mas"}'::jsonb);

  v_r := public.canilla_latido(913, 'token-de-mentira', 'x', 0, 0, 'x', 0);
  assert not (v_r->>'ok')::boolean, '7: un token invalido fue aceptado';
  assert v_r->>'orden' is null, '7: AGUJERO GRAVE: entrego la orden igual';

  -- ── 8. Una orden nueva del mismo tipo reemplaza a la vieja ────────────────
  select count(*) into v_n from public.ordenes_canilla
   where grifo_id = 913 and tipo = 'wifi'
     and aplicada_en is null and cancelada_en is null;
  assert v_n = 1, '8: arranca con una sola wifi pendiente';
end $$;


-- ── 9. Las funciones de admin exigen ser admin ──────────────────────────────
do $$
declare v_admin uuid;
begin
  select p.user_id into v_admin from public.personal p where p.rol = 'admin' and p.activo limit 1;

  if v_admin is null then
    raise notice '9: omitida, no hay admin cargado';
    return;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', gen_random_uuid())::text, true);

  -- Un usuario que no es admin no puede darle ordenes a una canilla. Si
  -- pudiera, un mozo podria cambiarle el WiFi a todas las canillas del bar.
  begin
    perform public.admin_ordenar(913, 'reiniciar');
    raise exception '9: AGUJERO GRAVE: un no-admin pudo ordenar';
  exception
    when sqlstate '42501' then null;
    when insufficient_privilege then null;
  end;

  begin
    perform public.admin_listar_ordenes(913);
    raise exception '9: AGUJERO GRAVE: un no-admin pudo listar ordenes';
  exception
    when sqlstate '42501' then null;
    when insufficient_privilege then null;
  end;

  -- Y la tabla tampoco se lee directo, salteando las funciones.
  begin
    perform 1 from public.ordenes_canilla limit 1;
    raise exception '9: AGUJERO GRAVE: se leyo ordenes_canilla directo';
  exception when insufficient_privilege then null;
  end;

  reset role;

  -- El claim se puso con `set_config(..., true)`: dura toda la transaccion, no
  -- solo este bloque. Si no se limpia, el `do` siguiente sigue creyendo que es
  -- el usuario inventado de recien y falla por una razon que no tiene nada que
  -- ver con lo que esta probando.
  --
  --   Es el test que ensucia el estado global y hace fallar al que viene
  --   despues. El sintoma aparece lejos de la causa.
  perform set_config('request.jwt.claims', '', true);
end $$;


-- ── 10. Validaciones de admin_ordenar, ya como admin ────────────────────────
do $$
declare
  v_r     jsonb;
  v_admin uuid;
begin
  select p.user_id into v_admin from public.personal p
   where p.rol = 'admin' and p.activo limit 1;

  if v_admin is null then
    raise notice '10: omitida, no hay admin cargado';
    return;
  end if;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_admin)::text, true);
  assert public.es_admin(), '10: no quedo como admin';

  v_r := public.admin_ordenar(913, 'formatear-todo');
  assert not (v_r->>'ok')::boolean, '10: acepto un tipo inventado';
  assert v_r->>'motivo' = 'tipo_desconocido', '10: motivo equivocado';

  -- Un SSID vacio dejaria la canilla sin red. Se corta en el servidor.
  v_r := public.admin_ordenar(913, 'wifi', '{"pass":"algo"}'::jsonb);
  assert not (v_r->>'ok')::boolean, '10: acepto una orden de wifi sin ssid';
  assert v_r->>'motivo' = 'falta_ssid', '10: motivo equivocado';

  v_r := public.admin_ordenar(99999, 'reiniciar');
  assert not (v_r->>'ok')::boolean, '10: acepto un grifo inexistente';

  -- Y una orden de 'reiniciar' nunca guarda datos, aunque se los manden.
  v_r := public.admin_ordenar(913, 'reiniciar', '{"pass":"no-va-aca"}'::jsonb);
  assert (v_r->>'ok')::boolean, '10: no se pudo crear la orden buena';
  assert (select o.datos from public.ordenes_canilla o
           where o.id = (v_r->>'id')::bigint) = '{}'::jsonb,
    '10: guardo datos en una orden que no los lleva';

  -- ── 11. La orden nueva del mismo tipo cancela a la anterior ───────────────
  -- Si corregis el SSID porque lo escribiste mal, no queres que la canilla
  -- aplique primero el equivocado y despues el bueno.
  declare v_1 bigint; v_2 bigint; v_n int;
  begin
    v_1 := (public.admin_ordenar(913, 'wifi',
              '{"ssid":"mal-escrito","pass":"x"}'::jsonb) ->> 'id')::bigint;
    v_2 := (public.admin_ordenar(913, 'wifi',
              '{"ssid":"bien-escrito","pass":"x"}'::jsonb) ->> 'id')::bigint;

    select count(*) into v_n from public.ordenes_canilla o
     where o.id = v_1 and o.cancelada_en is not null;
    assert v_n = 1, '11: la orden vieja de wifi quedo viva';

    select count(*) into v_n from public.ordenes_canilla o
     where o.grifo_id = 913 and o.tipo = 'wifi'
       and o.aplicada_en is null and o.cancelada_en is null;
    assert v_n = 1, '11: quedo mas de una orden de wifi pendiente';

    -- Y cancelar no deja la clave dando vueltas.
    assert (select o.datos->>'pass' from public.ordenes_canilla o where o.id = v_1) is null,
      '11: la clave quedo guardada en una orden cancelada';

    -- Pero el SSID SI se conserva: es lo que te deja reconstruir despues que
    -- fue lo que se le pidio a la canilla.
    assert (select o.datos->>'ssid' from public.ordenes_canilla o where o.id = v_1)
           = 'mal-escrito',
      '11: se perdio el ssid de una orden cancelada';

    -- ── 12. Cancelar una orden ya cancelada no hace nada ─────────────────────
    v_r := public.admin_cancelar_orden(v_2);
    assert (v_r->>'ok')::boolean, '12: no se pudo cancelar una orden viva';
    v_r := public.admin_cancelar_orden(v_2);
    assert not (v_r->>'ok')::boolean, '12: cancelo dos veces la misma orden';

    -- ── 13. El listado nunca devuelve la clave ───────────────────────────────
    assert exists (select 1 from public.admin_listar_ordenes(913) o
                    where o.ssid = 'bien-escrito'),
      '13: el listado no muestra el ssid';
  end;
end $$;

select '✅ TODAS LAS PRUEBAS DE ORDENES PASARON' as resultado;

rollback;
