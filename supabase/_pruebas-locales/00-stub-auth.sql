-- ═════════════════════════════════════════════════════════════════════════════
-- ⛔ SOLO PARA UN POSTGRES LOCAL DE PRUEBAS. NO CORRER EN SUPABASE. ⛔
--
-- Supabase ya trae el esquema `auth` con la tabla de usuarios y auth.uid().
-- Esto lo imita en un Postgres pelado para poder probar las políticas RLS
-- sin depender de la nube.
--
-- Tiene una guarda: si detecta que auth.uid() ya existe, aborta.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    raise exception
      'ABORTADO: auth.uid() ya existe. Esto es un Supabase real y este archivo es solo para pruebas locales.';
  end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- En Supabase, auth.uid() saca el usuario del JWT que manda PostgREST.
-- Acá leemos el mismo setting, así el codigo de las policies es idéntico.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

grant usage on schema auth to authenticated, anon, service_role;
