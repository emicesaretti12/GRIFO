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
export const COLUMNAS_GRIFO = 'id, nombre, precio_litro_centavos, pulsos_por_litro, ml_minimos, ml_vaso, activo, token_rotado_en, estilo, descripcion, abv, ibu, color, imagen_url, ultimo_latido, firmware, cierres_pendientes, senal_dbm, ip_local, estado_texto, ultimo_evento' as const

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
  /** En qué estado está la máquina del ESP32: ESPERANDO, SIRVIENDO... */
  estado_texto?: string | null
  /** Lo último que le pasó, en castellano. Es el monitor serie del que está
   *  en el bar con el celular y sin computadora. */
  ultimo_evento?: string | null
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

// ── Cuentas de clientes ─────────────────────────────────────────────────────
// Un cliente es un DNI. Puede tener hasta dos cuentas que nunca se mezclan:
//   'app'     la que abrió desde su celular (se gasta solo desde ese celular)
//   'ticket'  la del ticket impreso en la caja (se gasta con ese papel)
// Ver docs/qr.md para el porqué.
export type TipoCuenta = 'app' | 'ticket'

export type MedioPago = 'efectivo' | 'debito' | 'credito' | 'transferencia' | 'mercadopago'

export const MEDIOS: { id: MedioPago; texto: string }[] = [
  { id: 'efectivo', texto: 'Efectivo' },
  { id: 'debito', texto: 'Débito' },
  { id: 'credito', texto: 'Crédito' },
  { id: 'transferencia', texto: 'Transferencia' },
  { id: 'mercadopago', texto: 'Mercado Pago' },
]

export const NOMBRE_MEDIO: Record<string, string> =
  Object.fromEntries(MEDIOS.map(m => [m.id, m.texto]))

export type MovimientoCuenta = Movimiento & { medio_pago: string | null }

/** El QR de un ticket. `codigo` puede venir con o sin el prefijo `GRIFO:`. */
export type PaseTicket = { codigo: string; vence_en: string }

export type FichaCliente = {
  ok: true
  existe: true
  uid: string
  /** Nulo en una billetera de la app de SEN POS: esa tiene usuario, no DNI. */
  dni: string | null
  nombre: string
  tipo: TipoCuenta
  saldo_centavos: number
  bloqueada: boolean
  bloqueada_motivo: string | null
  /** Solo en cuentas de app: si hay un celular unido a la cuenta. */
  celular_vinculado: boolean
  /** Si ese mismo DNI tiene, además, cuenta en la app. */
  tiene_app?: boolean
  movimientos: MovimientoCuenta[]
  sesion_abierta: SesionAbierta | null
  /** El QR de ticket que sigue valiendo esta noche, si hay. */
  pase: PaseTicket | null
}

/** Un DNI que todavía no tiene ticket: alguien que viene por primera vez. */
export type ClienteNuevo = { ok: true; existe: false; dni: string; tiene_app: boolean }

export type RespuestaError = { ok: false; motivo: string; detalle?: string }

export type RespuestaBusqueda = FichaCliente | ClienteNuevo | RespuestaError

export type RespuestaVenta =
  | { ok: true; repetida: boolean; uid: string; dni: string; nombre: string
      cargado_centavos: number; medio: MedioPago; saldo_centavos: number
      movimiento_id: number; pase: PaseTicket }
  | RespuestaError

export type RespuestaPase =
  | { ok: true; uid: string; dni: string; nombre: string; saldo_centavos: number; pase: PaseTicket }
  | RespuestaError

/** Una fila del padrón de cuentas (solo admin). */
export type Cuenta = {
  uid: string
  dni: string | null
  nombre: string | null
  /** `'tarjeta'` es una tarjeta NFC de antes del QR: quedó en el padrón por
   *  si tenía saldo, pero ya no abre ninguna canilla. */
  tipo: TipoCuenta | 'tarjeta'
  saldo_centavos: number
  bloqueada: boolean
  bloqueada_motivo: string | null
  actualizada_en: string
  celular_vinculado: boolean
}

/** El nombre del cliente, traído junto con la sesión (`select('*, tarjetas(nota)')`). */
export type ConCliente = { tarjetas?: { nota: string | null } | null }

/** Cómo nombrar al cliente de una sesión en las pantallas del personal: su
 *  nombre si lo tiene, o los últimos cuatro caracteres de su cuenta. */
export function quien(s: { uid: string } & ConCliente): string {
  return s.tarjetas?.nota?.trim() || `····${s.uid.slice(-4)}`
}

export type Sesion = ConCliente & {
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
export type SesionEnVivo = ConCliente & {
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

/** Traduce los `motivo` que devuelven las RPC a algo que el cajero entienda. */
export const MOTIVOS: Record<string, string> = {
  no_autorizado: 'No tenés permiso para hacer esto.',
  uid_invalido: 'Esa cuenta no es válida.',
  monto_invalido: 'El monto tiene que ser mayor a cero.',
  tarjeta_desconocida: 'Esa cuenta no existe.',
  tarjeta_bloqueada: 'La cuenta está bloqueada.',
  sin_saldo: 'No tiene saldo suficiente.',
  grifo_desconocido: 'Ese grifo no existe o está fuera de servicio.',
  sesion_abierta_en_otro_grifo: 'Ya tiene una sesión abierta en otra canilla.',
  sesion_desconocida: 'Esa sesión no existe.',
  token_invalido: 'El token del grifo no es válido.',
  precio_invalido: 'El precio tiene que ser mayor a cero.',
  calibracion_invalida: 'La calibración tiene que ser mayor a cero.',
  sin_token: 'El grifo no tiene token. Generá uno antes de activarlo.',
  vaso_invalido: 'El vaso de referencia tiene que ser mayor a cero.',
  litros_invalidos: 'Los litros del barril tienen que ser mayores a cero.',
  falta_motivo: 'El ajuste necesita un motivo.',
  falta_nombre: 'Hay que poner el nombre del cliente.',
  nombre_muy_largo: 'El nombre es demasiado largo (máximo 60 caracteres).',
  sesion_abierta: 'Está sirviendo en un grifo ahora. Esperá a que termine.',
  rango_invalido: 'El período está al revés: la fecha de fin es anterior a la de inicio.',
  saldo_insuficiente: 'El ajuste dejaría la cuenta en negativo.',
  costo_invalido: 'El costo no puede ser negativo.',

  // ── Clientes, QR y medios de pago ─────────────────────────────────────────
  dni_invalido: 'El DNI tiene que tener 7 u 8 números.',
  medio_invalido: 'Elegí cómo pagó.',
  falta_clave: 'No se pudo identificar la venta. Recargá la página y probá de nuevo.',
  cliente_desconocido: 'Ese DNI todavía no tiene cuenta.',
  codigo_invalido: 'El código de la app tiene 6 números.',
  codigo_vencido: 'Ese código ya venció o no existe. Pedile que abra su QR de nuevo y te diga el código que ve ahora.',
  qr_desconocido: 'Ese QR no es de este bar.',
  qr_vencido: 'Ese QR ya venció.',
  qr_anulado: 'Ese QR fue reemplazado por uno más nuevo.',
  canilla_sin_conexion: 'La canilla está sin conexión.',
  sin_backend: 'Falta instalar el backend: corré 29-qr.sql en Supabase.',
  sin_turno_abierto: 'No hay una caja abierta en SEN POS. Abrí el turno en el POS y probá de nuevo: lo que se cobra acá entra en ese arqueo.',
  ml_minimos_invalido: 'Los mililitros mínimos tienen que ser al menos 1.',
  datos_invalidos: 'Algún dato no es válido. Revisalo y probá de nuevo.',

  // ── Canillas: alta, baja y órdenes ────────────────────────────────────────
  falta_nombre_canilla: 'Hay que ponerle un nombre a la canilla.',
  tiene_ventas: 'Esta canilla ya vendió. No se borra: desactivala, y la historia queda intacta.',
  tiene_barriles: 'Esta canilla tiene barriles cargados. Sacá el inventario antes de borrarla.',
  tipo_desconocido: 'Esa orden no existe. Puede ser una app más nueva que el servidor.',
  falta_ssid: 'Hay que poner el nombre exacto de la red.',
  ya_no_se_puede: 'La canilla ya la aplicó. No se puede cancelar.',
  canilla_ocupada: 'Alguien está sirviendo en esta canilla. Esperá que termine.',
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
  /** Las cargas, separadas por cómo se pagaron. Falta en una base sin 29-qr.sql. */
  cargas_por_medio?: Record<string, { cantidad: number; centavos: number }>
  /** De las cargas, lo que entró en billetes. */
  efectivo_centavos?: number
  /** Lo que tiene que haber en el cajón: efectivo que entró menos devoluciones. */
  neto_caja_centavos: number
  sesiones_abiertas: number

  consumo?: { sesiones: number; ml: number; centavos: number; costo_centavos: number }
  margen_centavos?: number
  /** Plata ya cobrada que todavía se debe en cerveza. Es un pasivo, no ganancia. */
  saldo_en_circulacion_centavos?: number
  por_persona?: {
    nombre: string; cargas: number; efectivo?: number; devoluciones: number
    ajustes: number; operaciones: number
  }[]
}
