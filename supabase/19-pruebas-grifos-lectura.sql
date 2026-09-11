-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — pruebas de la lectura de canillas
--
-- El bug que originó esto no se veía leyendo el código: el `grant` estaba, la
-- policy estaba, el rol era admin, y la consulta fallaba igual. Estas pruebas
-- ejercen la lectura de verdad, con el rol puesto.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_admin uuid;
  v_n     int;
  v_costo bigint;
begin
  select p.user_id into v_admin from public.personal p where p.rol = 'admin' limit 1;
  if v_admin is null then
    raise exception 'No hay ningun admin cargado. Corre 09-primer-admin.sql primero.';
  end if;

  -- ── 1. El personal puede leer las columnas de presentación ────────────────
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_admin)::text, true);
  set local role authenticated;

  select count(*) into v_n from (
    select id, nombre, precio_litro_centavos, pulsos_por_litro, ml_minimos,
           ml_vaso, activo, token_rotado_en, estilo, descripcion, abv, ibu,
           color, imagen_url
      from public.grifos
  ) t;
  assert v_n >= 0, '1: el personal no pudo leer las columnas de presentacion';

  -- ── 2. NADIE puede leer el token_hash ─────────────────────────────────────
  -- Es la razón por la que el permiso es por columna y no por tabla. Si esto
  -- alguna vez pasa, un cajero podría clonar la identidad de una canilla.
  begin
    perform token_hash from public.grifos limit 1;
    raise exception '2: AGUJERO GRAVE: se pudo leer token_hash';
  exception
    when insufficient_privilege then null;
  end;

  -- ── 3. El costo tampoco sale por la tabla ─────────────────────────────────
  -- El margen no es información de cajero. Sale solo por admin_listar_grifos().
  begin
    perform costo_litro_centavos from public.grifos limit 1;
    raise exception '3: el costo se pudo leer desde la tabla, deberia ser solo-admin';
  exception
    when insufficient_privilege then null;
  end;

  -- ── 4. Un admin sí ve el costo por la RPC ─────────────────────────────────
  select count(*) into v_n from public.admin_listar_grifos();
  assert v_n >= 0, '4: admin_listar_grifos fallo para un admin';

  reset role;
end $$;

-- ── 5. Un cajero NO puede usar admin_listar_grifos() ────────────────────────
-- Se prueba aparte porque necesita crear un cajero, y eso ensucia la
-- transacción de arriba.
do $$
declare
  v_cajero uuid;
  v_admin  uuid;
begin
  select p.user_id into v_admin from public.personal p where p.rol = 'admin' limit 1;

  insert into auth.users (email) values ('cajero-prueba-19@ejemplo.local')
    on conflict (email) do nothing;
  select u.id into v_cajero from auth.users u
   where u.email = 'cajero-prueba-19@ejemplo.local';

  insert into public.personal (user_id, nombre, rol, activo)
  values (v_cajero, 'Cajero de prueba', 'cajero', true)
  on conflict (user_id) do update set rol = 'cajero', activo = true;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_cajero)::text, true);
  set local role authenticated;

  begin
    perform * from public.admin_listar_grifos();
    raise exception '5: un cajero pudo ver el costo de las canillas';
  exception
    when insufficient_privilege then null;   -- errcode 42501, el que levanta la funcion
  end;

  -- Pero el cajero SÍ tiene que poder leer nombre y precio: los necesita para
  -- laburar. Si esto falla, nos pasamos de restrictivos.
  perform id, nombre, precio_litro_centavos, activo from public.grifos;

  reset role;
  delete from public.personal where user_id = v_cajero;
  delete from auth.users where id = v_cajero;
end $$;

select '✅ TODAS LAS PRUEBAS DE LECTURA DE CANILLAS PASARON' as resultado;
