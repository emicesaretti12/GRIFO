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
  -- ── Lo que anon NO tiene que poder hacer ──────────────────────────────────
  begin
    set local role anon;
    perform 1 from public.tarjetas limit 1;
    reset role;
    raise exception 'AGUJERO: anon puede leer public.tarjetas';
  exception
    when insufficient_privilege then reset role;
  end;

  begin
    set local role anon;
    perform 1 from public.sesiones limit 1;
    reset role;
    raise exception 'AGUJERO: anon puede leer public.sesiones';
  exception
    when insufficient_privilege then reset role;
  end;

  begin
    set local role anon;
    perform 1 from public.grifos limit 1;
    reset role;
    raise exception 'AGUJERO: anon puede leer public.grifos';
  exception
    when insufficient_privilege then reset role;
  end;

  begin
    set local role anon;
    update public.tarjetas set saldo_centavos = saldo_centavos + 1;
    reset role;
    raise exception 'AGUJERO GRAVE: anon puede modificar saldos a mano';
  exception
    when insufficient_privilege then reset role;
  end;

  begin
    set local role anon;
    perform public.cerrar_sesiones_abandonadas(15);
    reset role;
    raise exception 'AGUJERO: anon puede correr la funcion de mantenimiento';
  exception
    when insufficient_privilege then reset role;
  end;

  -- ── Lo que anon SÍ tiene que poder hacer ──────────────────────────────────
  begin
    set local role anon;
    perform public.abrir_sesion('__chequeo__', 1);
    perform public.cerrar_sesion(-1, 0, 0);
    reset role;
  exception
    when insufficient_privilege then
      reset role;
      raise exception 'ROTO: anon NO puede ejecutar las RPC. El dispositivo no va a poder trabajar.';
  end;

  raise notice 'PERMISOS OK';
end $$;

select '✅ PERMISOS OK — anon solo puede ejecutar las dos RPC' as resultado;
