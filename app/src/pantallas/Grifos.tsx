import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, aCentavos, fecha } from '../lib/plata'
import { mensajeDeError, type Grifo } from '../lib/tipos'

export default function Grifos() {
  const [grifos, setGrifos] = useState<Grifo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [tokenNuevo, setTokenNuevo] = useState<{ grifo: number; token: string } | null>(null)
  const [editando, setEditando] = useState<number | null>(null)

  async function cargar() {
    const { data, error: err } = await supabase
      .from('grifos').select('*').order('id')
    if (err) setError(err.message)
    else setGrifos(data as Grifo[])
  }
  useEffect(() => { void cargar() }, [])

  async function actualizar(id: number, cambios: Record<string, unknown>) {
    setError(null); setExito(null)
    const { data, error: err } = await supabase.rpc('admin_actualizar_grifo', {
      p_grifo: id, ...cambios,
    })
    if (err) { setError(err.message); return false }
    const r = data as { ok: boolean; motivo?: string; detalle?: string }
    if (!r.ok) { setError(mensajeDeError(r)); return false }
    setExito('Grifo actualizado.')
    await cargar()
    return true
  }

  async function rotarToken(id: number) {
    if (!confirm(
      `¿Generar un token nuevo para el grifo ${id}?\n\n` +
      'El token actual deja de funcionar AL INSTANTE. Si ese grifo está en la ' +
      'barra, va a dejar de servir hasta que le cargues el nuevo en el ESP32.'
    )) return

    setError(null); setExito(null); setTokenNuevo(null)
    const { data, error: err } = await supabase.rpc('admin_rotar_token', { p_grifo: id })
    if (err) { setError(err.message); return }
    const r = data as { ok: boolean; motivo?: string; token?: string }
    if (!r.ok) { setError(mensajeDeError(r)); return }
    setTokenNuevo({ grifo: id, token: r.token! })
    await cargar()
  }

  return (
    <>
      <div className="panel">
        <h2>Grifos</h2>
        <p className="sub">
          Precio, calibración y estado de cada canilla. Un grifo sin token no puede
          operar, y por eso no se lo puede activar hasta generarle uno.
        </p>
        {error && <div className="aviso error">{error}</div>}
        {exito && <div className="aviso exito">{exito}</div>}

        {tokenNuevo && (
          <div className="aviso info">
            <strong>Token nuevo del grifo {tokenNuevo.grifo}.</strong> Copialo ahora:
            se guarda hasheado y no se puede volver a ver.
            <div className="token">{tokenNuevo.token}</div>
            Va en el <code>secrets.h</code> del ESP32 de esa canilla.
            <button className="btn chico" style={{ marginTop: 8 }}
                    onClick={() => setTokenNuevo(null)}>Ya lo copié</button>
          </div>
        )}

        <div className="tabla-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th><th>Nombre</th><th className="num">Precio / litro</th>
                <th className="num">Pulsos / litro</th><th className="num">Mín. ml</th>
                <th>Token</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {grifos.map(g => (
                <Fila key={g.id} grifo={g}
                      editando={editando === g.id}
                      onEditar={() => setEditando(g.id)}
                      onCancelar={() => setEditando(null)}
                      onGuardar={async cambios => {
                        if (await actualizar(g.id, cambios)) setEditando(null)
                      }}
                      onActivo={activo => actualizar(g.id, { p_activo: activo })}
                      onRotar={() => rotarToken(g.id)} />
              ))}
            </tbody>
          </table>
        </div>
        {grifos.length === 0 && <p className="vacio">No hay grifos cargados.</p>}
      </div>
    </>
  )
}

function Fila({ grifo: g, editando, onEditar, onCancelar, onGuardar, onActivo, onRotar }: {
  grifo: Grifo
  editando: boolean
  onEditar: () => void
  onCancelar: () => void
  onGuardar: (cambios: Record<string, unknown>) => void
  onActivo: (activo: boolean) => void
  onRotar: () => void
}) {
  const [nombre, setNombre] = useState(g.nombre)
  const [precio, setPrecio] = useState(String(g.precio_litro_centavos / 100))
  const [pulsos, setPulsos] = useState(String(g.pulsos_por_litro))
  const [minimo, setMinimo] = useState(String(g.ml_minimos))

  const tieneToken = g.token_rotado_en !== null

  if (editando) {
    return (
      <tr>
        <td>{g.id}</td>
        <td><input className="campo" value={nombre} onChange={e => setNombre(e.target.value)} /></td>
        <td><input className="campo" value={precio} onChange={e => setPrecio(e.target.value)} /></td>
        <td><input className="campo" value={pulsos} onChange={e => setPulsos(e.target.value)} /></td>
        <td><input className="campo" value={minimo} onChange={e => setMinimo(e.target.value)} /></td>
        <td colSpan={2} />
        <td style={{ whiteSpace: 'nowrap' }}>
          <button className="btn chico primario" onClick={() => onGuardar({
            p_nombre: nombre,
            p_precio_litro: aCentavos(precio),
            p_pulsos_por_litro: Number(pulsos.replace(',', '.')),
            p_ml_minimos: Number(minimo),
          })}>Guardar</button>{' '}
          <button className="btn chico" onClick={onCancelar}>Cancelar</button>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td>{g.id}</td>
      <td><strong>{g.nombre}</strong></td>
      <td className="num">{pesos(g.precio_litro_centavos)}</td>
      <td className="num">{g.pulsos_por_litro}</td>
      <td className="num">{g.ml_minimos}</td>
      <td>
        {tieneToken
          ? <span className="chip ok" title={`Rotado ${fecha(g.token_rotado_en)}`}>Sí</span>
          : <span className="chip alerta">Falta</span>}
      </td>
      <td>
        {g.activo
          ? <span className="chip ok">En servicio</span>
          : <span className="chip neutro">Fuera de servicio</span>}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <button className="btn chico" onClick={onEditar}>Editar</button>{' '}
        <button className="btn chico" onClick={() => onActivo(!g.activo)}>
          {g.activo ? 'Dar de baja' : 'Poner en servicio'}
        </button>{' '}
        <button className="btn chico" onClick={onRotar}>
          {tieneToken ? 'Rotar token' : 'Generar token'}
        </button>
      </td>
    </tr>
  )
}
