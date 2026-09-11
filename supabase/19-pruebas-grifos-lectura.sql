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

-- ── 5. Quien no es admin NO puede usar admin_listar_grifos() ───────────────
--
-- La primera versión de esta prueba creaba un cajero de mentira insertando en
-- `auth.users`. Dos cosas mal:
--
--   · Escribir en la tabla de autenticación real para correr un test es una
--     idea pésima, aunque después se borre. Un test no ensucia el sistema que
--     está probando.
--
--   · Andaba en el Postgres local y fallaba en Supabase, porque el stub de
--     pruebas tiene `email text unique` y el `auth.users` de verdad no: ahí la
--     unicidad va junto con el proveedor. El `on conflict (email)` no encontraba
--     a qué agarrarse.
--
--     Un doble de prueba que no se parece al original te da confianza falsa.
--
-- Esta versión no crea nada. Le pone al JWT un `sub` que no está en `personal`
-- —o sea alguien logueado que no es del bar— y verifica que la función lo
-- rechace. Eso es exactamente la propiedad que importa.
do $$
declare
  v_desconocido uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_desconocido)::text, true);
  set local role authenticated;

  assert not public.es_admin(), '5: un uuid desconocido no deberia ser admin';

  begin
    perform * from public.admin_listar_grifos();
    raise exception '5: alguien que no es admin pudo ver el costo de las canillas';
  exception
    when insufficient_privilege then null;   -- errcode 42501, el que levanta la funcion
  end;

  reset role;
end $$;


-- ── 6. Un cajero de verdad sí puede leer nombre y precio ───────────────────
-- Corre solo si ya hay un cajero cargado. Los necesita para laburar: si esto
-- fallara, nos habríamos pasado de restrictivos al cerrar el permiso.
do $$
declare
  v_cajero uuid;
begin
  select p.user_id into v_cajero
    from public.personal p
   where p.rol = 'cajero' and p.activo
   limit 1;

  if v_cajero is null then
    raise notice '6: omitida, no hay ningun cajero cargado todavia';
    return;
  end if;

  perform set_config('request.jwt.claims',
                     json_build_object('sub', v_cajero)::text, true);
  set local role authenticated;

  perform id, nombre, precio_litro_centavos, activo from public.grifos;

  reset role;
end $$;


select '✅ TODAS LAS PRUEBAS DE LECTURA DE CANILLAS PASARON' as resultado;
