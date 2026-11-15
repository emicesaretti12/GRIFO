// ═════════════════════════════════════════════════════════════════════════════
// GRIFO — Cargar saldo con Mercado Pago (función del servidor)
//
// Es la única parte del sistema que habla con Mercado Pago, y la única que
// conoce la credencial del bar. Hace tres cosas:
//
//   crear      La app pide "quiero cargar $ 5.000". Se anota el intento en la
//              base y se le pide a Mercado Pago un link de pago.
//   webhook    Mercado Pago avisa "pasó algo con el pago 123". Se le pregunta
//              a Mercado Pago qué pasó, y si está aprobado se acredita.
//   verificar  La app, al volver de pagar, pregunta "¿ya entró?". Hace lo mismo
//              que el webhook, por si el aviso se demoró o nunca llegó.
//
// ── La regla que no se rompe ─────────────────────────────────────────────────
// Nunca se acredita por lo que dice el que avisa. Ni la app ("ya pagué") ni el
// webhook ("aprobado") mueven plata: lo único que se cree es la respuesta de
// Mercado Pago a una pregunta hecha con la credencial del bar.
//
//   Es un webhook usado como timbre. Suena, y uno va a mirar por la mirilla.
//
// Y se puede preguntar las veces que haga falta: la base acredita cada pago una
// sola vez (ver pago_acreditar en 31-mercadopago.sql).
//
// ── Secretos ─────────────────────────────────────────────────────────────────
// Van en Supabase → Edge Functions → Secrets. NUNCA en el repositorio ni en la
// app. Ver docs/mercado-pago.md.
//
//   MP_ACCESS_TOKEN     la credencial de producción de la cuenta del bar
//   APP_URL             dónde está la app, ej. https://grifo-phi.vercel.app
//   MP_WEBHOOK_SECRET   (opcional) la clave secreta de los webhooks
//   GRIFO_SERVICE_KEY   (opcional) solo si el proyecto ya no trae la clave
//                       service_role de siempre
// ═════════════════════════════════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2'

const MP = 'https://api.mercadopago.com'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const CLAVE_SERVIDOR = Deno.env.get('GRIFO_SERVICE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const MP_TOKEN = Deno.env.get('MP_ACCESS_TOKEN') ?? ''
const MP_SECRETO = Deno.env.get('MP_WEBHOOK_SECRET') ?? ''
const APP_URL = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '')

const db = createClient(SUPABASE_URL, CLAVE_SERVIDOR, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Json = Record<string, unknown>

function responder(cuerpo: Json, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function rpc(nombre: string, args: Json): Promise<Json> {
  const { data, error } = await db.rpc(nombre, args)
  if (error) throw new Error(`${nombre}: ${error.message}`)
  return (data ?? {}) as Json
}

async function mp(ruta: string, opciones: RequestInit = {}): Promise<{ ok: boolean; estado: number; cuerpo: Json }> {
  const r = await fetch(MP + ruta, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${MP_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opciones.headers ?? {}),
    },
  })
  let cuerpo: Json = {}
  try { cuerpo = await r.json() } catch { /* sin cuerpo */ }
  return { ok: r.ok, estado: r.status, cuerpo }
}

/** Fecha como la pide Mercado Pago: con milisegundos y la diferencia horaria
 *  escrita, no con la "Z". Argentina no cambia la hora: siempre −03:00. */
function fechaMP(d: Date): string {
  const local = new Date(d.getTime() - 3 * 3600 * 1000)
  return local.toISOString().replace('Z', '-03:00')
}

// ─────────────────────────────────────────────────────────────────────────────
// Procesar un pago: lo que hacen el webhook y la verificación
// ─────────────────────────────────────────────────────────────────────────────
// Recibe el pago TAL COMO LO DEVUELVE Mercado Pago (nunca el del aviso).
async function procesar(pago: Json): Promise<string> {
  const referencia = String(pago.external_reference ?? '')
  const idPago = String(pago.id ?? '')
  const estado = String(pago.status ?? '')

  // Un cobro de la misma cuenta que no nació acá (un QR del mostrador, otro
  // sistema): no es nuestro, se deja pasar.
  if (!ES_UUID.test(referencia) || !idPago) return 'ajeno'

  if (estado === 'approved') {
    // Solo pesos: si alguna vez llega otra moneda, que lo mire una persona.
    if (pago.currency_id && pago.currency_id !== 'ARS') {
      console.error(`pago ${idPago}: moneda inesperada ${pago.currency_id}`)
      return 'moneda_inesperada'
    }
    const centavos = Math.round(Number(pago.transaction_amount) * 100)
    if (!Number.isFinite(centavos) || centavos <= 0) return 'monto_invalido'

    const r = await rpc('pago_acreditar', {
      p_pago: referencia, p_mp_pago_id: idPago, p_centavos: centavos,
    })
    if (!r.ok) console.error(`pago ${idPago}: no se acreditó (${r.motivo})`)
    return r.ok ? 'acreditado' : String(r.motivo)
  }

  if (estado === 'rejected' || estado === 'cancelled') {
    await rpc('pago_rechazar', { p_pago: referencia, p_detalle: String(pago.status_detail ?? estado) })
    return 'rechazado'
  }

  if (estado === 'refunded' || estado === 'charged_back') {
    // La plata volvió al cliente DESPUÉS de acreditarse. No se descuenta sola:
    // puede que ya se la haya tomado. Queda anotado para que lo vea un admin.
    console.error(`pago ${idPago} (${referencia}): ${estado}. Revisar el saldo a mano.`)
    return estado
  }

  return 'pendiente'   // pending, in_process, authorized…
}

// ─────────────────────────────────────────────────────────────────────────────
// crear
// ─────────────────────────────────────────────────────────────────────────────
async function crear(c: Json): Promise<Response> {
  if (!MP_TOKEN || !APP_URL) return responder({ ok: false, motivo: 'mp_no_configurado' })

  const intento = await rpc('pago_crear', {
    p_dni: String(c.dni ?? ''), p_dispositivo: String(c.dispositivo ?? ''),
    p_centavos: Number(c.centavos),
  })
  if (!intento.ok) return responder(intento)

  const pagoId = String(intento.pago_id)
  const centavos = Number(intento.centavos)
  const ahora = new Date()
  const vuelta = `${APP_URL}/?volver=cliente`

  const pref = await mp('/checkout/preferences', {
    method: 'POST',
    // Si el pedido se repite (un reintento de red), Mercado Pago devuelve la
    // misma preferencia en vez de crear otra.
    headers: { 'X-Idempotency-Key': pagoId },
    body: JSON.stringify({
      items: [{
        id: 'saldo', title: 'Saldo para el bar', quantity: 1,
        currency_id: 'ARS', unit_price: centavos / 100,
      }],
      // El hilo que une el pago de ellos con nuestro intento.
      external_reference: pagoId,
      metadata: { pago_id: pagoId },
      back_urls: { success: vuelta, pending: vuelta, failure: vuelta },
      auto_return: 'approved',
      // Aprobado o rechazado en el momento, sin "en revisión": el cliente está
      // parado frente al grifo.
      binary_mode: true,
      // Sin cupones de pago en efectivo: se acreditan días después.
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
      notification_url: `${SUPABASE_URL}/functions/v1/mercadopago?webhook=1`,
      statement_descriptor: 'GRIFO',
      expires: true,
      expiration_date_from: fechaMP(ahora),
      expiration_date_to: fechaMP(new Date(ahora.getTime() + 30 * 60 * 1000)),
    }),
  })

  const url = String(pref.cuerpo.init_point ?? '')
  if (!pref.ok || !url) {
    console.error('preferencia rechazada', pref.estado, JSON.stringify(pref.cuerpo).slice(0, 500))
    await rpc('pago_rechazar', { p_pago: pagoId, p_detalle: `preferencia ${pref.estado}` })
    return responder({ ok: false, motivo: pref.estado === 401 ? 'mp_credencial_invalida' : 'mp_error' })
  }

  await rpc('pago_anotar_preferencia', { p_pago: pagoId, p_preferencia: String(pref.cuerpo.id ?? '') })
  return responder({ ok: true, pago_id: pagoId, url })
}

// ─────────────────────────────────────────────────────────────────────────────
// verificar
// ─────────────────────────────────────────────────────────────────────────────
async function verificar(c: Json): Promise<Response> {
  const args = {
    p_dni: String(c.dni ?? ''), p_dispositivo: String(c.dispositivo ?? ''),
    p_pago: String(c.pago_id ?? ''),
  }
  if (!ES_UUID.test(args.p_pago)) return responder({ ok: false, motivo: 'pago_desconocido' })

  // Primero se comprueba que el pago sea de quien pregunta. Recién después se
  // gasta una consulta a Mercado Pago.
  const antes = await rpc('pago_estado', args)
  if (!antes.ok || antes.estado === 'aprobado' || !MP_TOKEN) return responder(antes)

  const busqueda = await mp(
    `/v1/payments/search?external_reference=${encodeURIComponent(args.p_pago)}&sort=date_created&criteria=desc&limit=10`)
  if (busqueda.ok && Array.isArray(busqueda.cuerpo.results)) {
    const pagos = busqueda.cuerpo.results as Json[]
    // Los aprobados primero: un intento rechazado anterior no tiene que
    // marcar como rechazado un pago que después sí pasó.
    for (const p of pagos.filter(p => p.status === 'approved')) await procesar(p)
    if (!pagos.some(p => p.status === 'approved' || p.status === 'pending' || p.status === 'in_process')) {
      for (const p of pagos.slice(0, 1)) await procesar(p)
    }
  }

  return responder(await rpc('pago_estado', args))
}

// ─────────────────────────────────────────────────────────────────────────────
// webhook
// ─────────────────────────────────────────────────────────────────────────────
function aHex(b: ArrayBuffer): string {
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')
}

/** Comprueba la firma del aviso. Devuelve null si el aviso no trae firma. */
async function firmaValida(req: Request, idDato: string): Promise<boolean | null> {
  const firma = req.headers.get('x-signature')
  if (!firma) return null
  const partes = new Map(firma.split(',').map(p => {
    const [k, ...v] = p.split('=')
    return [k.trim(), v.join('=').trim()] as [string, string]
  }))
  const ts = partes.get('ts'), v1 = partes.get('v1')
  if (!ts || !v1) return false

  const pedido = req.headers.get('x-request-id') ?? ''
  const texto = `id:${idDato.toLowerCase()};request-id:${pedido};ts:${ts};`
  const clave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(MP_SECRETO), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const esperado = aHex(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(texto)))

  // Comparación de largo fijo: no corta en la primera letra distinta.
  if (esperado.length !== v1.length) return false
  let distinto = 0
  for (let i = 0; i < esperado.length; i++) distinto |= esperado.charCodeAt(i) ^ v1.charCodeAt(i)
  return distinto === 0
}

async function webhook(req: Request, url: URL): Promise<Response> {
  let cuerpo: Json = {}
  try { cuerpo = await req.json() } catch { /* los avisos viejos vienen sin cuerpo */ }

  // Mercado Pago avisa de dos formas, según cómo esté configurado:
  //   nueva:  ?data.id=123&type=payment   + cuerpo { type, data: { id } }
  //   vieja:  ?topic=payment&id=123
  const tipo = String(cuerpo.type ?? url.searchParams.get('type') ?? url.searchParams.get('topic') ?? '')
  const datos = (cuerpo.data ?? {}) as Json
  const idDato = String(url.searchParams.get('data.id') ?? datos.id ?? url.searchParams.get('id') ?? '')

  // Avisos de otras cosas (órdenes, reclamos): gracias, no hace falta.
  if (tipo !== 'payment' || !/^\d+$/.test(idDato)) return responder({ ok: true, ignorado: true })
  if (!MP_TOKEN) return responder({ ok: false, motivo: 'mp_no_configurado' }, 503)

  if (MP_SECRETO) {
    const valida = await firmaValida(req, idDato)
    if (valida === false) {
      console.error(`aviso del pago ${idDato} con firma inválida`)
      return responder({ ok: false, motivo: 'firma_invalida' }, 401)
    }
  }

  // Acá está la mirilla: el estado sale de Mercado Pago, no del aviso.
  const pago = await mp(`/v1/payments/${idDato}`)
  if (pago.estado === 404) return responder({ ok: true, ignorado: true })
  // Si Mercado Pago no contesta, se responde con error: así reintenta el aviso.
  if (!pago.ok) return responder({ ok: false, motivo: 'mp_error' }, 502)

  const resultado = await procesar(pago.cuerpo)
  return responder({ ok: true, resultado })
}

// ─────────────────────────────────────────────────────────────────────────────
export async function atender(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  try {
    if (!SUPABASE_URL || !CLAVE_SERVIDOR) return responder({ ok: false, motivo: 'servidor_sin_configurar' }, 500)
    if (url.searchParams.has('webhook')) return await webhook(req, url)
    if (req.method !== 'POST') return responder({ ok: false, motivo: 'metodo_invalido' }, 405)

    let cuerpo: Json
    try { cuerpo = await req.json() } catch { return responder({ ok: false, motivo: 'pedido_invalido' }) }

    if (cuerpo.accion === 'crear') return await crear(cuerpo)
    if (cuerpo.accion === 'verificar') return await verificar(cuerpo)
    return responder({ ok: false, motivo: 'accion_desconocida' })
  } catch (e) {
    // Un error de verdad (la base caída, un bug). Con 500, Mercado Pago
    // reintenta el aviso más tarde; la app muestra "probá de nuevo".
    console.error(e)
    return responder({ ok: false, motivo: 'error_interno' }, 500)
  }
}

Deno.serve(atender)
