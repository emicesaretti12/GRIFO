-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Cargar saldo desde la app con Mercado Pago
--
-- Correr después de 29-qr.sql. Idempotente.
--
-- El cliente elige un monto en su app, paga en Mercado Pago y el saldo se
-- acredita solo. Acá está la mitad que vive en la base; la otra mitad es la
-- función `supabase/functions/mercadopago`, que es la que habla con Mercado
-- Pago. Ver docs/mercado-pago.md.
--
-- ── Quién acredita ──────────────────────────────────────────────────────────
-- La app NO acredita nada. Que el navegador del cliente diga "ya pagué" no
-- prueba que pagó: cualquiera puede armar ese pedido a mano.
--
-- Acredita la función del servidor, y solo después de preguntarle a Mercado
-- Pago por ese pago con la credencial del bar. La plata se mueve por lo que
-- contesta Mercado Pago, no por lo que dice quien avisa.
--
--   Es no confiar en el webhook: se lo usa como timbre. Suena, y uno va a
--   mirar por la mirilla quién es.
--
-- Por eso las tres funciones de abajo son solo de `service_role`: ni la app ni
-- un logueado pueden llamarlas.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Guarda de orden ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = '_cliente_app') then
    raise exception E'FALTA CORRER 29-qr.sql PRIMERO.';
  end if;
end $$;


-- ── Pagos ───────────────────────────────────────────────────────────────────
-- Un intento de carga. Nace 'pendiente' cuando el cliente toca "Pagar" y pasa
-- a 'aprobado' cuando Mercado Pago confirma. El id viaja a Mercado Pago como
-- `external_reference`: es el hilo que une su pago con nuestra billetera.
create table if not exists public.recargas_mp (
  id              uuid primary key default gen_random_uuid(),
  uid             text not null references public.tarjetas(uid),
  centavos        bigint not null check (centavos > 0),
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente', 'aprobado', 'rechazado')),
  mp_preferencia  text,
  mp_pago_id      text,
  detalle         text,
  movimiento_id   bigint references public.movimientos(id),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create index if not exists recargas_mp_uid_idx on public.recargas_mp (uid, creado_en desc);

comment on table public.recargas_mp is
  'Intentos de carga por Mercado Pago. La plata entra al saldo solo por pago_acreditar.';

alter table public.recargas_mp enable row level security;
revoke all on table public.recargas_mp from anon, authenticated;
grant all on table public.recargas_mp to service_role;
grant select on table public.recargas_mp to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                  and tablename = 'recargas_mp' and policyname = 'admin_lee_recargas_mp') then
    create policy admin_lee_recargas_mp on public.recargas_mp
      for select to authenticated using (public.es_admin());
  end if;
end $$;


-- ── Crear el intento ────────────────────────────────────────────────────────
-- Valida que quien pide sea el dueño de la cuenta (DNI + secreto del celular)
-- y que el monto tenga sentido. Los topes están acá y no en la app: la app se
-- puede saltear.
create or replace function public.pago_crear(
  p_dni text, p_dispositivo text, p_centavos bigint
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  MINIMO constant bigint := 100000;      -- $ 1.000
  MAXIMO constant bigint := 20000000;    -- $ 200.000
  v_c    public.clientes_qr := public._cliente_app(p_dni, p_dispositivo);
  v_id   uuid;
begin
  if v_c.uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'sesion_invalida');
  end if;
  if (select bloqueada from public.tarjetas where uid = v_c.uid) then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_bloqueada');
  end if;
  if p_centavos is null or p_centavos < MINIMO or p_centavos > MAXIMO
     or p_centavos % 100 <> 0 then
    return jsonb_build_object('ok', false, 'motivo', 'monto_fuera_de_rango',
                              'minimo', MINIMO, 'maximo', MAXIMO);
  end if;

  -- Un freno al que toca "Pagar" cien veces: cada intento le pide una
  -- preferencia a Mercado Pago.
  if (select count(*) from public.recargas_mp
       where uid = v_c.uid and creado_en > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'motivo', 'demasiados_intentos');
  end if;

  insert into public.recargas_mp (uid, centavos) values (v_c.uid, p_centavos)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'pago_id', v_id,
                            'nombre', v_c.nombre, 'dni', v_c.dni, 'centavos', p_centavos);
end $$;


-- ── Anotar la preferencia que devolvió Mercado Pago ─────────────────────────
create or replace function public.pago_anotar_preferencia(p_pago uuid, p_preferencia text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  update public.recargas_mp
     set mp_preferencia = p_preferencia, actualizado_en = now()
   where id = p_pago;
  return jsonb_build_object('ok', found);
end $$;


-- ── Acreditar ───────────────────────────────────────────────────────────────
-- Se llama cuando Mercado Pago ya confirmó el pago como aprobado.
--
-- `p_centavos` es lo que Mercado Pago dice que cobró, no lo que nosotros
-- pedimos: si alguna vez difieren, lo que entró a la cuenta del bar es lo que
-- manda.
--
-- Idempotente por el id del pago de Mercado Pago: el aviso llega varias veces
-- (el webhook reintenta, y la app también pregunta al volver). El índice único
-- de `movimientos.clave_idempotencia` garantiza una sola acreditación por pago.
-- Y si el cliente pagó DOS veces la misma preferencia, son dos pagos con dos
-- ids: se acreditan los dos, porque el bar cobró dos veces.
create or replace function public.pago_acreditar(
  p_pago uuid, p_mp_pago_id text, p_centavos bigint
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.recargas_mp;
  v_r jsonb;
begin
  if coalesce(trim(p_mp_pago_id), '') = '' or p_centavos is null or p_centavos <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

  select * into v_p from public.recargas_mp where id = p_pago for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'pago_desconocido');
  end if;

  v_r := public._cargar(v_p.uid, p_centavos, 'mercadopago',
                        'mp:' || trim(p_mp_pago_id), 'mercadopago', null);
  if not coalesce((v_r->>'ok')::boolean, false) then
    return v_r;
  end if;

  update public.recargas_mp
     set estado         = 'aprobado',
         mp_pago_id     = coalesce(mp_pago_id, trim(p_mp_pago_id)),
         movimiento_id  = coalesce(movimiento_id, (v_r->>'movimiento_id')::bigint),
         detalle        = case when p_centavos <> centavos
                               then 'Mercado Pago cobró un monto distinto al pedido'
                               else detalle end,
         actualizado_en = now()
   where id = p_pago;

  return jsonb_build_object(
    'ok', true,
    'repetida', coalesce((v_r->>'repetida')::boolean, false),
    'estado', 'aprobado',
    'acreditado_centavos', p_centavos,
    'saldo_centavos', (select saldo_centavos from public.tarjetas where uid = v_p.uid));
end $$;


-- ── Rechazado o cancelado ───────────────────────────────────────────────────
-- Solo pisa un 'pendiente': un pago aprobado no se "des-aprueba" porque llegue
-- tarde el aviso de un intento anterior con la tarjeta rechazada.
create or replace function public.pago_rechazar(p_pago uuid, p_detalle text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  update public.recargas_mp
     set estado = 'rechazado', detalle = left(p_detalle, 200), actualizado_en = now()
   where id = p_pago and estado = 'pendiente';
  return jsonb_build_object('ok', true, 'cambio', found);
end $$;


-- ── En qué quedó un pago, para el cliente que vuelve de pagar ───────────────
create or replace function public.pago_estado(
  p_dni text, p_dispositivo text, p_pago uuid
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_c public.clientes_qr := public._cliente_app(p_dni, p_dispositivo);
  v_p public.recargas_mp;
begin
  if v_c.uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'sesion_invalida');
  end if;
  select * into v_p from public.recargas_mp where id = p_pago and uid = v_c.uid;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'pago_desconocido');
  end if;
  return jsonb_build_object('ok', true, 'pago_id', v_p.id, 'estado', v_p.estado,
    'centavos', v_p.centavos,
    'saldo_centavos', (select saldo_centavos from public.tarjetas where uid = v_c.uid));
end $$;


-- ── Permisos: todo esto es del servidor y de nadie más ──────────────────────
revoke all on function public.pago_crear(text, text, bigint)              from public, anon, authenticated;
revoke all on function public.pago_anotar_preferencia(uuid, text)         from public, anon, authenticated;
revoke all on function public.pago_acreditar(uuid, text, bigint)          from public, anon, authenticated;
revoke all on function public.pago_rechazar(uuid, text)                   from public, anon, authenticated;
revoke all on function public.pago_estado(text, text, uuid)               from public, anon, authenticated;

grant execute on function public.pago_crear(text, text, bigint)           to service_role;
grant execute on function public.pago_anotar_preferencia(uuid, text)      to service_role;
grant execute on function public.pago_acreditar(uuid, text, bigint)       to service_role;
grant execute on function public.pago_rechazar(uuid, text)                to service_role;
grant execute on function public.pago_estado(text, text, uuid)            to service_role;

-- Las piezas internas de 29 que estas funciones usan corren como el dueño
-- (son SECURITY DEFINER), así que service_role no necesita permiso sobre ellas.

do $$ begin raise notice '✅ 31-mercadopago.sql aplicado'; end $$;
