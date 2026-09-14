import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, volumen } from '../lib/plata'
import { useIntervalo } from '../lib/useIntervalo'
import {
  COLUMNAS_GRIFO, saludDeCanilla, haceCuanto,
  type Grifo, type SesionEnVivo,
} from '../lib/tipos'
import { Panel, Chip } from '../componentes/UI'
import Icono from '../componentes/Icono'

// ── Por qué dos segundos y no veinte ────────────────────────────────────────
// El resto del tablero muestra el día: veinte segundos de atraso no cambian
// nada. Este panel muestra lo que está pasando **mientras lo mirás**, y una
// cerveza entera sale en menos de veinte segundos.
//
// El ESP32 reporta su avance cada segundo mientras sirve, así que pedir más
// seguido que eso no agregaría información.
//
//   Es elegir el refresco por la velocidad de lo que muestra, no por una
//   constante global.
const REFRESCO_MS = 2000

/** Lo que está pasando ahora mismo en cada canilla. */
export default function AhoraMismo() {
  const [grifos, setGrifos] = useState<Grifo[]>([])
  const [enVivo, setEnVivo] = useState<SesionEnVivo[]>([])
  const [listo, setListo] = useState(false)

  const traer = useCallback(async () => {
    const [g, s] = await Promise.all([
      supabase.from('grifos').select(COLUMNAS_GRIFO).order('id'),
      supabase.from('sesiones')
        .select('id, uid, grifo_id, ml_parcial, ml_maximos, precio_litro_centavos, saldo_inicial_centavos, abierta_en, visto_en')
        .eq('estado', 'abierta'),
    ])
    if (!g.error) setGrifos(g.data as Grifo[])
    if (!s.error) setEnVivo((s.data ?? []) as SesionEnVivo[])
    setListo(true)
  }, [])

  useEffect(() => { void traer() }, [traer])
  useIntervalo(traer, REFRESCO_MS)

  if (!listo || grifos.length === 0) return null

  const sirviendo = enVivo.length

  return (
    <Panel titulo="Ahora mismo"
           bajada={sirviendo === 0
             ? 'Ninguna canilla está sirviendo.'
             : sirviendo === 1 ? 'Una canilla sirviendo.' : `${sirviendo} canillas sirviendo.`}>
      <div className="rejilla-vivo">
        {grifos.map(g => (
          <Canilla key={g.id} grifo={g}
                   sesion={enVivo.find(s => s.grifo_id === g.id) ?? null} />
        ))}
      </div>
    </Panel>
  )
}

function Canilla({ grifo, sesion }: { grifo: Grifo; sesion: SesionEnVivo | null }) {
  const salud = saludDeCanilla(grifo.ultimo_latido)
  const sirviendo = sesion !== null
  const color = grifo.color ?? '#c8811f'

  // El monto se calcula acá con la misma regla que cobra el servidor —techo,
  // nunca truncar— para que lo que se ve subiendo sea lo que se va a cobrar y
  // no una aproximación que después no cierra por un peso.
  const ml = sesion?.ml_parcial ?? 0
  const va = sesion ? Math.ceil((ml * sesion.precio_litro_centavos) / 1000) : 0
  const pct = sesion && sesion.ml_maximos > 0
    ? Math.min(100, Math.round((ml / sesion.ml_maximos) * 100)) : 0

  return (
    <div className={`tarjeta-vivo${sirviendo ? ' sirviendo' : ''}`}
         style={{ '--tinte': color } as React.CSSProperties}>

      <div className="vivo-cabeza">
        {grifo.imagen_url
          ? <img src={grifo.imagen_url} alt="" width={32} height={32}
                 style={{ borderRadius: 8, objectFit: 'cover', flex: 'none' }} />
          : <span className="vivo-gota" aria-hidden>🍺</span>}
        <div className="crece" style={{ minWidth: 0 }}>
          <strong className="vivo-nombre">{grifo.nombre}</strong>
          <div className="vivo-sub">#{grifo.id}{grifo.estilo ? ` · ${grifo.estilo}` : ''}</div>
        </div>
      </div>

      {sirviendo ? (
        <>
          <div className="vivo-monto">
            <span className="vivo-ml">{volumen(ml)}</span>
            <span className="vivo-pesos">{pesos(va)}</span>
          </div>
          <div className="vivo-barra"><i style={{ width: `${pct}%` }} /></div>
          <div className="vivo-pie">
            <Icono nombre="reloj" tam={12} /> sirviendo · hasta {volumen(sesion.ml_maximos)}
          </div>
        </>
      ) : (
        <div className="vivo-estado">
          {!grifo.activo
            ? <Chip>Fuera de servicio</Chip>
            : grifo.token_rotado_en === null
              ? <Chip tono="grave">Sin token</Chip>
              : salud === 'en-linea'
                ? <Chip tono="bien">Libre</Chip>
                : salud === 'nunca'
                  ? <Chip tono="grave">Nunca reportó</Chip>
                  : <Chip tono="grave">Sin señal · {haceCuanto(grifo.ultimo_latido)}</Chip>}
          {(grifo.cierres_pendientes ?? 0) > 0 && (
            <Chip tono="ojo">{grifo.cierres_pendientes} sin cobrar</Chip>
          )}
        </div>
      )}
    </div>
  )
}
