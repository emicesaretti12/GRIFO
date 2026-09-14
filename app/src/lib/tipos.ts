export type Rol = 'cajero' | 'admin'

/**
 * Las columnas de `grifos` que el personal puede leer por la tabla.
 *
 * **No usar `select('*')` sobre `grifos`.** El permiso de lectura es por
 * columna —para que `token_hash` no lo vea nadie— y `*` lo pide igual, así que
 * Postgres rechaza la consulta entera con `permission denied for table grifos`.
 *
 * La lista tampoco incluye `costo_litro_centavos`: eso sale solo por
 * `admin_listar_grifos()`.
 */
// Va en una sola linea y con `as const` a proposito: supabase-js deriva el tipo
// de la fila parseando este string en tiempo de compilacion. Partido en dos con
// `+` deja de ser un literal y el tipo degenera en `GenericStringError[]`.
export const COLUMNAS_GRIFO = 'id, nombre, precio_litro_centavos, pulsos_por_litro, ml_minimos, ml_vaso, activo, token_rotado_en, estilo, descripcion, abv, ibu, color, imagen_url, ultimo_latido, firmware, cierres_pendientes, senal_dbm, ip_local' as const

export type Grifo = {
  id: number
  nombre: string
  precio_litro_centavos: number
  /** Solo lo devuelve `admin_listar_grifos()`. Por la tabla no sale:
   *  con el costo y el precio se calcula el margen, y el margen no es
   *  informacion de cajero. */
  costo_litro_centavos?: number
  pulsos_por_litro: number
  ml_minimos: number
  ml_vaso: number
  activo: boolean
  token_rotado_en: string | null
  estilo: string | null
  descripcion: string | null
  abv: number | null
  ibu: number | null
  color: string | null
  imagen_url: string | null

  // ── Salud, solo por `admin_listar_grifos()` ───────────────────────────────
  // Lo que manda el ESP32 en su latido, cada minuto.
  ultimo_latido?: string | null
  firmware?: string | null
  cierres_pendientes?: number | null
  senal_dbm?: number | null
  ip_local?: string | null
}

// ── Órdenes para la canilla ─────────────────────────────────────────────────
// Son las tres cosas que solo puede hacer el aparato. El resto (precio,
// calibración, si está activa) lo resuelve el servidor sin pedirle permiso a
// nadie, y llega en la autorización.
export type TipoOrden = 'reiniciar' | 'wifi' | 'olvidar_wifi'

export type OrdenCanilla = {
  id: number
  grifo_id: number
  grifo: string
  tipo: TipoOrden
  /** El SSID se conserva para el historial. La clave nunca sale del servidor. */
  ssid: string | null
  creada_en: string
  entregada_en: string | null
  aplicada_en: string | null
  cancelada_en: string | null
}

export type EstadoOrden = 'aplicada' | 'cancelada' | 'entregada' | 'esperando'

export function estadoDeOrden(o: OrdenCanilla): EstadoOrden {
  if (o.aplicada_en) return 'aplicada'
  if (o.cancelada_en) return 'cancelada'
  if (o.entregada_en) return 'entregada'
  return 'esperando'
}

export const NOMBRE_ORDEN: Record<TipoOrden, string> = {
  reiniciar: 'Reiniciar',
  wifi: 'Cambiar de red WiFi',
  olvidar_wifi: 'Borrar el WiFi y abrir el portal',
}

/** Qué tan lejos está una orden de haber pasado algo.
 *
 *  `entregada` es un estado real y no un detalle: la canilla ya la recibió pero
 *  todavía no la ejecutó, porque **no ejecuta órdenes mientras está sirviendo**.
 *  Ver eso en pantalla es la diferencia entre "no llegó" y "llegó y está
 *  esperando el momento".
 */
export const DETALLE_ORDEN: Record<EstadoOrden, string> = {
  esperando: 'Todavía no la recibió. La busca en cada latido, cada 30 s.',
  entregada: 'Ya la recibió. La aplica en cuanto termine lo que está haciendo.',
  aplicada: 'Hecho.',
  cancelada: 'Cancelada antes de que la recibiera.',
}

/** Qué tan al día está el latido de una canilla.
 *
 *  Tres minutos de tolerancia sobre un latido por minuto: aguanta dos perdidos
 *  antes de dar la alarma. Un umbral más ajustado avisaría por cada bache de
 *  WiFi, y una alarma que suena por nada es una alarma que nadie mira.
 */
export type SaludCanilla = 'en-linea' | 'sin-señal' | 'nunca'

export function saludDeCanilla(ultimoLatido?: string | null): SaludCanilla {
  if (!ultimoLatido) return 'nunca'
  const hace = Date.now() - new Date(ultimoLatido).getTime()
  return hace < 3 * 60 * 1000 ? 'en-linea' : 'sin-señal'
}

/** "hace 2 min", "hace 3 h". Para que el número se lea sin hacer cuentas. */
export function haceCuanto(iso?: string | null): string {
  if (!iso) return 'nunca'
  const seg = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seg < 60)    return 'recién'
  if (seg < 3600)  return `hace ${Math.floor(seg / 60)} min`
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`
  return `hace ${Math.floor(seg / 86400)} d`
}

export type Movimiento = {
  id: number
  tipo: 'carga' | 'consumo' | 'ajuste' | 'devolucion'
  motivo?: string | null
  centavos: number
  saldo_resultante: number
  referencia: string | null
  creado_en: string
}

export type SesionAbierta = {
  id: number
  grifo_id: number
  abierta_en: string
  ml_maximos: number
}

export type FichaTarjeta = {
  ok: true
  existe: true
  uid: string
  saldo_centavos: number
  bloqueada: boolean
  bloqueada_motivo: string | null
  nota: string | null
  movimientos: Movimiento[]
  sesion_abierta: SesionAbierta | null
}

export type FichaTarjetaNueva = { ok: true; existe: false; uid: string }
export type RespuestaError = { ok: false; motivo: string; detalle?: string }

export type RespuestaFicha = FichaTarjeta | FichaTarjetaNueva | RespuestaError

export type Sesion = {
  id: number
  uid: string
  grifo_id: number
  estado: 'abierta' | 'cerrada' | 'abandonada'
  ml_servidos: number | null
  pulsos: number | null
  costo_centavos: number | null
  /** Lo que le costó al bar el líquido servido. Facturado − esto = ganancia. */
  costo_producto_centavos: number | null
  ml_parcial: number
  intentos_cierre: number
  costo_recortado: boolean
  abierta_en: string
  cerrada_en: string | null
}

/** Una sesión con la canilla abierta ahora mismo.
 *
 *  `ml_parcial` lo escribe el ESP32 mientras sirve, con `reportar_progreso`.
 *  Es la única cosa del sistema que cambia mientras la mirás. */
export type SesionEnVivo = {
  id: number
  uid: string
  grifo_id: number
  ml_parcial: number
  ml_maximos: number
  precio_litro_centavos: number
  saldo_inicial_centavos: number
  abierta_en: string
  visto_en: string | null
}

export type Tarjeta = {
  uid: string
  saldo_centavos: number
  bloqueada: boolean
  bloqueada_motivo: string | null
  nota: string | null
  actualizada_en: string
}

/** Traduce los `motivo` que devuelven las RPC a algo que el cajero entienda. */
export const MOTIVOS: Record<string, string> = {
  no_autorizado: 'No tenés permiso para hacer esto.',
  uid_invalido: 'El número de tarjeta no es válido.',
  monto_invalido: 'El monto tiene que ser mayor a cero.',
  tarjeta_desconocida: 'Esa tarjeta no existe.',
  tarjeta_bloqueada: 'La tarjeta está bloqueada.',
  sin_saldo: 'La tarjeta no tiene saldo suficiente.',
  grifo_desconocido: 'Ese grifo no existe o está fuera de servicio.',
  sesion_abierta_en_otro_grifo: 'La tarjeta ya tiene una sesión abierta en otra canilla.',
  sesion_desconocida: 'Esa sesión no existe.',
  token_invalido: 'El token del grifo no es válido.',
  precio_invalido: 'El precio tiene que ser mayor a cero.',
  calibracion_invalida: 'La calibración tiene que ser mayor a cero.',
  sin_token: 'El grifo no tiene token. Generá uno antes de activarlo.',
  vaso_invalido: 'El vaso de referencia tiene que ser mayor a cero.',
  litros_invalidos: 'Los litros del barril tienen que ser mayores a cero.',
  falta_motivo: 'El ajuste necesita un motivo.',
  falta_nombre: 'Hay que poner el nombre del cliente.',
  nombre_muy_largo: 'El nombre es demasiado largo (máximo 80 caracteres).',
  sesion_abierta: 'La tarjeta está apoyada en un grifo. Retirala primero.',
  rango_invalido: 'El período está al revés: la fecha de fin es anterior a la de inicio.',
  saldo_insuficiente: 'El ajuste dejaría la tarjeta en negativo.',
  costo_invalido: 'El costo no puede ser negativo.',

  // ── Canillas: alta, baja y órdenes ────────────────────────────────────────
  falta_nombre_canilla: 'Hay que ponerle un nombre a la canilla.',
  tiene_ventas: 'Esta canilla ya vendió. No se borra: desactivala, y la historia queda intacta.',
  tiene_barriles: 'Esta canilla tiene barriles cargados. Sacá el inventario antes de borrarla.',
  tipo_desconocido: 'Esa orden no existe. Puede ser una app más nueva que el servidor.',
  falta_ssid: 'Hay que poner el nombre exacto de la red.',
  ya_no_se_puede: 'La canilla ya la aplicó. No se puede cancelar.',
  color_invalido: 'El color tiene que ser hexadecimal, tipo #c8811f.',
  usuario_inexistente: 'Ese usuario no existe. Invitalo primero desde Supabase.',
  rol_invalido: 'Rol inválido.',
  no_podes_darte_de_baja_solo: 'No podés darte de baja a vos mismo.',
}

export function mensajeDeError(r: { motivo?: string; detalle?: string }): string {
  if (!r.motivo) return 'Error desconocido.'
  return r.detalle ?? MOTIVOS[r.motivo] ?? r.motivo
}

export type RespuestaDevolucion =
  | { ok: true; uid: string; devuelto_centavos: number; saldo_centavos: number
      cliente?: string | null; nada_que_devolver?: boolean; movimiento_id?: number }
  | { ok: false; motivo: string; detalle?: string }

/** Cierre de caja de un período. Todos los montos en centavos enteros.
 *
 *  Los campos del bloque de abajo llegan SOLO si quien pregunta es admin: un
 *  cajero necesita cuadrar el cajón, no saber cuánto gana el bar. El backend
 *  los omite, así que acá van opcionales y no como algo que se pueda ocultar
 *  desde la interfaz. */
export type Arqueo = {
  ok: true
  es_admin: boolean
  desde: string
  hasta: string
  cargas_centavos: number
  cargas_cantidad: number
  devoluciones_centavos: number
  devoluciones_cantidad: number
  ajustes_centavos: number
  ajustes_cantidad: number
  /** Lo que tiene que haber de más en el cajón por operaciones de tarjeta. */
  neto_caja_centavos: number
  sesiones_abiertas: number

  consumo?: { sesiones: number; ml: number; centavos: number; costo_centavos: number }
  margen_centavos?: number
  /** Plata ya cobrada que todavía se debe en cerveza. Es un pasivo, no ganancia. */
  saldo_en_circulacion_centavos?: number
  por_persona?: {
    nombre: string; cargas: number; devoluciones: number
    ajustes: number; operaciones: number
  }[]
}

export type RespuestaAsignacion =
  | { ok: true; uid: string; nombre: string; saldo_centavos: number
      creada: boolean; nombre_anterior: string | null }
  | { ok: false; motivo: string; detalle?: string }
