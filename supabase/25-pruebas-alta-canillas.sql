-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — pruebas del alta y baja de canillas
-- Termina en ROLLBACK: no deja rastro.
-- ═════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare
  v_admin uuid;
  v_r     jsonb;
  v_id    int;
  v_max   int;
  v_uid   text;
begin
  select p.user_id into v_admin from public.personal p
   where p.rol = 'admin' and p.activo limit 1;
  if v_admin is null then
    raise notice 'omitidas: no hay admin cargado';
    return;
  end if;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_admin)::text, true);

  -- ── 1. Se crea, y con el id siguiente ─────────────────────────────────────
  select coalesce(max(g.id), 0) into v_max from public.grifos g;
  v_r := public.admin_crear_grifo('Rubia de prueba', 350000);
  assert (v_r->>'ok')::boolean, '1: no se pudo crear';
  v_id := (v_r->>'id')::int;
  assert v_id = v_max + 1, '1: el id no siguio a la secuencia';

  -- ── 2. Nace apagada y sin token ───────────────────────────────────────────
  -- Importa: una canilla que figura "en servicio" sin poder servir es una
  -- mentira en el tablero, y el que mira el tablero decide en base a eso.
  assert not (select g.activo from public.grifos g where g.id = v_id),
    '2: nacio activa sin poder vender';
  assert (select g.token_hash from public.grifos g where g.id = v_id) is null,
    '2: nacio con token';

  -- ── 3. Validaciones ───────────────────────────────────────────────────────
  v_r := public.admin_crear_grifo('   ', 350000);
  assert v_r->>'motivo' = 'falta_nombre_canilla', '3: acepto un nombre vacio';

  v_r := public.admin_crear_grifo('Sin precio', 0);
  assert v_r->>'motivo' = 'precio_invalido', '3: acepto precio cero';

  v_r := public.admin_crear_grifo('Sin calibrar', 350000, 0);
  assert v_r->>'motivo' = 'calibracion_invalida', '3: acepto 0 pulsos por litro';

  -- ── 4. Una canilla sin uso se borra ───────────────────────────────────────
  v_r := public.admin_borrar_grifo(v_id);
  assert (v_r->>'ok')::boolean, '4: no se pudo borrar una canilla sin uso';
  assert not exists (select 1 from public.grifos g where g.id = v_id),
    '4: dijo que la borro y sigue ahi';

  -- ── 5. Una canilla CON ventas no se borra ─────────────────────────────────
  -- Es la prueba que importa. Borrarla dejaria el arqueo hablando de una
  -- canilla que no existe: la sesion guarda el grifo_id, y el nombre y el
  -- precio salen de la fila del grifo.
  v_r := public.admin_crear_grifo('Con ventas', 350000);
  v_id := (v_r->>'id')::int;

  v_uid := 'PRUEBAALTA1';
  insert into public.tarjetas (uid, saldo_centavos)
  values (v_uid, 100000)
  on conflict (uid) do update set saldo_centavos = 100000;

  insert into public.sesiones (uid, grifo_id, saldo_inicial_centavos,
                               precio_litro_centavos, pulsos_por_litro, ml_maximos)
  values (v_uid, v_id, 100000, 350000, 450, 285);

  v_r := public.admin_borrar_grifo(v_id);
  assert not (v_r->>'ok')::boolean, '5: AGUJERO GRAVE: borro una canilla con ventas';
  assert v_r->>'motivo' = 'tiene_ventas', '5: motivo equivocado';
  assert exists (select 1 from public.grifos g where g.id = v_id),
    '5: la canilla con ventas desaparecio igual';

  -- ── 6. Un grifo que no existe ─────────────────────────────────────────────
  v_r := public.admin_borrar_grifo(99999);
  assert v_r->>'motivo' = 'grifo_desconocido', '6: motivo equivocado';

  perform set_config('request.jwt.claims', '', true);
end $$;


-- ── 7. Un no-admin no puede ni crear ni borrar ──────────────────────────────
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claims',
                     json_build_object('sub', gen_random_uuid())::text, true);

  begin
    perform public.admin_crear_grifo('Canilla pirata', 1);
    raise exception '7: AGUJERO GRAVE: un no-admin creo una canilla';
  exception
    when sqlstate '42501' then null;
    when insufficient_privilege then null;
  end;

  begin
    perform public.admin_borrar_grifo(1);
    raise exception '7: AGUJERO GRAVE: un no-admin borro una canilla';
  exception
    when sqlstate '42501' then null;
    when insufficient_privilege then null;
  end;

  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

select '✅ TODAS LAS PRUEBAS DE ALTA DE CANILLAS PASARON' as resultado;

rollback;
