-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — pruebas del latido de las canillas
-- Termina en ROLLBACK: no deja rastro.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_token text;
  v_r     jsonb;
  v_antes timestamptz;
  v_n     int;
  v_admin uuid;
begin
  -- Un grifo de prueba con token propio.
  insert into public.grifos (id, nombre, precio_litro_centavos, pulsos_por_litro,
                             ml_minimos, activo)
  values (912, 'test-salud', 300000, 452.700, 50, false)
  on conflict (id) do nothing;

  -- rotar_token_grifo devuelve un jsonb; el token viene adentro.
  v_token := public.rotar_token_grifo(912) ->> 'token';
  assert v_token is not null, '0: no se pudo generar el token';

  -- ── 1. Un latido con el token bueno queda registrado ──────────────────────
  select g.ultimo_latido into v_antes from public.grifos g where g.id = 912;
  assert v_antes is null, '1: deberia arrancar sin latidos';

  v_r := public.canilla_latido(912, v_token, 'etapa6', 3, -45, '10.0.0.9');
  assert (v_r->>'ok')::boolean, '1: el latido con token valido fallo';

  select g.ultimo_latido into v_antes from public.grifos g where g.id = 912;
  assert v_antes is not null, '1: no se guardo la hora del latido';

  -- ── 2. Los datos del latido quedan guardados ──────────────────────────────
  select g.cierres_pendientes into v_n from public.grifos g where g.id = 912;
  assert v_n = 3, '2: no se guardaron los cierres pendientes';

  select g.senal_dbm into v_n from public.grifos g where g.id = 912;
  assert v_n = -45, '2: no se guardo la senal';

  -- ── 3. Un token inventado NO puede mentir sobre el estado ─────────────────
  -- Importa: si cualquiera pudiera mandar latidos, podria hacer que una canilla
  -- caida figure sana y tapar el problema justo cuando hay que verlo.
  v_r := public.canilla_latido(912, 'token-de-mentira', 'hacker', 0, 0, 'x');
  assert not (v_r->>'ok')::boolean, '3: un token invalido fue aceptado';
  assert v_r->>'motivo' = 'token_invalido', '3: motivo equivocado';

  select g.cierres_pendientes into v_n from public.grifos g where g.id = 912;
  assert v_n = 3, '3: un latido rechazado igual modifico la fila';

  -- ── 4. Un grifo que no existe ─────────────────────────────────────────────
  v_r := public.canilla_latido(99999, 'cualquiera');
  assert not (v_r->>'ok')::boolean, '4: acepto un grifo inexistente';
  assert v_r->>'motivo' = 'grifo_desconocido', '4: motivo equivocado';

  -- ── 5. El personal puede leer las columnas nuevas ─────────────────────────
  -- Esta es la prueba que habria evitado el bug de la pantalla vacia: el
  -- permiso de `grifos` es por columna y las nuevas nacen sin permiso.
  select p.user_id into v_admin from public.personal p where p.rol = 'admin' limit 1;
  if v_admin is not null then
    perform set_config('request.jwt.claims',
                       json_build_object('sub', v_admin)::text, true);
    set local role authenticated;

    perform ultimo_latido, firmware, cierres_pendientes, senal_dbm, ip_local
       from public.grifos;

    -- Y el token sigue siendo invisible para todos.
    begin
      perform token_hash from public.grifos limit 1;
      raise exception '5: AGUJERO GRAVE: se pudo leer token_hash';
    exception when insufficient_privilege then null;
    end;

    reset role;
  else
    raise notice '5: omitida, no hay admin cargado';
  end if;
end $$;

select '✅ TODAS LAS PRUEBAS DE SALUD PASARON' as resultado;

rollback;
