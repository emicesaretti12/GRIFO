import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, fecha } from '../lib/plata'
import { bajarCSV } from '../lib/csv'
import type { Tarjeta } from '../lib/tipos'
import { Panel, Stat, Chip, Vacio, HuesoTabla } from '../componentes/UI'
import { useAvisos } from '../componentes/Toast'
import Icono from '../componentes/Icono'

type Filtro = 'todas' | 'con-saldo' | 'bloqueadas'

export default function Tarjetas() {
  const { avisar } = useAvisos()
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true
    setCargando(true)
    // Debounce: sin esto le pegamos a la API en cada tecla.
    const t = setTimeout(async () => {
      let q = supabase.from('tarjetas')
        .select('uid, saldo_centavos, bloqueada, bloqueada_motivo, nota, actualizada_en')
        .order('actualizada_en', { ascending: false })
        .limit(500)
      if (busqueda.trim()) q = q.ilike('uid', `%${busqueda.trim().toUpperCase()}%`)
      if (filtro === 'con-saldo') q = q.gt('saldo_centavos', 0)
      if (filtro === 'bloqueadas') q = q.eq('bloqueada', true)

      const { data, error } = await q
      if (!vigente) return
      if (error) avisar('No pudimos buscar', { tono: 'grave', detalle: error.message })
      else setTarjetas(data as Tarjeta[])
      setCargando(false)
    }, 250)
    return () => { vigente = false; clearTimeout(t) }
  }, [busqueda, filtro, avisar])

  const resumen = useMemo(() => ({
    total: tarjetas.reduce((a, t) => a + t.saldo_centavos, 0),
    bloqueadas: tarjetas.filter(t => t.bloqueada).length,
    conSaldo: tarjetas.filter(t => t.saldo_centavos > 0).length,
  }), [tarjetas])

  return (
    <>
      <div className="rejilla c3">
        <div className="panel"><Stat etiqueta="Saldo en circulación" valor={pesos(resumen.total)}
          pie="plata ya cobrada que el bar todavía debe en cerveza" /></div>
        <div className="panel"><Stat etiqueta="Tarjetas con saldo" valor={String(resumen.conSaldo)} /></div>
        <div className="panel"><Stat etiqueta="Bloqueadas" valor={String(resumen.bloqueadas)} /></div>
      </div>

      <Panel accion={
        <button className="btn sm" disabled={tarjetas.length === 0}
                onClick={() => bajarCSV('tarjetas', [
                  ['Tarjeta', 'Saldo', 'Bloqueada', 'Motivo', 'Ultimo movimiento'],
                  ...tarjetas.map(t => [
                    t.uid, (t.saldo_centavos / 100).toFixed(2),
                    t.bloqueada ? 'si' : 'no', t.bloqueada_motivo ?? '', t.actualizada_en,
                  ]),
                ])}>
          <Icono nombre="descargar" tam={15} /> Exportar CSV
        </button>
      }>
        <div className="fila">
          <div className="crece buscador">
            <Icono nombre="buscar" tam={16} />
            <input className="campo" placeholder="Buscar por número de tarjeta…"
                   value={busqueda} onChange={e => setBusqueda(e.target.value)} />
          </div>
          <div className="grupo-btn">
            {([['todas', 'Todas'], ['con-saldo', 'Con saldo'], ['bloqueadas', 'Bloqueadas']] as const)
              .map(([id, texto]) => (
                <button key={id} aria-pressed={filtro === id} onClick={() => setFiltro(id)}>{texto}</button>
              ))}
          </div>
        </div>
      </Panel>

      <Panel pegado>
        {cargando ? <HuesoTabla /> : tarjetas.length === 0 ? (
          <Vacio icono="tarjeta" titulo="Ninguna tarjeta coincide">
            {busqueda ? 'Probá con otro número.' : 'Todavía no se cargó ninguna tarjeta.'}
          </Vacio>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Tarjeta</th><th className="num">Saldo</th>
                  <th>Estado</th><th>Nota</th><th>Último movimiento</th>
                </tr>
              </thead>
              <tbody>
                {tarjetas.map(t => (
                  <tr key={t.uid}>
                    <td><span className="uid">{t.uid}</span></td>
                    <td className="num" style={{ fontWeight: 650 }}>{pesos(t.saldo_centavos)}</td>
                    <td>{t.bloqueada
                      ? <Chip tono="grave">{t.bloqueada_motivo || 'Bloqueada'}</Chip>
                      : <Chip tono="bien">Activa</Chip>}</td>
                    <td style={{ color: 'var(--ink-2)' }}>{t.nota ?? '—'}</td>
                    <td style={{ color: 'var(--ink-2)' }}>{fecha(t.actualizada_en)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}
