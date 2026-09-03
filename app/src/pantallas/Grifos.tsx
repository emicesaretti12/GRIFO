import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, aCentavos, fecha, fechaCorta } from '../lib/plata'
import { subirImagenCerveza } from '../lib/imagenes'
import { mensajeDeError, type Grifo } from '../lib/tipos'
import { Panel, Chip, Nota, Vacio, HuesoTabla } from '../componentes/UI'
import { Modal, Confirmar } from '../componentes/Modal'
import { useAvisos } from '../componentes/Toast'
import Icono from '../componentes/Icono'
import QR from '../componentes/QR'

export default function Grifos() {
  const { avisar } = useAvisos()
  const [grifos, setGrifos] = useState<Grifo[]>([])
  const [cargando, setCargando] = useState(true)
  const [editando, setEditando] = useState<Grifo | null>(null)
  const [rotando, setRotando] = useState<Grifo | null>(null)
  const [tokenNuevo, setTokenNuevo] = useState<{ grifo: Grifo; token: string } | null>(null)

  const traer = useCallback(async () => {
    const { data, error } = await supabase.from('grifos').select('*').order('id')
    if (error) avisar('No pudimos leer las canillas', { tono: 'grave', detalle: error.message })
    else setGrifos(data as Grifo[])
    setCargando(false)
  }, [avisar])
  useEffect(() => { void traer() }, [traer])

  async function rpc(nombre: string, args: Record<string, unknown>, exito: string) {
    const { data, error } = await supabase.rpc(nombre, args)
    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return false }
    const r = data as { ok: boolean; motivo?: string; detalle?: string }
    if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: mensajeDeError(r) }); return false }
    avisar(exito, { tono: 'bien' })
    await traer()
    return true
  }

  async function rotar(g: Grifo) {
    const { data, error } = await supabase.rpc('admin_rotar_token', { p_grifo: g.id })
    setRotando(null)
    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return }
    const r = data as { ok: boolean; motivo?: string; token?: string }
    if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: mensajeDeError(r) }); return }
    setTokenNuevo({ grifo: g, token: r.token! })
    await traer()
  }

  return (
    <>
      {tokenNuevo && (
        <TokenNuevo grifo={tokenNuevo.grifo} token={tokenNuevo.token}
                    onCerrar={() => setTokenNuevo(null)} onCopiado={() => avisar('Copiado', { tono: 'bien' })} />
      )}

      {rotando && (
        <Confirmar titulo={`Rotar el token de ${rotando.nombre}`}
                   bajada="El token actual deja de funcionar al instante, y con él se desconectan a la vez el ESP32 y la pantalla de esa canilla. Vas a tener que volver a vincular los dos."
                   textoAccion="Generar token nuevo" tono="grave"
                   onSi={() => rotar(rotando)} onCerrar={() => setRotando(null)} />
      )}

      {editando && (
        <Editor grifo={editando} onCerrar={() => setEditando(null)}
                onGuardado={async () => { setEditando(null); await traer() }}
                avisar={avisar} />
      )}

      <Panel titulo="Canillas"
             bajada="Cada canilla es una cerveza distinta: su precio, su costo, su calibración y su pantalla."
             pegado>
        {cargando ? <HuesoTabla columnas={6} /> : grifos.length === 0 ? (
          <Vacio icono="grifo" titulo="No hay canillas cargadas">
            Se dan de alta desde el SQL Editor de Supabase.
          </Vacio>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Cerveza</th>
                  <th className="num">Precio / L</th>
                  <th className="num">Costo / L</th>
                  <th className="num">Margen</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {grifos.map(g => {
                  const margen = g.precio_litro_centavos - g.costo_litro_centavos
                  const pct = g.precio_litro_centavos > 0
                    ? Math.round((margen / g.precio_litro_centavos) * 100) : 0
                  const conToken = g.token_rotado_en !== null
                  return (
                    <tr key={g.id}>
                      <td style={{ minWidth: 210 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {g.imagen_url
                            ? <img src={g.imagen_url} alt="" width={38} height={38}
                                   style={{ borderRadius: 8, objectFit: 'cover', flex: 'none' }} />
                            : <span style={{
                                width: 38, height: 38, borderRadius: 8, flex: 'none',
                                display: 'grid', placeItems: 'center', fontSize: 18,
                                background: g.color ?? 'var(--superficie-2)',
                              }}>🍺</span>}
                          <div>
                            <strong>{g.nombre}</strong>
                            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                              #{g.id}{g.estilo ? ` · ${g.estilo}` : ''}
                              {g.abv != null ? ` · ${g.abv}%` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="num" style={{ fontWeight: 650 }}>{pesos(g.precio_litro_centavos)}</td>
                      <td className="num" style={{ color: 'var(--ink-2)' }}>
                        {g.costo_litro_centavos > 0 ? pesos(g.costo_litro_centavos)
                          : <span title="Sin costo cargado no podemos calcular la ganancia">— </span>}
                      </td>
                      <td className="num">
                        {g.costo_litro_centavos > 0
                          ? <><strong>{pesos(margen)}</strong>
                              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{pct}%</div></>
                          : <Chip tono="ojo">falta costo</Chip>}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {g.activo ? <Chip tono="bien">En servicio</Chip> : <Chip>Fuera de servicio</Chip>}
                          {conToken
                            ? <Chip tono="bien">{fechaCorta(g.token_rotado_en)}</Chip>
                            : <Chip tono="grave">sin token</Chip>}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button className="btn sm" onClick={() => setEditando(g)}>
                            <Icono nombre="lapiz" tam={14} /> Editar
                          </button>
                          <button className="btn sm"
                                  onClick={() => rpc('admin_actualizar_grifo',
                                    { p_grifo: g.id, p_activo: !g.activo },
                                    g.activo ? 'Canilla fuera de servicio' : 'Canilla en servicio')}>
                            {g.activo ? 'Desactivar' : 'Activar'}
                          </button>
                          <button className="btn sm" onClick={() => setRotando(g)}
                                  title={conToken ? `Rotado ${fecha(g.token_rotado_en)}` : 'Todavía no tiene token'}>
                            <Icono nombre="llave" tam={14} /> {conToken ? 'Rotar' : 'Generar'} token
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

      <Nota tono="info">
        <strong>La pantalla de cada canilla</strong> se vincula con el mismo token que
        el ESP32, y el link para hacerlo aparece al generar o rotar el token. Rotar
        desconecta a los dos a la vez, que es justo lo que querés si te robaron una
        tablet.
      </Nota>
    </>
  )
}

/* ── Token recién generado + vinculación de la pantalla ───────────────────── */
function TokenNuevo({ grifo, token, onCerrar, onCopiado }: {
  grifo: Grifo; token: string; onCerrar: () => void; onCopiado: () => void
}) {
  const link = `${location.origin}${location.pathname}#/pantalla?grifo=${grifo.id}&token=${token}`
  return (
    <Modal titulo={`Token nuevo · ${grifo.nombre}`}
           bajada="Se guarda hasheado y no se puede volver a ver. Copiá lo que necesites antes de cerrar."
           onCerrar={onCerrar}
           acciones={<button className="btn primario" onClick={onCerrar}>Ya lo guardé</button>}>

      <span className="etiqueta-campo">1 · Para el ESP32 de la canilla</span>
      <div className="token-caja">{token}</div>
      <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(token); onCopiado() }}>
        Copiar token
      </button>
      <p className="bajada" style={{ marginTop: 6 }}>Va en el <code>secrets.h</code> del firmware.</p>

      <hr style={{ border: 0, borderTop: '1px solid var(--linea)', margin: '18px 0' }} />

      <span className="etiqueta-campo">2 · Para la pantalla de la canilla</span>
      <p className="bajada" style={{ marginTop: 0 }}>
        Escaneá este QR con la tablet que va al lado del grifo. Se configura sola y
        el token no queda a la vista.
      </p>
      <QR texto={link} />
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(link); onCopiado() }}>
          Copiar link
        </button>
        <a className="btn sm" href={link} target="_blank" rel="noreferrer">Abrir en otra pestaña</a>
      </div>
    </Modal>
  )
}

/* ── Editor de la canilla ─────────────────────────────────────────────────── */
function Editor({ grifo, onCerrar, onGuardado, avisar }: {
  grifo: Grifo
  onCerrar: () => void
  onGuardado: () => void
  avisar: (t: string, o?: { tono?: 'bien' | 'grave' | 'neutro'; detalle?: string }) => void
}) {
  const [tab, setTab] = useState<'venta' | 'cerveza'>('venta')
  const [nombre, setNombre] = useState(grifo.nombre)
  const [precio, setPrecio] = useState(String(grifo.precio_litro_centavos / 100))
  const [costo, setCosto] = useState(String(grifo.costo_litro_centavos / 100))
  const [pulsos, setPulsos] = useState(String(grifo.pulsos_por_litro))
  const [minimo, setMinimo] = useState(String(grifo.ml_minimos))
  const [estilo, setEstilo] = useState(grifo.estilo ?? '')
  const [desc, setDesc] = useState(grifo.descripcion ?? '')
  const [abv, setAbv] = useState(grifo.abv != null ? String(grifo.abv) : '')
  const [ibu, setIbu] = useState(grifo.ibu != null ? String(grifo.ibu) : '')
  const [color, setColor] = useState(grifo.color ?? '#c8811f')
  const [imagen, setImagen] = useState(grifo.imagen_url ?? '')
  const [subiendo, setSubiendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const archivo = useRef<HTMLInputElement>(null)

  const precioC = aCentavos(precio) ?? 0
  const costoC = aCentavos(costo) ?? 0
  const margen = precioC - costoC
  const pct = precioC > 0 ? Math.round((margen / precioC) * 100) : 0
  const valido = nombre.trim() !== '' && precioC > 0 && Number(pulsos) > 0

  async function subir(f: File) {
    setSubiendo(true)
    try {
      setImagen(await subirImagenCerveza(grifo.id, f))
      avisar('Imagen lista', { tono: 'bien', detalle: 'Se guarda al confirmar los cambios.' })
    } catch (e) {
      avisar('No pudimos subir la imagen', { tono: 'grave', detalle: (e as Error).message })
    }
    setSubiendo(false)
  }

  async function guardar() {
    setGuardando(true)
    const a = await supabase.rpc('admin_actualizar_grifo', {
      p_grifo: grifo.id, p_nombre: nombre.trim(), p_precio_litro: precioC,
      p_pulsos_por_litro: Number(pulsos.replace(',', '.')), p_ml_minimos: Number(minimo),
    })
    const b = await supabase.rpc('admin_actualizar_cerveza', {
      p_grifo: grifo.id, p_costo_litro: costoC,
      p_estilo: estilo.trim() || null, p_descripcion: desc.trim() || null,
      p_abv: abv ? Number(abv.replace(',', '.')) : null,
      p_ibu: ibu ? Number(ibu) : null,
      p_color: color, p_imagen_url: imagen || null,
    })
    setGuardando(false)

    const malo = [a, b].find(r => r.error || !(r.data as { ok: boolean })?.ok)
    if (malo) {
      avisar('No se pudo guardar', {
        tono: 'grave',
        detalle: malo.error?.message ?? mensajeDeError(malo.data as { motivo?: string }),
      })
      return
    }
    avisar('Canilla actualizada', { tono: 'bien' })
    onGuardado()
  }

  return (
    <Modal titulo={grifo.nombre} onCerrar={onCerrar}
           acciones={
             <>
               <button className="btn" onClick={onCerrar}>Cancelar</button>
               <button className="btn primario" disabled={!valido || guardando} onClick={guardar}>
                 {guardando ? 'Guardando…' : 'Guardar'}
               </button>
             </>
           }>
      <div className="grupo-btn" style={{ marginBottom: 16 }}>
        <button aria-pressed={tab === 'venta'} onClick={() => setTab('venta')}>Venta y medición</button>
        <button aria-pressed={tab === 'cerveza'} onClick={() => setTab('cerveza')}>Cerveza y pantalla</button>
      </div>

      {tab === 'venta' ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <label htmlFor="n">Nombre</label>
            <input id="n" className="campo" value={nombre} onChange={e => setNombre(e.target.value)} />
          </div>

          <div className="rejilla c2" style={{ gap: 12 }}>
            <div>
              <label htmlFor="p">Precio por litro</label>
              <input id="p" className="campo" inputMode="decimal" value={precio}
                     onChange={e => setPrecio(e.target.value)} />
            </div>
            <div>
              <label htmlFor="c">Costo por litro</label>
              <input id="c" className="campo" inputMode="decimal" value={costo}
                     onChange={e => setCosto(e.target.value)} />
            </div>
          </div>

          <Nota tono={margen <= 0 && costoC > 0 ? 'grave' : 'info'}>
            {costoC === 0
              ? 'Sin costo cargado podemos mostrarte cuánto facturás, pero no cuánto ganás.'
              : margen <= 0
                ? <>Estás <strong>perdiendo plata</strong>: el costo es mayor o igual al precio.</>
                : <>Margen <strong>{pesos(margen)}</strong> por litro ({pct}%). Un vaso de 473 ml
                   se cobra {pesos(Math.ceil((473 * precioC) / 1000))} y deja{' '}
                   {pesos(Math.ceil((473 * precioC) / 1000) - Math.floor((473 * costoC) / 1000))}.</>}
          </Nota>

          <div className="rejilla c2" style={{ gap: 12 }}>
            <div>
              <label htmlFor="pl">Pulsos por litro</label>
              <input id="pl" className="campo" inputMode="decimal" value={pulsos}
                     onChange={e => setPulsos(e.target.value)} />
              <small style={{ color: 'var(--ink-3)' }}>Sale de la calibración con agua.</small>
            </div>
            <div>
              <label htmlFor="m">Mínimo servible (ml)</label>
              <input id="m" className="campo" inputMode="numeric" value={minimo}
                     onChange={e => setMinimo(e.target.value)} />
              <small style={{ color: 'var(--ink-3)' }}>Con menos saldo no se abre sesión.</small>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {imagen
              ? <img src={imagen} alt="" width={72} height={72}
                     style={{ borderRadius: 12, objectFit: 'cover', flex: 'none' }} />
              : <span style={{ width: 72, height: 72, borderRadius: 12, flex: 'none',
                               background: color, display: 'grid', placeItems: 'center', fontSize: 30 }}>🍺</span>}
            <div className="crece">
              <button className="btn sm" disabled={subiendo} onClick={() => archivo.current?.click()}>
                {subiendo ? 'Subiendo…' : imagen ? 'Cambiar imagen' : 'Subir logo o foto'}
              </button>
              {imagen && <button className="btn sm" style={{ marginLeft: 6 }}
                                 onClick={() => setImagen('')}>Quitar</button>}
              <input ref={archivo} type="file" accept="image/*" hidden
                     onChange={e => { const f = e.target.files?.[0]; if (f) void subir(f); e.target.value = '' }} />
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
                Se achica sola antes de subir. Hasta 3 MB.
              </div>
            </div>
          </div>

          <div className="rejilla c2" style={{ gap: 12 }}>
            <div>
              <label htmlFor="es">Estilo</label>
              <input id="es" className="campo" value={estilo} placeholder="IPA, Stout, Kölsch…"
                     onChange={e => setEstilo(e.target.value)} />
            </div>
            <div>
              <label htmlFor="co">Color en la pantalla</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input id="co" type="color" value={color} onChange={e => setColor(e.target.value)}
                       style={{ width: 52, height: 42, padding: 2, borderRadius: 8,
                                border: '1px solid var(--linea-fuerte)', background: 'var(--superficie)' }} />
                <input className="campo" value={color} onChange={e => setColor(e.target.value)} />
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="de">Descripción corta</label>
            <input id="de" className="campo" value={desc} maxLength={80}
                   placeholder="Cítrica y bien lupulada" onChange={e => setDesc(e.target.value)} />
          </div>

          <div className="rejilla c2" style={{ gap: 12 }}>
            <div>
              <label htmlFor="ab">Alcohol (%)</label>
              <input id="ab" className="campo" inputMode="decimal" value={abv}
                     placeholder="5.4" onChange={e => setAbv(e.target.value)} />
            </div>
            <div>
              <label htmlFor="ib">Amargor (IBU)</label>
              <input id="ib" className="campo" inputMode="numeric" value={ibu}
                     placeholder="45" onChange={e => setIbu(e.target.value)} />
            </div>
          </div>

          <Nota tono="info">
            Todo esto es lo que muestra la pantalla que va al lado del grifo. El
            color tiñe el líquido animado del fondo.
          </Nota>
        </div>
      )}
    </Modal>
  )
}
