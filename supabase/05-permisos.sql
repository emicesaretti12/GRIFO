-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Verificación del modelo de permisos
--
-- Comprueba que la anon key (la que va grabada en el ESP32, o sea PÚBLICA)
-- pueda hacer EXACTAMENTE dos cosas y nada más.
--
-- Pegar en el editor SQL de Supabase y ejecutar. Si algo está mal expuesto,
-- corta con un error que dice qué.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  -- ── Tablas: anon no puede tocar ninguna ───────────────────────────────────
  begin
    set local role anon; perform 1 from public.tarjetas limit 1; reset role;
    raise exception 'AGUJERO: anon puede leer public.tarjetas';
  exception when insufficient_privilege then reset role; end;

  begin
    set local role anon; perform 1 from public.sesiones limit 1; reset role;
    raise exception 'AGUJERO: anon puede leer public.sesiones';
  exception when insufficient_privilege then reset role; end;

  begin
    set local role anon; perform 1 from public.grifos limit 1; reset role;
    raise exception 'AGUJERO GRAVE: anon puede leer public.grifos (ahi estan los hashes de token)';
  exception when insufficient_privilege then reset role; end;

  begin
    set local role anon; perform 1 from public.movimientos limit 1; reset role;
    raise exception 'AGUJERO: anon puede leer public.movimientos';
  exception when insufficient_privilege then reset role; end;

  begin
    set local role anon;
    update public.tarjetas set saldo_centavos = saldo_centavos + 1;
    reset role;
    raise exception 'AGUJERO GRAVE: anon puede modificar saldos a mano';
  exception when insufficient_privilege then reset role; end;

  -- ── Funciones de caja y mantenimiento: fuera del alcance de anon ──────────
  begin
    set local role anon; perform public.cargar_saldo('X', 100); reset role;
    raise exception 'AGUJERO GRAVISIMO: anon puede cargarse saldo solo';
  exception when insufficient_privilege then reset role; end;

  begin
    set local role anon; perform public.rotar_token_grifo(1); reset role;
    raise exception 'AGUJERO GRAVE: anon puede rotar tokens de grifo';
  exception when insufficient_privilege then reset role; end;

  begin
    set local role anon; perform public.cerrar_sesiones_abandonadas(15); reset role;
    raise exception 'AGUJERO: anon puede correr la funcion de mantenimiento';
  exception when insufficient_privilege then reset role; end;

  -- ── Lo que anon SÍ tiene que poder hacer ──────────────────────────────────
  begin
    set local role anon;
    perform public.abrir_sesion('__chequeo__', 1, 'token-cualquiera');
    perform public.cerrar_sesion(-1, 0, 0, 'token-cualquiera');
    reset role;
  exception when insufficient_privilege then
    reset role;
    raise exception 'ROTO: anon NO puede ejecutar las RPC. El dispositivo no va a poder trabajar.';
  end;

  raise notice 'PERMISOS OK';
end $$;

select '✅ PERMISOS OK — anon solo puede ejecutar las dos RPC, y con token' as resultado;
