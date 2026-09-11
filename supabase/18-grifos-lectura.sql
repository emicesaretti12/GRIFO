-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — arreglo: el personal no podía leer las canillas
--
-- SÍNTOMA: la pantalla "Canillas" mostraba "No hay canillas cargadas" aunque la
-- tabla tuviera filas. Un `select *` contra `public.grifos` devolvía
-- `permission denied for table grifos`, incluso siendo admin.
--
-- CAUSA: el permiso de lectura sobre `grifos` es **por columna** —para que el
-- `token_hash` no lo vea nadie— y las migraciones 10 y 12 agregaron columnas
-- nuevas (`costo_litro_centavos`, `ml_vaso`, `estilo`, `abv`, `ibu`, `color`,
-- `descripcion`, `imagen_url`) sin extender ese permiso.
--
-- Un `grant` por columna es una lista blanca, y una lista blanca no se actualiza
-- sola. Cada columna nueva nace sin permiso, que es el default correcto pero hay
-- que acordarse.
--
--   Es agregar un campo al modelo y olvidarse del serializer. El campo existe,
--   la consulta lo pide, y la respuesta dice que no.
--
-- ── Por qué no se abre TODO lo que no es token_hash ─────────────────────────
--
-- `costo_litro_centavos` es lo que le cuesta el litro al bar. Con eso y el
-- precio se calcula el margen, y **el margen no es información de cajero**.
--
-- Es la misma decisión que ya se tomó en el arqueo: ahí el cajero ve el cajón y
-- las sesiones abiertas, y el margen está detrás de `es_admin()`. Esconder una
-- columna en el front no es una medida de seguridad; la que vale es esta.
--
-- Entonces:
--   · las columnas de presentación  → todo el personal, por `grant`
--   · `costo_litro_centavos`        → solo admin, por `admin_listar_grifos()`
--   · `token_hash`                  → nadie, nunca
-- ═════════════════════════════════════════════════════════════════════════════

grant select (id, nombre, precio_litro_centavos, pulsos_por_litro,
              ml_minimos, ml_vaso, activo, token_rotado_en,
              estilo, descripcion, abv, ibu, color, imagen_url)
  on table public.grifos to authenticated;


-- ── Lectura completa para el editor de canillas ─────────────────────────────
-- Devuelve lo mismo que el `grant` de arriba MÁS el costo. No devuelve
-- `token_hash`: no existe un motivo para sacarlo de la base, ni para el admin.
create or replace function public.admin_listar_grifos()
returns table (
  id                     int,
  nombre                 text,
  precio_litro_centavos  bigint,
  costo_litro_centavos   bigint,
  pulsos_por_litro       numeric,
  ml_minimos             int,
  ml_vaso                int,
  activo                 boolean,
  token_rotado_en        timestamptz,
  estilo                 text,
  descripcion            text,
  abv                    numeric,
  ibu                    int,
  color                  text,
  imagen_url             text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- `security definer` corre con los permisos del dueño de la función, así que
  -- la primera línea del cuerpo tiene que ser la que decide quién puede. Sin
  -- esta guarda, cualquier usuario logueado leería el costo de cada cerveza.
  if not public.es_admin() then
    raise exception 'Solo un administrador puede ver el costo de las canillas.'
      using errcode = '42501';
  end if;

  return query
    select g.id, g.nombre, g.precio_litro_centavos, g.costo_litro_centavos,
           g.pulsos_por_litro, g.ml_minimos, g.ml_vaso, g.activo,
           g.token_rotado_en, g.estilo, g.descripcion, g.abv, g.ibu,
           g.color, g.imagen_url
      from public.grifos g
     order by g.id;
end $$;

revoke all on function public.admin_listar_grifos() from public;
grant execute on function public.admin_listar_grifos() to authenticated;
