-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Entregar una tarjeta a un cliente
--
-- Correr después de 01, 02, 07, 10, 12 y 14.
--
-- Faltaba el primer paso de todo el circuito: **entregar la tarjeta**.
--
-- Las tarjetas vienen vírgenes de fábrica y se reusan entre clientes. Cuando
-- una sale de la pila y va a una persona, en caja le ponen su nombre. Ese
-- nombre es lo que después permite decir "esta tarjeta es de Juan de la mesa 4"
-- cuando aparece perdida, cuando hay que devolverla, o cuando alguien discute
-- un consumo.
--
-- La columna `tarjetas.nota` existía y se leía en la ficha, en el padrón y en
-- la devolución... pero no había forma de escribirla. Una tarjeta entregada
-- nunca podía tener nombre.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Guarda de orden ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'caja_devolver_tarjeta') then
    raise exception
      E'FALTAN ARCHIVOS ANTERIORES.\n\n'
      'Corré en este orden:\n'
      '   01-schema.sql -> 02-funciones.sql -> 07-personal.sql -> 10-pantallas.sql\n'
      '   -> 12-barriles.sql -> 14-devoluciones.sql\n'
      'y recién después este.';
  end if;
end $$;


-- ── Quién entregó la tarjeta y cuándo ───────────────────────────────────────
-- Es el rastro de la entrega. Si mañana un cliente dice que nunca recibió esa
-- tarjeta, o aparece una cargada sin dueño, esto dice quién la dio y a qué hora.
alter table public.tarjetas add column if not exists asignada_en  timestamptz;
alter table public.tarjetas add column if not exists asignada_por uuid references auth.users(id);

comment on column public.tarjetas.nota is
  'Nombre del cliente que tiene la tarjeta ahora. NULL = libre, en la pila.';
comment on column public.tarjetas.asignada_en is
  'Última vez que se entregó esta tarjeta. No se borra al devolverla: es historial de la entrega, no estado.';


-- ── Entregar la tarjeta ─────────────────────────────────────────────────────
-- Da de alta la tarjeta si es la primera vez que se ve (vienen vírgenes, no
-- están en la base hasta que alguien las entrega) y le pone el nombre.
--
-- Deliberadamente NO cobra ni carga saldo: entregar y cargar son dos cosas
-- distintas y la caja puede necesitar hacer una sin la otra —entregar una
-- tarjeta en cero, o recargar una ya entregada—. La pantalla las encadena
-- cuando corresponde; la base no las ata.
create or replace function public.caja_asignar_tarjeta(
  p_uid text, p_nombre text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       text;
  v_nombre    text;
  v_anterior  text;
  v_saldo     bigint;
  v_bloqueada boolean;
  v_creada    boolean := false;
begin
  if not public.es_personal() then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  v_uid := upper(trim(coalesce(p_uid, '')));
  if v_uid = '' then
    return jsonb_build_object('ok', false, 'motivo', 'uid_invalido');
  end if;

  v_nombre := trim(coalesce(p_nombre, ''));
  if v_nombre = '' then
    return jsonb_build_object('ok', false, 'motivo', 'falta_nombre');
  end if;
  if length(v_nombre) > 80 then
    return jsonb_build_object('ok', false, 'motivo', 'nombre_muy_largo');
  end if;

  -- Alta de la tarjeta si es la primera vez que aparece. En cero: la plata
  -- entra por cargar_saldo, que es la única puerta que asienta en el libro
  -- mayor. Acá no se crea saldo de la nada.
  insert into public.tarjetas (uid, saldo_centavos)
  values (v_uid, 0)
  on conflict (uid) do nothing;
  v_creada := found;

  select nota, saldo_centavos, bloqueada
    into v_anterior, v_saldo, v_bloqueada
    from public.tarjetas where uid = v_uid
     for update;

  -- Una tarjeta bloqueada se dio de baja por algo: se perdió, la robaron, hubo
  -- un problema. Entregarla sin desbloquearla primero deja al cliente con una
  -- tarjeta que no le va a servir en el grifo.
  if v_bloqueada then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_bloqueada',
      'detalle', 'La tarjeta está bloqueada. Desbloqueala antes de entregarla.');
  end if;

  update public.tarjetas
     set nota           = v_nombre,
         asignada_en    = now(),
         asignada_por   = (select auth.uid()),
         actualizada_en = now()
   where uid = v_uid;

  return jsonb_build_object(
    'ok', true,
    'uid', v_uid,
    'nombre', v_nombre,
    'saldo_centavos', v_saldo,
    'creada', v_creada,
    -- La pantalla usa esto para avisar antes de pisar a un cliente por otro.
    'nombre_anterior', v_anterior);
end;
$$;

comment on function public.caja_asignar_tarjeta(text, text) is
  'Entrega una tarjeta a un cliente: la da de alta si es nueva y le pone el nombre. No mueve plata.';


-- ── Permisos ────────────────────────────────────────────────────────────────
revoke all on function public.caja_asignar_tarjeta(text, text) from public, anon, authenticated;
grant execute on function public.caja_asignar_tarjeta(text, text) to authenticated;

do $$ begin raise notice '✅ 16-clientes.sql aplicado'; end $$;
