-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Crear el primer admin
--
-- Se corre UNA sola vez, en el SQL Editor de Supabase.
--
-- ¿Por qué a mano? Huevo y gallina: `admin_set_rol` exige ser admin para poder
-- usarla, así que el primero no puede crearse desde la app. De ahí en adelante,
-- a todo el resto del personal lo das de alta desde la pantalla Personal.
--
-- ANTES de correr esto, el usuario tiene que existir en Supabase Auth:
--   Supabase → Authentication → Users → Add user
--   (mail + contraseña, y marcá "Auto Confirm User" para no tener que validar
--   el mail)
-- ═════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_email  text := 'emicesaretti2428079@gmail.com';   -- ← cambiá acá si hace falta
  v_nombre text := 'Emi';
  v_id     uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);

  if not found then
    raise exception
      E'No existe ningun usuario con el mail %.\n\n'
      'Crealo primero: Supabase -> Authentication -> Users -> Add user\n'
      '(mail + contrasena, marcando "Auto Confirm User"), y volve a correr esto.',
      v_email;
  end if;

  insert into public.personal (user_id, nombre, rol)
  values (v_id, v_nombre, 'admin')
  on conflict (user_id) do update
    set rol = 'admin', activo = true, nombre = coalesce(excluded.nombre, public.personal.nombre);

  raise notice 'Listo: % quedo como admin.', v_email;
end $$;

-- Confirmación
select p.rol, p.nombre, p.activo, u.email
  from public.personal p
  join auth.users u on u.id = p.user_id
 order by p.creado_en;
