import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, aCentavos, volumen, fecha } from '../lib/plata'
import { mensajeDeError } from '../lib/tipos'
import { Panel, Stat, Nota, Vacio, Hueso } from '../componentes/UI'
import { Modal } from '../componentes/Modal'
import { useAvisos } from '../componentes/Toast'
import Icono from '../componentes/Icono'

/** Debajo de esto conviene ir a buscar el próximo barril, no cuando se corta. */
export const UMBRAL_BAJO = 15

export type Barril = {
  grifo_id: number; grifo: string; color: string; activo: boolean
  barril_id: number; litros: number; ml_servidos: number; ml_restantes: number
  restante_pct: number; instalado_en: string; vasos: number
}

export default function Barriles() {
  const { avisar } = useAvisos()
  const [barriles, setBarriles] = useState<Barril[]>([])
  const [grifos, setGrifos] = useState<{ id: number; nombre: string }[]>([])
  const [cargando, setCargando] = useState(true)
  const [cambiando, setCambiando] = useState<{ id: number; nombre: string } | null>(null)

  const traer = useCallback(async () => {
    const [b, g] = await Promise.all([
      supabase.rpc('estado_barriles'),
      supabase.from('grifos').select('id, nombre').order('id'),
    ])
    if (b.error) avisar('No pudimos leer los barriles', { tono: 'grave', detalle: b.error.message })
    else setBarriles((b.data ?? []) as Barril[])
    if (!g.error) setGrifos(g.data as { id: number; nombre: string }[])
    setCargando(false)
  }, [avisar])
  useEffect(() => { void traer() }, [traer])

  const bajos = barriles.filter(b => b.restante_pct <= UMBRAL_BAJO)
  const conBarril = new Set(barriles.map(b => b.grifo_id))
  const sinBarril = grifos.filter(g => !conBarril.has(g.id))

  return (
    <>
      {cambiando && (
        <CambiarBarril grifo={cambiando} onCerrar={() => setCambiando(null)}
                       onListo={async () => { setCambiando(null); await traer() }} avisar={avisar} />
      )}

      {bajos.length > 0 && (
        <Nota tono="grave">
          <strong>{bajos.length === 1 ? 'Un barril está por acabarse' : `${bajos.length} barriles están por acabarse`}:</strong>{' '}
          {bajos.map(b => `${b.grifo} (${b.restante_pct}%, ~${b.vasos} vasos)`).join(' · ')}.
          Conviene tener el próximo a mano antes de que se corte.
        </Nota>
      )}

      {cargando ? (
        <div className="rejilla c2">
          {[0, 1].map(i => <div className="panel" key={i}><Hueso alto={80} /></div>)}
        </div>
      ) : barriles.length === 0 && sinBarril.length === 0 ? (
        <Panel><Vacio icono="grifo" titulo="No hay canillas cargadas" /></Panel>
      ) : (
        <div className="rejilla c2">
          {barriles.map(b => (
            <div className="panel" key={b.barril_id}>
              <div className="barril">
                <div className="barril-cab">
                  <span className="pico" style={{ background: b.color }} />
                  <span className="nom">{b.grifo}</span>
                  <span className="pct" style={{ color: b.restante_pct <= UMBRAL_BAJO ? 'var(--grave)' : undefined }}>
                    {b.restante_pct}%
                  </span>
                </div>

                <div className="barril-tubo">
                  <i style={{ width: `${Math.max(0, Math.min(100, b.restante_pct))}%`, background: b.color }} />
                </div>

                <div className="barril-pie">
                  <span><strong>{volumen(b.ml_restantes)}</strong> de {b.litros} L</span>
                  <span><strong>~{b.vasos}</strong> vasos</span>
                </div>

                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  Puesto el {fecha(b.instalado_en)} · lleva servidos {volumen(b.ml_servidos)}
                </div>

                <button className="btn sm" style={{ alignSelf: 'flex-start' }}
                        onClick={() => setCambiando({ id: b.grifo_id, nombre: b.grifo })}>
                  <Icono nombre="refrescar" tam={14} /> Cambiar barril
                </button>
              </div>
            </div>
          ))}

          {sinBarril.map(g => (
            <div className="panel" key={`sin-${g.id}`}>
              <div className="barril">
                <div className="barril-cab">
                  <span className="pico" style={{ background: 'var(--linea-fuerte)' }} />
                  <span className="nom">{g.nombre}</span>
                </div>
                <p className="bajada" style={{ margin: 0 }}>
                  Sin barril cargado. Lo que se sirva no se va a descontar de ningún stock.
                </p>
                <button className="btn sm primario" style={{ alignSelf: 'flex-start' }}
                        onClick={() => setCambiando({ id: g.id, nombre: g.nombre })}>
                  <Icono nombre="mas" tam={14} /> Poner barril
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {barriles.length > 0 && (
        <div className="rejilla c3">
          <div className="panel">
            <Stat etiqueta="Cerveza en barriles"
                  valor={volumen(barriles.reduce((a, b) => a + b.ml_restantes, 0))}
                  pie="lo que queda por servir" />
          </div>
          <div className="panel">
            <Stat etiqueta="Vasos disponibles"
                  valor={String(barriles.reduce((a, b) => a + b.vasos, 0))} />
          </div>
          <div className="panel">
            <Stat etiqueta="Barriles por reponer" valor={String(bajos.length)}
                  pie={`por debajo del ${UMBRAL_BAJO}%`} />
          </div>
        </div>
      )}

      <Nota tono="info">
        El descuento sale de los mismos mililitros que se cobran, así que el stock
        y la facturación no pueden desincronizarse. Si el barril se termina antes
        de llegar a cero en la pantalla, la calibración de esa canilla está midiendo
        de menos — y también estás cobrando de menos.
      </Nota>
    </>
  )
}

function CambiarBarril({ grifo, onCerrar, onListo, avisar }: {
  grifo: { id: number; nombre: string }
  onCerrar: () => void
  onListo: () => void
  avisar: (t: string, o?: { tono?: 'bien' | 'grave' | 'neutro'; detalle?: string }) => void
}) {
  const [litros, setLitros] = useState('50')
  const [costo, setCosto] = useState('')
  const [nota, setNota] = useState('')
  const [enviando, setEnviando] = useState(false)

  const l = Number(litros.replace(',', '.'))
  const costoC = costo ? aCentavos(costo) : null
  const valido = l > 0

  async function guardar() {
    setEnviando(true)
    const { data, error } = await supabase.rpc('admin_cambiar_barril', {
      p_grifo: grifo.id, p_litros: l,
      p_costo_centavos: costoC, p_nota: nota.trim() || null,
    })
    setEnviando(false)
    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return }
    const r = data as { ok: boolean; motivo?: string; anterior?: { aprovechado_pct: number } | null }
    if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: mensajeDeError(r) }); return }

    avisar('Barril nuevo puesto', {
      tono: 'bien',
      detalle: r.anterior
        ? `Del anterior se aprovechó el ${r.anterior.aprovechado_pct}%`
        : undefined,
    })
    onListo()
  }

  return (
    <Modal titulo={`Barril nuevo en ${grifo.nombre}`}
           bajada="Cierra el barril que estaba puesto y arranca el conteo de cero."
           onCerrar={onCerrar}
           acciones={
             <>
               <button className="btn" onClick={onCerrar}>Cancelar</button>
               <button className="btn primario" disabled={!valido || enviando} onClick={guardar}>
                 {enviando ? 'Guardando…' : 'Poner barril'}
               </button>
             </>
           }>
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label htmlFor="l">Litros</label>
          <input id="l" className="campo" inputMode="decimal" value={litros} autoFocus
                 onChange={e => setLitros(e.target.value)} />
          <small style={{ color: 'var(--ink-3)' }}>
            Los barriles comunes son de 20, 30 o 50 litros.
          </small>
        </div>
        <div>
          <label htmlFor="c">Qué costó el barril (opcional)</label>
          <input id="c" className="campo" inputMode="decimal" value={costo}
                 placeholder="75000" onChange={e => setCosto(e.target.value)} />
          {costoC != null && l > 0 && (
            <small style={{ color: 'var(--ink-3)' }}>
              Sale {pesos(Math.round(costoC / l))} el litro. Si no coincide con el
              costo cargado en la canilla, conviene actualizarlo.
            </small>
          )}
        </div>
        <div>
          <label htmlFor="n">Nota (opcional)</label>
          <input id="n" className="campo" value={nota} placeholder="Lote, proveedor…"
                 onChange={e => setNota(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}
