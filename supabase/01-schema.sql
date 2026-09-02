-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Esquema
--
-- Correr en el editor SQL de Supabase. Es idempotente: se puede correr de nuevo
-- sin romper nada.
--
-- Reglas que atraviesan todo el diseño:
--   · La plata SIEMPRE en centavos enteros (bigint). Nunca float.
--   · Las tablas no se exponen a la anon key. Se entra solo por las dos RPC.
--   · Una tarjeta no puede tener dos sesiones abiertas a la vez, y eso lo
--     garantiza un índice, no la aplicación.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── Tarjetas ────────────────────────────────────────────────────────────────
-- El saldo vive ACÁ, nunca en la tarjeta física. La tarjeta solo aporta el UID.
create table if not exists public.tarjetas (
  uid             text primary key,
  saldo_centavos  bigint      not null default 0 check (saldo_centavos >= 0),
  bloqueada       boolean     not null default false,
  nota            text,
  creada_en       timestamptz not null default now(),
  actualizada_en  timestamptz not null default now()
);

comment on table  public.tarjetas is 'Saldo por UID de tarjeta. En centavos enteros.';
comment on column public.tarjetas.saldo_centavos is 'Centavos. El check impide que quede negativo.';


-- ── Grifos ──────────────────────────────────────────────────────────────────
-- Cada grifo tiene su precio (cada cerveza vale distinto) y su calibración.
create table if not exists public.grifos (
  id                     int    primary key,
  nombre                 text   not null,
  precio_litro_centavos  bigint not null check (precio_litro_centavos > 0),
  pulsos_por_litro       numeric(10,3) not null check (pulsos_por_litro > 0),
  ml_minimos             int    not null default 50 check (ml_minimos >= 0),
  activo                 boolean not null default true
);

comment on column public.grifos.pulsos_por_litro is
  'Calibración del caudalímetro (etapa 7). Es una constante física, no plata: numeric está bien.';
comment on column public.grifos.ml_minimos is
  'Si el saldo no alcanza ni para esto, no se abre sesión. Evita abrir una sesión por 3 ml.';


-- ── Estados de una sesión ───────────────────────────────────────────────────
--   abierta     → el cliente tiene la tarjeta apoyada, puede servir
--   cerrada     → liquidada. ESTADO TERMINAL: reintentar el cierre no cobra dos veces
--   abandonada  → quedó colgada (se cortó la luz, el ESP32 murió). Libera la
--                 tarjeta para que pueda usarse en otro grifo, PERO todavía
--                 acepta el cierre tardío que llega desde la cola offline del NVS.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_sesion') then
    create type public.estado_sesion as enum ('abierta', 'cerrada', 'abandonada');
  end if;
end $$;


-- ── Sesiones ────────────────────────────────────────────────────────────────
create table if not exists public.sesiones (
  id                      bigint generated always as identity primary key,
  uid                     text not null references public.tarjetas(uid),
  grifo_id                int  not null references public.grifos(id),
  estado                  public.estado_sesion not null default 'abierta',

  -- SNAPSHOT al abrir. La sesión se liquida con estos valores aunque después
  -- cambien el precio del grifo o la calibración. Si el dueño sube el precio
  -- mientras alguien está sirviendo, se le cobra el precio que vio al empezar.
  saldo_inicial_centavos  bigint not null,
  precio_litro_centavos   bigint not null,
  pulsos_por_litro        numeric(10,3) not null,
  ml_maximos              int    not null,

  -- Resultado, al cerrar
  ml_servidos             int,
  pulsos                  int,
  costo_centavos          bigint,
  saldo_final_centavos    bigint,
  costo_recortado         boolean not null default false,
  intentos_cierre         int     not null default 0,

  abierta_en              timestamptz not null default now(),
  cerrada_en              timestamptz
);

comment on column public.sesiones.costo_recortado is
  'true = el costo superaba el saldo y se cobró solo el saldo. No debería pasar nunca (el ESP32 corta antes). Si aparece, hay que investigar.';
comment on column public.sesiones.intentos_cierre is
  'Cuántas veces llegó cerrar_sesion. >1 significa que el ESP32 reintentó porque no le llegó la respuesta.';

-- ESTA es la garantía de "no podés servir en dos grifos a la vez". No es una
-- validación en el código que se pueda ganar con una condición de carrera:
-- es el motor de base de datos rechazando el INSERT.
create unique index if not exists sesiones_una_abierta_por_tarjeta
  on public.sesiones (uid) where (estado = 'abierta');

create index if not exists sesiones_abiertas_idx
  on public.sesiones (abierta_en) where (estado = 'abierta');

create index if not exists sesiones_uid_idx on public.sesiones (uid, abierta_en desc);


-- ── RLS: las tablas se cierran por completo ─────────────────────────────────
-- Activamos RLS y NO creamos ninguna policy. Sin policy, RLS niega todo.
-- La anon key del dispositivo no puede leer ni escribir una sola fila.
--
-- ¿Y cómo hacen entonces las RPC? Son SECURITY DEFINER: corren con los permisos
-- del dueño de las tablas, que sí pasa. Es exactamente un endpoint de backend:
-- el cliente no toca la base, le pide a una función que haga una operación
-- concreta y validada.
alter table public.tarjetas enable row level security;
alter table public.grifos   enable row level security;
alter table public.sesiones enable row level security;

revoke all on table public.tarjetas from anon, authenticated;
revoke all on table public.grifos   from anon, authenticated;
revoke all on table public.sesiones from anon, authenticated;
