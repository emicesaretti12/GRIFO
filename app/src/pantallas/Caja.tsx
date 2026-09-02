import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useLectorRFID } from '../lib/useLectorRFID'
import { normalizarUid, type FormatoLector } from '../lib/uid'
import { pesos, aCentavos, volumen, fecha } from '../lib/plata'
import { mensajeDeError, type RespuestaFicha, type FichaTarjeta } from '../lib/tipos'

const MONTOS_RAPIDOS = [200000, 500000, 1000000, 2000000] // $2000, $5000, $10000, $20000

export default function Caja() {
  const [uid, setUid] = useState('')
  const [ficha, setFicha] = useState<FichaTarjeta | null>(null)
  const [esNueva, setEsNueva] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [monto, setMonto] = useState('')

  // Algunos lectores tipean el UID en decimal y otros en hexa. Se elige una vez
  // por puesto de caja y queda guardado en el navegador de esa máquina.
  const [formato, setFormato] = useState<FormatoLector>(
    () => (localStorage.getItem('grifo.formatoLector') as FormatoLector) ?? 'hex'
  )
  useEffect(() => { localStorage.setItem('grifo.formatoLector', formato) }, [formato])

  const buscar = useCallback(async (crudo: string) => {
    const limpio = normalizarUid(crudo, 'hex') // ya viene normalizado del lector
    if (!limpio) return
    setOcupado(true); setError(null); setExito(null); setFicha(null); setEsNueva(false)

    const { data, error: err } = await supabase.rpc('caja_buscar_tarjeta', { p_uid: limpio })
    setOcupado(false)

    if (err) { setError('No pudimos consultar: ' + err.message); return }
    const r = data as RespuestaFicha
    if (!r.ok) { setError(mensajeDeError(r)); return }

    setUid(r.uid)
    if (r.existe) setFicha(r as FichaTarjeta)
    else setEsNueva(true)
  }, [])

  // El lector RFID USB funciona aunque el foco esté en cualquier lado.
  useLectorRFID({ alLeer: uid => { setUid(uid); void buscar(uid) }, formato })

  function buscarManual(e: FormEvent) {
    e.preventDefault()
    void buscar(uid)
  }

  async function cargar(centavos: number) {
    if (!uid || centavos <= 0) return
    setOcupado(true); setError(null); setExito(null)

    // Clave de idempotencia: si el navegador reintenta o el cajero hace doble
    // clic, el servidor no carga dos veces.
    const clave = `caja:${uid}:${centavos}:${Date.now()}`
    const { data, error: err } = await supabase.rpc('caja_cargar_saldo', {
      p_uid: uid,
      p_centavos: centavos,
      p_referencia: 'caja',
      p_clave_idempotencia: clave,
    })
    setOcupado(false)

    if (err) { setError('No pudimos cargar: ' + err.message); return }
    const r = data as { ok: boolean; motivo?: string; saldo_centavos?: number }
    if (!r.ok) { setError(mensajeDeError(r)); return }

    setExito(`Cargaste ${pesos(centavos)}. Saldo nuevo: ${pesos(r.saldo_centavos!)}`)
    setMonto('')
    void buscar(uid)
  }

  async function cambiarBloqueo(bloquear: boolean) {
    if (!uid) return
    const motivo = bloquear
      ? (prompt('¿Por qué se bloquea? (se pierde, se robó, etc.)') ?? '')
      : null
    if (bloquear && motivo === '') return

    setOcupado(true); setError(null); setExito(null)
    const { data, error: err } = await supabase.rpc('caja_bloquear_tarjeta', {
      p_uid: uid, p_bloquear: bloquear, p_motivo: motivo,
    })
    setOcupado(false)

    if (err) { setError(err.message); return }
    const r = data as { ok: boolean; motivo?: string }
    if (!r.ok) { setError(mensajeDeError(r)); return }

    setExito(bloquear ? 'Tarjeta bloqueada.' : 'Tarjeta desbloqueada.')
    void buscar(uid)
  }

  function limpiar() {
    setUid(''); setFicha(null); setEsNueva(false)
    setError(null); setExito(null); setMonto('')
  }

  const montoCentavos = aCentavos(monto)

  return (
    <>
      <div className="panel">
        <h2>Caja</h2>
        <p className="sub">
          Apoyá la tarjeta en el lector, o escribí el número y dale Buscar.
          El lector funciona aunque el cursor no esté en el campo.
        </p>

        <form onSubmit={buscarManual}>
          <div className="fila">
            <div style={{ flex: 3 }}>
              <label htmlFor="uid">Número de tarjeta</label>
              <input id="uid" className="campo grande" value={uid} autoFocus
                     placeholder="A1B2C3D4"
                     onChange={e => setUid(e.target.value.toUpperCase())} />
            </div>
            <div className="angosto">
              <label htmlFor="formato">Lector</label>
              <select id="formato" className="campo" value={formato}
                      onChange={e => setFormato(e.target.value as FormatoLector)}>
                <option value="hex">Hexadecimal</option>
                <option value="decimal">Decimal</option>
              </select>
            </div>
            <div className="angosto">
              <button className="btn primario" disabled={ocupado || !uid}>Buscar</button>
            </div>
            <div className="angosto">
              <button type="button" className="btn" onClick={limpiar}>Limpiar</button>
            </div>
          </div>
        </form>

        {error && <div className="aviso error">{error}</div>}
        {exito && <div className="aviso exito">{exito}</div>}
      </div>

      {esNueva && (
        <div className="panel">
          <div className="aviso info">
            La tarjeta <span className="uid">{uid}</span> no está registrada.
            Se da de alta sola con la primera carga.
          </div>
          <Cargador monto={monto} setMonto={setMonto} montoCentavos={montoCentavos}
                    ocupado={ocupado} onCargar={cargar} />
        </div>
      )}

      {ficha && (
        <div className="grid2">
          <div className="panel">
            <h2>
              <span className="uid">{ficha.uid}</span>{' '}
              {ficha.bloqueada
                ? <span className="chip alerta">Bloqueada</span>
                : <span className="chip ok">Activa</span>}
            </h2>
            <div className="saldo">{pesos(ficha.saldo_centavos)}</div>

            {ficha.bloqueada && ficha.bloqueada_motivo && (
              <div className="aviso error">Motivo: {ficha.bloqueada_motivo}</div>
            )}

            {ficha.sesion_abierta && (
              <div className="aviso info">
                Está sirviendo ahora en el grifo {ficha.sesion_abierta.grifo_id} —
                hasta {volumen(ficha.sesion_abierta.ml_maximos)}.
                Empezó {fecha(ficha.sesion_abierta.abierta_en)}.
              </div>
            )}

            <Cargador monto={monto} setMonto={setMonto} montoCentavos={montoCentavos}
                      ocupado={ocupado || ficha.bloqueada} onCargar={cargar} />

            <button className={ficha.bloqueada ? 'btn ancho' : 'btn peligro ancho'}
                    style={{ marginTop: 12 }} disabled={ocupado}
                    onClick={() => cambiarBloqueo(!ficha.bloqueada)}>
              {ficha.bloqueada ? 'Desbloquear tarjeta' : 'Bloquear tarjeta'}
            </button>
          </div>

          <div className="panel">
            <h2>Últimos movimientos</h2>
            <p className="sub">Las 15 operaciones más recientes de esta tarjeta.</p>
            {ficha.movimientos.length === 0 ? (
              <p className="vacio">Todavía no hay movimientos.</p>
            ) : (
              <div className="tabla-scroll">
                <table>
                  <thead>
                    <tr><th>Cuándo</th><th>Qué</th><th className="num">Monto</th><th className="num">Saldo</th></tr>
                  </thead>
                  <tbody>
                    {ficha.movimientos.map(m => (
                      <tr key={m.id}>
                        <td>{fecha(m.creado_en)}</td>
                        <td>
                          <span className={m.tipo === 'carga' ? 'chip ok' : 'chip neutro'}>
                            {m.tipo === 'carga' ? 'Carga' : 'Consumo'}
                          </span>
                        </td>
                        <td className="num">{pesos(m.centavos)}</td>
                        <td className="num">{pesos(m.saldo_resultante)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function Cargador({ monto, setMonto, montoCentavos, ocupado, onCargar }: {
  monto: string
  setMonto: (v: string) => void
  montoCentavos: number | null
  ocupado: boolean
  onCargar: (centavos: number) => void
}) {
  return (
    <>
      <div className="montos">
        {MONTOS_RAPIDOS.map(c => (
          <button key={c} className="btn" disabled={ocupado} onClick={() => onCargar(c)}>
            {pesos(c)}
          </button>
        ))}
      </div>
      <div className="fila">
        <div>
          <label htmlFor="monto">Otro monto</label>
          <input id="monto" className="campo" inputMode="decimal" placeholder="1500"
                 value={monto} onChange={e => setMonto(e.target.value)} />
        </div>
        <div className="angosto">
          <button className="btn primario"
                  disabled={ocupado || !montoCentavos || montoCentavos <= 0}
                  onClick={() => montoCentavos && onCargar(montoCentavos)}>
            Cargar
          </button>
        </div>
      </div>
    </>
  )
}
