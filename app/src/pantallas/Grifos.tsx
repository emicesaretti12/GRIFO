import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, aCentavos, fecha, fechaCorta } from '../lib/plata'
import { mensajeDeError, type Grifo } from '../lib/tipos'
import { Panel, Chip, Nota, Vacio, HuesoTabla } from '../componentes/UI'
import { Modal, Confirmar } from '../componentes/Modal'
import { useAvisos } from '../componentes/Toast'
import Icono from '../componentes/Icono'

export default function Grifos() {
  const { avisar } = useAvisos()
  const [grifos, setGrifos] = useState<Grifo[]>([])
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState<Grifo | null>(null)
  const [rotando, setRotando] = useState<Grifo | null>(null)
  const [tokenNuevo, setTokenNuevo] = useState<{ grifo: number; token: string } | null>(null)

  const traer = useCallback(async () => {
    const { data, error } = await supabase.from('grifos').select('*').order('id')
    if (error) avisar('No pudimos leer las canillas', { tono: 'grave', detalle: error.message })
    else setGrifos(data as Grifo[])
    setCargando(false)
  }, [avisar])
  useEffect(() => { void traer() }, [traer])

  async function actualizar(id: number, cambios: Record<string, unknown>) {
    const { data, error } = await supabase.rpc('admin_actualizar_grifo', { p_grifo: id, ...cambios })
    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return false }
    const r = data as { ok: boolean; motivo?: string; detalle?: string }
    if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: mensajeDeError(r) }); return false }
    avisar('Canilla actualizada', { tono: 'bien' })
    await traer()
    return true
  }

  async function rotar(id: number) {
    const { data, error } = await supabase.rpc('admin_rotar_token', { p_grifo: id })
    setRotando(null)
    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return }
    const r = data as { ok: boolean; motivo?: string; token?: string }
    if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: mensajeDeError(r) }); return }
    setTokenNuevo({ grifo: id, token: r.token! })
    await traer()
  }

  return (
    <>
      {tokenNuevo && (
        <Modal titulo={`Token nuevo de la canilla ${tokenNuevo.grifo}`}
               bajada="Copialo ahora. Se guarda hasheado y no se puede volver a ver."
               onCerrar={() => setTokenNuevo(null)}
               acciones={
                 <>
                   <button className="btn" onClick={() => {
                     void navigator.clipboard?.writeText(tokenNuevo.token)
                     avisar('Token copiado', { tono: 'bien' })
                   }}>Copiar</button>
                   <button className="btn primario" onClick={() => setTokenNuevo(null)}>Ya lo guardé</button>
                 </>
               }>
          <div className="token-caja">{tokenNuevo.token}</div>
          <Nota tono="ojo">
            Va en el <code>secrets.h</code> del ESP32 de esa canilla. El token
            anterior dejó de servir en este mismo momento.
          </Nota>
        </Modal>
      )}

      {rotando && (
        <Confirmar titulo={`Rotar el token de ${rotando.nombre}`}
                   bajada="El token actual deja de funcionar al instante. Si esa canilla está en la barra, va a dejar de servir hasta que le cargues el nuevo en el ESP32."
                   textoAccion="Generar token nuevo" tono="grave"
                   onSi={() => rotar(rotando.id)} onCerrar={() => setRotando(null)} />
      )}

      {editando && (
        <Editor grifo={editando} onCerrar={() => setEditando(null)}
                onGuardar={async c => { if (await actualizar(editando.id, c)) setEditando(null) }} />
      )}

      <Panel titulo="Canillas"
             bajada="Precio, calibración y estado. Una canilla sin token no puede operar, y por eso no se la puede poner en servicio hasta generarle uno."
             pegado>
        {cargando ? <HuesoTabla columnas={5} /> : grifos.length === 0 ? (
          <Vacio icono="grifo" titulo="No hay canillas cargadas">
            Se dan de alta desde el SQL Editor de Supabase.
          </Vacio>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Canilla</th><th className="num">Precio / litro</th>
                  <th className="num">Pulsos / litro</th><th className="num">Mín.</th>
                  <th>Token</th><th>Estado</th><th />
                </tr>
              </thead>
              <tbody>
                {grifos.map(g => {
                  const conToken = g.token_rotado_en !== null
                  return (
                    <tr key={g.id}>
                      <td style={{ minWidth: 150 }}>
                        <strong>{g.nombre}</strong>
                        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>#{g.id}</div>
                      </td>
                      <td className="num" style={{ fontWeight: 600 }}>{pesos(g.precio_litro_centavos)}</td>
                      <td className="num">{g.pulsos_por_litro}</td>
                      <td className="num">{g.ml_minimos} ml</td>
                      <td title={conToken ? `Rotado ${fecha(g.token_rotado_en)}` : undefined}>
                        {conToken
                          ? <Chip tono="bien">{fechaCorta(g.token_rotado_en)}</Chip>
                          : <Chip tono="grave">Falta</Chip>}
                      </td>
                      <td>{g.activo
                        ? <Chip tono="bien">En servicio</Chip>
                        : <Chip>Fuera de servicio</Chip>}</td>
                      {/* Las acciones envuelven en vez de desbordar: si no entran a lo
                          ancho, pasan al renglón de abajo. Un botón cortado por el borde
                          de la tabla es un botón que el usuario no encuentra. */}
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button className="btn sm" onClick={() => setEditando(g)}
                                  title="Cambiar nombre, precio y calibración">
                            <Icono nombre="lapiz" tam={14} /> Editar
                          </button>
                          <button className="btn sm" onClick={() => actualizar(g.id, { p_activo: !g.activo })}
                                  title={g.activo ? 'Sacarla de servicio' : 'Ponerla en servicio'}>
                            {g.activo ? 'Desactivar' : 'Activar'}
                          </button>
                          <button className="btn sm" onClick={() => setRotando(g)}
                                  title={conToken ? 'Generar un token nuevo e invalidar el actual' : 'Generar el token del dispositivo'}>
                            <Icono nombre="llave" tam={14} /> Token
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

function Editor({ grifo, onCerrar, onGuardar }: {
  grifo: Grifo; onCerrar: () => void; onGuardar: (c: Record<string, unknown>) => void
}) {
  const [nombre, setNombre] = useState(grifo.nombre)
  const [precio, setPrecio] = useState(String(grifo.precio_litro_centavos / 100))
  const [pulsos, setPulsos] = useState(String(grifo.pulsos_por_litro))
  const [minimo, setMinimo] = useState(String(grifo.ml_minimos))

  const precioC = aCentavos(precio)
  const valido = nombre.trim() !== '' && precioC !== null && precioC > 0 && Number(pulsos) > 0

  return (
    <Modal titulo={`Editar ${grifo.nombre}`} onCerrar={onCerrar}
           acciones={
             <>
               <button className="btn" onClick={onCerrar}>Cancelar</button>
               <button className="btn primario" disabled={!valido} onClick={() => onGuardar({
                 p_nombre: nombre.trim(),
                 p_precio_litro: precioC,
                 p_pulsos_por_litro: Number(pulsos.replace(',', '.')),
                 p_ml_minimos: Number(minimo),
               })}>Guardar</button>
             </>
           }>
      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <label htmlFor="n">Nombre de la cerveza</label>
          <input id="n" className="campo" value={nombre} onChange={e => setNombre(e.target.value)} />
        </div>
        <div>
          <label htmlFor="p">Precio por litro (en pesos)</label>
          <input id="p" className="campo" inputMode="decimal" value={precio}
                 onChange={e => setPrecio(e.target.value)} />
          <small style={{ color: 'var(--ink-3)' }}>
            Se guarda como {precioC ?? 0} centavos. Un vaso de 473 ml sale{' '}
            {pesos(Math.ceil((473 * (precioC ?? 0)) / 1000))}.
          </small>
        </div>
        <div>
          <label htmlFor="c">Pulsos por litro</label>
          <input id="c" className="campo" inputMode="decimal" value={pulsos}
                 onChange={e => setPulsos(e.target.value)} />
          <small style={{ color: 'var(--ink-3)' }}>
            Sale de la calibración con agua. Si está mal, se cobra de más o de menos.
          </small>
        </div>
        <div>
          <label htmlFor="m">Mínimo servible (ml)</label>
          <input id="m" className="campo" inputMode="numeric" value={minimo}
                 onChange={e => setMinimo(e.target.value)} />
          <small style={{ color: 'var(--ink-3)' }}>
            Con menos saldo que esto, no se abre sesión.
          </small>
        </div>
      </div>
    </Modal>
  )
}
