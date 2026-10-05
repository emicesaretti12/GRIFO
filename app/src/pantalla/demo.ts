// ─────────────────────────────────────────────────────────────────────────────
// Modo demostración de la pantalla de canilla:  #/pantalla?demo
//
// Simula una tirada completa, en bucle, sin ESP32, sin tarjeta y sin tocar la
// base: no llama a Supabase ni guarda nada en el dispositivo. Sirve para ver
// la animación en cualquier navegador (la tablet, la compu, el celular) y
// para mostrársela a alguien.
//
// Los mililitros suben a saltos de un segundo, como los informa el ESP32 de
// verdad, y a mitad de la tirada hay una pausa: así se ve la manija cerrarse y
// volver a abrirse con el mismo vaso.
//
// Parámetros opcionales:
//   color=#2a160b      el color de la cerveza (sin el #: color=2a160b)
//   nombre=Stout       lo que dice en la manija y en el panel
//   vaso=500           los mililitros de un vaso
// ─────────────────────────────────────────────────────────────────────────────

const CICLO = 46        // segundos que dura una vuelta completa
const CAUDAL = 30       // ml por segundo con la canilla abierta

export type ParametrosDemo = { color: string; nombre: string; vaso: number }

export function leerDemo(): ParametrosDemo | null {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
  if (!q.has('demo')) return null
  const c = (q.get('color') ?? '').replace('#', '')
  return {
    color: /^[0-9a-f]{6}$/i.test(c) ? `#${c}` : '#d9a21b',
    nombre: (q.get('nombre') ?? 'Golden Ale').slice(0, 40),
    vaso: Math.max(200, Math.min(1000, Number(q.get('vaso')) || 473)),
  }
}

const inicio = Date.now()

/** Lo mismo que devuelve `pantalla_estado`, inventado según el reloj. */
export function estadoDemo(p: ParametrosDemo) {
  const t = (Date.now() - inicio) / 1000
  const vuelta = Math.floor(t / CICLO)
  const s = t % CICLO
  const precio = 320000
  const grifo = {
    id: 0, nombre: p.nombre, estilo: null, descripcion: 'Modo demostración: nada de esto es real',
    abv: 5.2, ibu: 18, color: p.color, imagen_url: null,
    precio_litro_centavos: precio, ml_vaso: p.vaso, activo: true, listo: true,
  }
  const ranking = [{ tarjeta: '····A1F3', ml: 2400, veces: 5 }, { tarjeta: '····77C0', ml: 1610, veces: 3 }, { tarjeta: '····0B9E', ml: 940, veces: 2 }]
  const cliente = { veces: 3, ml_total: 1500, es_primera: false }
  const saldo = 1866880

  // Los ml que lleva, cuantizados a segundos como los manda el ESP32:
  // sirve de 10 a 20 s, pausa hasta los 24 s, y sigue hasta completar el vaso.
  const total = Math.round(p.vaso * 0.99)
  const primera = Math.round(total * 0.6)
  const ml = (x: number) => {
    const k = Math.floor(x)
    if (k < 10) return 0
    if (k < 24) return Math.min(primera, (k - 9) * CAUDAL)
    return Math.min(total, primera + (k - 23) * CAUDAL)
  }
  const finServicio = 24 + Math.ceil((total - primera) / CAUDAL) + 3

  const sesion = (m: number) => ({
    id: 1000 + vuelta, tarjeta: '····A1F3', saldo_centavos: saldo,
    ml_maximos: Math.floor((saldo * 1000) / precio), ml_parcial: m, abierta_en: '', visto_en: null,
  })

  if (s < 6 || s >= finServicio + 9) {
    return { ok: true as const, grifo, sesion: null, ultima: null, cliente: null, ranking }
  }
  if (s < finServicio) {
    return { ok: true as const, grifo, sesion: sesion(ml(s)), ultima: null, cliente, ranking: [] }
  }
  const servido = ml(finServicio)
  const costo = Math.ceil((servido * precio) / 1000)
  return {
    ok: true as const, grifo, sesion: null, cliente: { ...cliente, veces: 4, ml_total: 1500 + servido }, ranking: [],
    ultima: {
      ml_servidos: servido, costo_centavos: costo, saldo_final_centavos: saldo - costo,
      tarjeta: '····A1F3', cerrada_en: `demo-${vuelta}`,
    },
  }
}
