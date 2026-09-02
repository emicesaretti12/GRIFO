import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, fecha } from '../lib/plata'
import type { Tarjeta } from '../lib/tipos'

export default function Tarjetas() {
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vigente = true
    setCargando(true)
    const t = setTimeout(async () => {
      let q = supabase.from('tarjetas')
        .select('uid, saldo_centavos, bloqueada, bloqueada_motivo, nota, actualizada_en')
        .order('actualizada_en', { ascending: false })
        .limit(200)
      if (busqueda.trim()) q = q.ilike('uid', `%${busqueda.trim().toUpperCase()}%`)

      const { data, error: err } = await q
      if (!vigente) return
      if (err) setError(err.message)
      else { setTarjetas(data as Tarjeta[]); setError(null) }
      setCargando(false)
    }, 250) // debounce, para no pegarle a la API en cada tecla
    return () => { vigente = false; clearTimeout(t) }
  }, [busqueda])

  const total = tarjetas.reduce((a, t) => a + t.saldo_centavos, 0)

  return (
    <div className="panel">
      <h2>Tarjetas</h2>
      <p className="sub">Las 200 más recientes. Buscá por número para filtrar.</p>

      <input className="campo" placeholder="Buscar por número de tarjeta…"
             value={busqueda} onChange={e => setBusqueda(e.target.value)} />

      {error && <div className="aviso error">{error}</div>}

      <p className="sub" style={{ marginTop: 16 }}>
        {tarjetas.length} tarjetas · saldo total en circulación: <strong>{pesos(total)}</strong>
      </p>

      {cargando ? <p className="vacio">Buscando…</p> : tarjetas.length === 0 ? (
        <p className="vacio">No hay tarjetas que coincidan.</p>
      ) : (
        <div className="tabla-scroll">
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
                  <td className="num"><strong>{pesos(t.saldo_centavos)}</strong></td>
                  <td>
                    {t.bloqueada
                      ? <span className="chip alerta" title={t.bloqueada_motivo ?? ''}>Bloqueada</span>
                      : <span className="chip ok">Activa</span>}
                  </td>
                  <td>{t.nota ?? '—'}</td>
                  <td>{fecha(t.actualizada_en)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
