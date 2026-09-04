export type Rol = 'cajero' | 'admin'

export type Grifo = {
  id: number
  nombre: string
  precio_litro_centavos: number
  costo_litro_centavos: number
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
}

export type Movimiento = {
  id: number
  tipo: 'carga' | 'consumo' | 'ajuste'
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
  saldo_insuficiente: 'El ajuste dejaría la tarjeta en negativo.',
  costo_invalido: 'El costo no puede ser negativo.',
  color_invalido: 'El color tiene que ser hexadecimal, tipo #c8811f.',
  usuario_inexistente: 'Ese usuario no existe. Invitalo primero desde Supabase.',
  rol_invalido: 'Rol inválido.',
  no_podes_darte_de_baja_solo: 'No podés darte de baja a vos mismo.',
}

export function mensajeDeError(r: { motivo?: string; detalle?: string }): string {
  if (!r.motivo) return 'Error desconocido.'
  return r.detalle ?? MOTIVOS[r.motivo] ?? r.motivo
}
