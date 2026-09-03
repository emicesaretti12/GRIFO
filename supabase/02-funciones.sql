-- ═════════════════════════════════════════════════════════════════════════════
-- GRIFO — Funciones
--
-- Todas son SECURITY DEFINER (corren con permisos del dueño, saltean el RLS)
-- y con `search_path = ''`, que obliga a calificar todo con `public.`. Eso
-- cierra la puerta a que alguien cree un objeto con el mismo nombre en otro
-- esquema y se cuele en la función.
--
-- ORDEN DE LOCKS: siempre tarjetas → sesiones, en todas las funciones. Tomar
-- los locks siempre en el mismo orden es lo que evita los deadlocks (dos
-- transacciones esperándose cruzado). Misma regla que en cualquier código
-- concurrente.
--
-- QUIÉN PUEDE LLAMAR QUÉ:
--   anon (grabada en el ESP32, PÚBLICA) → abrir_sesion, cerrar_sesion,
--                                          y encima con el token del grifo
--   service_role (backend de caja)      → cargar_saldo, rotar_token_grifo,
--                                          cerrar_sesiones_abandonadas
-- ═════════════════════════════════════════════════════════════════════════════

-- Las versiones viejas SIN token quedarían callables como sobrecarga y
-- anularían todo el punto del token. Se borran explícitamente.
drop function if exists public.abrir_sesion(text, int);
drop function if exists public.cerrar_sesion(bigint, int, int);


-- ── Tokens de dispositivo ───────────────────────────────────────────────────
-- Genera un token nuevo para un grifo, guarda solo el hash y devuelve el token
-- en claro UNA SOLA VEZ. Anotalo: no hay forma de volver a verlo.
--
-- Es el mismo trato que un personal access token de GitHub.
create or replace function public.rotar_token_grifo(p_grifo int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if not exists (select 1 from public.grifos where id = p_grifo) then
    return jsonb_build_object('ok', false, 'motivo', 'grifo_desconocido');
  end if;

  -- 2 UUID v4 pegados = 64 caracteres hexa, ~244 bits de azar. De sobra.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  update public.grifos
     set token_hash      = encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
         token_rotado_en = now()
   where id = p_grifo;

  return jsonb_build_object(
    'ok',       true,
    'grifo_id', p_grifo,
    'token',    v_token,
    'aviso',    'Guardalo ahora. Se guarda hasheado y no se puede volver a ver.'
  );
end;
$$;


-- ── abrir_sesion ────────────────────────────────────────────────────────────
-- POST /rest/v1/rpc/abrir_sesion
--   { "p_uid": "A1B2C3D4", "p_grifo": 1, "p_token": "..." }
create or replace function public.abrir_sesion(p_uid text, p_grifo int, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       text;
  v_tarjeta   public.tarjetas%rowtype;
  v_grifo     public.grifos%rowtype;
  v_abierta   public.sesiones%rowtype;
  v_ml_max    bigint;
  v_sesion_id bigint;
begin
  v_uid := upper(trim(coalesce(p_uid, '')));
  if v_uid = '' then
    return jsonb_build_object('ok', false, 'motivo', 'uid_invalido');
  end if;

  select * into v_grifo from public.grifos where id = p_grifo and activo;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'grifo_desconocido');
  end if;

  -- Token del dispositivo. FALLA CERRADO: un grifo sin token no opera.
  -- Tener solo la anon key no alcanza para nada.
  if v_grifo.token_hash is null
     or v_grifo.token_hash is distinct from
        encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;

  -- Lock de fila sobre la tarjeta. Serializa TODO lo que le pase a esta tarjeta:
  -- dos grifos que la lean al mismo tiempo hacen cola, no compiten.
  -- Es un mutex, pero por clave: solo bloquea a esta tarjeta, no a la tabla.
  select * into v_tarjeta from public.tarjetas where uid = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_desconocida');
  end if;

  if v_tarjeta.bloqueada then
    return jsonb_build_object('ok', false, 'motivo', 'tarjeta_bloqueada');
  end if;

  select * into v_abierta
    from public.sesiones
   where uid = v_uid and estado = 'abierta'
   limit 1;

  if found then
    if v_abierta.grifo_id = p_grifo then
      -- Mismo grifo: el ESP32 se reinició, o no le llegó la respuesta y
      -- reintenta. Devolvemos LA MISMA sesión en vez de abrir otra.
      -- abrir_sesion también es idempotente.
      return jsonb_build_object(
        'ok',                    true,
        'sesion_id',             v_abierta.id,
        'saldo_centavos',        v_abierta.saldo_inicial_centavos,
        'precio_litro_centavos', v_abierta.precio_litro_centavos,
        'pulsos_por_litro',      v_abierta.pulsos_por_litro,
        'ml_maximos',            v_abierta.ml_maximos,
        'reanudada',             true
      );
    end if;
    -- Otro grifo: la pre-autorización hace su trabajo.
    return jsonb_build_object('ok', false, 'motivo', 'sesion_abierta_en_otro_grifo');
  end if;

  -- Techo de mL que paga el saldo.
  --   ml_max = saldo_centavos * 1000 / precio_litro_centavos
  -- División ENTERA: trunca. Truncar para abajo acá es lo correcto — nunca
  -- habilitamos un mL que el cliente no pagó.
  v_ml_max := (v_tarjeta.saldo_centavos * 1000) / v_grifo.precio_litro_centavos;

  if v_ml_max < v_grifo.ml_minimos then
    return jsonb_build_object(
      'ok', false, 'motivo', 'sin_saldo',
      'saldo_centavos', v_tarjeta.saldo_centavos
    );
  end if;

  insert into public.sesiones (
    uid, grifo_id, saldo_inicial_centavos, precio_litro_centavos,
    costo_litro_centavos, pulsos_por_litro, ml_maximos
  ) values (
    v_uid, p_grifo, v_tarjeta.saldo_centavos, v_grifo.precio_litro_centavos,
    v_grifo.costo_litro_centavos, v_grifo.pulsos_por_litro, v_ml_max
  ) returning id into v_sesion_id;

  return jsonb_build_object(
    'ok',                    true,
    'sesion_id',             v_sesion_id,
    'saldo_centavos',        v_tarjeta.saldo_centavos,
    'precio_litro_centavos', v_grifo.precio_litro_centavos,
    'pulsos_por_litro',      v_grifo.pulsos_por_litro,
    'ml_maximos',            v_ml_max
  );
end;
$$;


-- ── cerrar_sesion ───────────────────────────────────────────────────────────
-- POST /rest/v1/rpc/cerrar_sesion
--   { "p_sesion_id": 1234, "p_ml": 473, "p_pulsos": 214, "p_token": "..." }
create or replace function public.cerrar_sesion(
  p_sesion_id bigint, p_ml int, p_pulsos int, p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     text;
  v_grifo   int;
  v_hash    text;
  v_ses     public.sesiones%rowtype;
  v_costo   bigint;
  v_saldo   bigint;
  v_recorte boolean := false;
begin
  -- Leemos sin lock solo para saber de qué tarjeta y grifo hablamos...
  select uid, grifo_id into v_uid, v_grifo
    from public.sesiones where id = p_sesion_id;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sesion_desconocida');
  end if;

  -- El token tiene que ser el del grifo DE ESTA SESIÓN. Un grifo no puede
  -- liquidar sesiones de otro.
  select token_hash into v_hash from public.grifos where id = v_grifo;
  if v_hash is null
     or v_hash is distinct from
        encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') then
    return jsonb_build_object('ok', false, 'motivo', 'token_invalido');
  end if;

  -- ...y ahora tomamos los locks en el orden canónico: tarjeta, después sesión.
  perform 1 from public.tarjetas where uid = v_uid for update;
  select * into v_ses from public.sesiones where id = p_sesion_id for update;

  -- ── IDEMPOTENCIA ──────────────────────────────────────────────────────────
  -- Si la sesión ya está cerrada, devolvemos EXACTAMENTE la misma respuesta que
  -- la primera vez y no tocamos un centavo. Este es el invariante que impide
  -- cobrarle doble al cliente cuando al ESP32 no le llegó el 200 y reintenta.
  -- Ojo: 'abandonada' NO es terminal — un cierre tardío desde la cola offline
  -- del NVS sí tiene que liquidarse.
  if v_ses.estado = 'cerrada' then
    update public.sesiones
       set intentos_cierre = intentos_cierre + 1
     where id = v_ses.id;
    return jsonb_build_object(
      'ok',             true,
      'saldo_centavos', v_ses.saldo_final_centavos,
      'ml_servidos',    v_ses.ml_servidos,
      'costo_centavos', v_ses.costo_centavos,
      'repetida',       true
    );
  end if;

  if p_ml is null or p_ml < 0 or p_pulsos is null or p_pulsos < 0 then
    return jsonb_build_object('ok', false, 'motivo', 'medicion_invalida');
  end if;

  -- ── COBRO, redondeado HACIA ARRIBA, todo en enteros ───────────────────────
  --   costo = ceil(ml * precio_litro_centavos / 1000)
  -- El truco `(a + 999) / 1000` con división entera es ceil sin tocar floats:
  -- si a es múltiplo exacto de 1000 no cambia nada, y si sobra cualquier resto
  -- empuja al entero siguiente. Nunca regalamos cerveza por truncamiento.
  v_costo := (p_ml::bigint * v_ses.precio_litro_centavos + 999) / 1000;

  select saldo_centavos into v_saldo from public.tarjetas where uid = v_ses.uid;

  -- Red de seguridad. El ESP32 corta localmente al llegar al techo de pulsos,
  -- así que esto no debería pasar nunca. Si pasa, cobramos hasta donde llega el
  -- saldo (jamás negativo) y lo dejamos marcado para revisar.
  if v_costo > v_saldo then
    v_costo   := v_saldo;
    v_recorte := true;
  end if;

  update public.tarjetas
     set saldo_centavos = saldo_centavos - v_costo,
         actualizada_en = now()
   where uid = v_ses.uid
   returning saldo_centavos into v_saldo;

  update public.sesiones
     set estado                  = 'cerrada',
         ml_servidos             = p_ml,
         pulsos                  = p_pulsos,
         costo_centavos          = v_costo,
         -- Lo que le costó al bar ese líquido. Redondeo hacia ABAJO: para el
         -- costo, la asimetría prudente es la contraria a la del cobro — nunca
         -- subestimar la ganancia inventando costo que no existió.
         costo_producto_centavos = (p_ml::bigint * v_ses.costo_litro_centavos) / 1000,
         saldo_final_centavos    = v_saldo,
         costo_recortado         = v_recorte,
         intentos_cierre         = intentos_cierre + 1,
         cerrada_en              = now()
   where id = v_ses.id;

  -- Asiento en el libro mayor. La clave de idempotencia lleva el id de sesión,
  -- así que el índice único garantiza UN consumo por sesión aunque el código
  -- llegara acá dos veces.
  insert into public.movimientos (uid, tipo, centavos, saldo_resultante, sesion_id, clave_idempotencia)
  values (v_ses.uid, 'consumo', -v_costo, v_saldo, v_ses.id, 'sesion:' || v_ses.id);

  return jsonb_build_object(
    'ok',             true,
    'saldo_centavos', v_saldo,
    'ml_servidos',    p_ml,
    'costo_centavos', v_costo
  );
end;
$$;


-- ── cargar_saldo (caja) ─────────────────────────────────────────────────────
-- Carga plata en una tarjeta. Si el UID no existe, crea la tarjeta: la primera
-- carga da de alta al cliente.
--
-- SOLO service_role. Nunca la anon key, nunca un dispositivo.
--
-- p_clave_idempotencia: mandá el nro de ticket / id de la operación de caja. Si
-- la caja reintenta por timeout, la segunda llamada devuelve el resultado de la
-- primera en vez de cargar de nuevo. Mismo principio que cerrar_sesion.
create or replace function public.cargar_saldo(
  p_uid                text,
  p_centavos           bigint,
  p_referencia         text default null,
  p_clave_idempotencia text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    text;
  v_mov    public.movimientos%rowtype;
  v_saldo  bigint;
  v_creada boolean := false;
  v_mov_id bigint;
begin
  v_uid := upper(trim(coalesce(p_uid, '')));
  if v_uid = '' then
    return jsonb_build_object('ok', false, 'motivo', 'uid_invalido');
  end if;

  if p_centavos is null or p_centavos <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'monto_invalido');
  end if;

  -- Idempotencia: ¿ya procesamos esta operación de caja?
  if p_clave_idempotencia is not null then
    select * into v_mov from public.movimientos
     where clave_idempotencia = p_clave_idempotencia;
    if found then
      return jsonb_build_object(
        'ok',             true,
        'uid',            v_mov.uid,
        'saldo_centavos', v_mov.saldo_resultante,
        'movimiento_id',  v_mov.id,
        'repetida',       true
      );
    end if;
  end if;

  -- Alta de la tarjeta si es la primera carga.
  insert into public.tarjetas (uid) values (v_uid) on conflict (uid) do nothing;
  if found then
    v_creada := true;
  end if;

  -- Mismo orden de locks que el resto: la tarjeta primero.
  perform 1 from public.tarjetas where uid = v_uid for update;

  update public.tarjetas
     set saldo_centavos = saldo_centavos + p_centavos,
         actualizada_en = now()
   where uid = v_uid
   returning saldo_centavos into v_saldo;

  insert into public.movimientos (uid, tipo, centavos, saldo_resultante, referencia, clave_idempotencia)
  values (v_uid, 'carga', p_centavos, v_saldo, p_referencia, p_clave_idempotencia)
  returning id into v_mov_id;

  return jsonb_build_object(
    'ok',              true,
    'uid',             v_uid,
    'saldo_centavos',  v_saldo,
    'cargado',         p_centavos,
    'movimiento_id',   v_mov_id,
    'tarjeta_creada',  v_creada
  );
end;
$$;


-- ── Mantenimiento: sesiones colgadas ────────────────────────────────────────
-- Si a un ESP32 le cortan la luz con la tarjeta apoyada, la sesión queda
-- 'abierta' para siempre y esa tarjeta no puede usarse en ningún otro grifo.
--
-- Esto las marca 'abandonada', que libera la tarjeta PERO NO COBRA y NO cierra:
-- si el ESP32 vuelve y drena su cola del NVS, cerrar_sesion todavía la liquida
-- con los mL reales. Cobrar 0 acá rompería el invariante de la cola offline.
create or replace function public.cerrar_sesiones_abandonadas(p_minutos int default 15)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_n int;
begin
  update public.sesiones
     set estado = 'abandonada'
   where estado = 'abierta'
     and abierta_en < now() - make_interval(mins => p_minutos);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- ── Permisos ────────────────────────────────────────────────────────────────
-- En Postgres, PUBLIC recibe EXECUTE sobre toda función nueva por defecto.
-- Hay que sacárselo explícitamente y después dar solo lo justo.
revoke all on function public.abrir_sesion(text, int, text)              from public, anon, authenticated;
revoke all on function public.cerrar_sesion(bigint, int, int, text)      from public, anon, authenticated;
revoke all on function public.cargar_saldo(text, bigint, text, text)     from public, anon, authenticated;
revoke all on function public.rotar_token_grifo(int)                     from public, anon, authenticated;
revoke all on function public.cerrar_sesiones_abandonadas(int)           from public, anon, authenticated;

-- Lo ÚNICO que la anon key del dispositivo puede hacer en toda la base
-- (y encima necesita el token del grifo para que le sirva de algo):
grant execute on function public.abrir_sesion(text, int, text)         to anon;
grant execute on function public.cerrar_sesion(bigint, int, int, text) to anon;

-- Caja y mantenimiento: solo service_role.
grant execute on function public.cargar_saldo(text, bigint, text, text) to service_role;
grant execute on function public.rotar_token_grifo(int)                 to service_role;
grant execute on function public.cerrar_sesiones_abandonadas(int)       to service_role;
