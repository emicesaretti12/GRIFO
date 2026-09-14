-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — dar de alta y de baja canillas desde la app
--
-- Hasta acá las canillas se creaban **desde el SQL Editor de Supabase**. Eso
-- funciona mientras el que lo hace seas vos. El día que el bar quiera agregar
-- una canilla y vos no estés, el sistema deja de servir.
--
--   Es la tarea que quedó como "corré este script a mano". Mientras hay una
--   sola persona que sabe, parece que está resuelta.
--
-- ── Por qué borrar casi nunca se puede ──────────────────────────────────────
-- Una canilla con ventas NO se borra. Sus sesiones son el registro de plata que
-- entró, y la fila del grifo es lo que les da nombre y precio. Borrarla dejaría
-- el arqueo hablando de una canilla que no existe.
--
-- Para eso ya está `activo = false`: la canilla desaparece de la operación y la
-- historia queda intacta.
--
--   Es el soft delete. Lo que participó de una transacción no se borra: se da
--   de baja.
--
-- Borrar de verdad queda solo para la canilla que se creó por error y nunca
-- sirvió nada.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.admin_crear_grifo(
  p_nombre           text,
  p_precio_litro     bigint,
  p_pulsos_por_litro numeric default 450,
  p_ml_minimos       int     default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id int;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede crear canillas.'
      using errcode = '42501';
  end if;

  if coalesce(btrim(p_nombre), '') = '' then
    return jsonb_build_object('ok', false, 'motivo', 'falta_nombre_canilla');
  end if;

  if coalesce(p_precio_litro, 0) <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'precio_invalido');
  end if;

  if coalesce(p_pulsos_por_litro, 0) <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'calibracion_invalida');
  end if;

  -- El id se elige acá y no con un identity porque es el número que el humano
  -- ve y escribe: va en el `secrets.h` del ESP32 y en el nombre de la red del
  -- portal (GRIFO-1). Un salto en la secuencia por un insert fallido dejaría
  -- una canilla "3" al lado de una "5" sin que exista la "4", y eso confunde a
  -- quien tiene que ir a conectarlas.
  --
  -- El lock es sobre la tabla y no hace falta que sea fino: dar de alta una
  -- canilla pasa cuatro veces en la vida del bar.
  lock table public.grifos in exclusive mode;
  select coalesce(max(id), 0) + 1 into v_id from public.grifos;

  insert into public.grifos (id, nombre, precio_litro_centavos,
                             pulsos_por_litro, ml_minimos, activo)
  values (v_id, btrim(p_nombre), p_precio_litro,
          p_pulsos_por_litro, greatest(coalesce(p_ml_minimos, 50), 0),
          -- Nace APAGADA a propósito. Una canilla sin token no puede vender, y
          -- una que figura "en servicio" sin poder servir es una mentira en el
          -- tablero. Se prende cuando está conectada de verdad.
          false);

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function public.admin_crear_grifo(text, bigint, numeric, int)
  from public, anon;
grant execute on function public.admin_crear_grifo(text, bigint, numeric, int)
  to authenticated;


create or replace function public.admin_borrar_grifo(p_grifo int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede borrar canillas.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.grifos where id = p_grifo) then
    return jsonb_build_object('ok', false, 'motivo', 'grifo_desconocido');
  end if;

  -- Una sola sesión, aunque sea de hace un año, alcanza para que no se borre.
  -- Esa fila es plata que entró, y el arqueo la lee por el nombre del grifo.
  if exists (select 1 from public.sesiones where grifo_id = p_grifo) then
    return jsonb_build_object('ok', false, 'motivo', 'tiene_ventas');
  end if;

  -- Un barril es inventario que alguien pagó. Tampoco se borra de costado.
  if exists (select 1 from public.barriles where grifo_id = p_grifo) then
    return jsonb_build_object('ok', false, 'motivo', 'tiene_barriles');
  end if;

  delete from public.grifos where id = p_grifo;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.admin_borrar_grifo(int) from public, anon;
grant execute on function public.admin_borrar_grifo(int) to authenticated;
