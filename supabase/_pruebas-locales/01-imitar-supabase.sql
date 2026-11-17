-- SOLO LOCAL: imita lo que Supabase trae de fábrica para correr el POS.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
grant usage on schema extensions to public;
alter table auth.users add column if not exists instance_id uuid, add column if not exists aud text,
  add column if not exists role text, add column if not exists encrypted_password text,
  add column if not exists email_confirmed_at timestamptz, add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now(), add column if not exists raw_app_meta_data jsonb default '{}',
  add column if not exists raw_user_meta_data jsonb default '{}', add column if not exists confirmation_token text,
  add column if not exists recovery_token text, add column if not exists email_change text,
  add column if not exists email_change_token_new text, add column if not exists is_super_admin boolean,
  add column if not exists phone text, add column if not exists last_sign_in_at timestamptz;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', current_user::text) $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb $$;
create schema if not exists cron;
create table if not exists cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (n, s, c)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create or replace function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
create schema if not exists net;
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text primary key, decrypted_secret text);
create schema if not exists realtime;
create table if not exists realtime.messages (id bigserial primary key, topic text, event text, payload jsonb, private boolean, inserted_at timestamptz default now());
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language sql security definer as $$ insert into realtime.messages (topic, event, payload, private) values (topic, event, payload, private) $$;
grant usage on schema cron, net, vault, realtime to public;
do $$ begin if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname = 'postgres') then create role postgres superuser; end if; end $$;
create table if not exists auth.identities (id uuid primary key, user_id uuid references auth.users(id) on delete cascade,
  provider_id text, identity_data jsonb, provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz);
-- Lo que Supabase da por defecto en el esquema public (la seguridad la ponen RLS y los revoke).
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
