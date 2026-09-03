import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSesion } from '../lib/useSesion'
import { fecha } from '../lib/plata'
import { mensajeDeError, type Rol } from '../lib/tipos'
import { Panel, Chip, Nota, Vacio, HuesoTabla } from '../componentes/UI'
import { Confirmar } from '../componentes/Modal'
import { useAvisos } from '../componentes/Toast'
import Icono from '../componentes/Icono'

type Fila = {
  user_id: string; email: string; nombre: string | null
  rol: Rol; activo: boolean; creado_en: string
}

export default function Personal() {
  const { avisar } = useAvisos()
  const { sesion } = useSesion()
  const [gente, setGente] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [rol, setRol] = useState<Rol>('cajero')
  const [enviando, setEnviando] = useState(false)
  const [aDarDeBaja, setADarDeBaja] = useState<Fila | null>(null)

  const traer = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_listar_personal')
    if (error) avisar('No pudimos leer el personal', { tono: 'grave', detalle: error.message })
    else setGente((data ?? []) as Fila[])
    setCargando(false)
  }, [avisar])
  useEffect(() => { void traer() }, [traer])

  async function alta(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    const { data, error } = await supabase.rpc('admin_set_rol', {
      p_email: email.trim(), p_rol: rol, p_nombre: nombre.trim() || null,
    })
    setEnviando(false)
    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return }
    const r = data as { ok: boolean; motivo?: string; detalle?: string }
    if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: mensajeDeError(r) }); return }
    avisar(`${email} quedó como ${rol === 'admin' ? 'administrador' : 'cajero'}`, { tono: 'bien' })
    setEmail(''); setNombre('')
    await traer()
  }

  async function cambiarRol(p: Fila, nuevo: Rol) {
    const { data, error } = await supabase.rpc('admin_set_rol', {
      p_email: p.email, p_rol: nuevo, p_nombre: p.nombre,
    })
    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return }
    const r = data as { ok: boolean; motivo?: string }
    if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: mensajeDeError(r) }); return }
    avisar('Rol actualizado', { tono: 'bien' })
    await traer()
  }

  async function baja(p: Fila) {
    const { data, error } = await supabase.rpc('admin_baja_personal', { p_email: p.email })
    setADarDeBaja(null)
    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return }
    const r = data as { ok: boolean; motivo?: string }
    if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: mensajeDeError(r) }); return }
    avisar(`${p.nombre ?? p.email} quedó de baja`, { tono: 'bien' })
    await traer()
  }

  return (
    <>
      {aDarDeBaja && (
        <Confirmar titulo={`Dar de baja a ${aDarDeBaja.nombre ?? aDarDeBaja.email}`}
                   bajada="Deja de poder entrar al sistema. No se borra nada: los movimientos que firmó siguen con su nombre, para que la auditoría no pierda el rastro."
                   textoAccion="Dar de baja" tono="grave"
                   onSi={() => baja(aDarDeBaja)} onCerrar={() => setADarDeBaja(null)} />
      )}

      <Panel titulo="Dar de alta"
             bajada="La persona tiene que existir antes en Supabase → Authentication → Users. Acá le asignás el rol.">
        <form onSubmit={alta}>
          <div className="fila">
            <div className="crece" style={{ minWidth: 220 }}>
              <label htmlFor="mail">Mail</label>
              <input id="mail" className="campo" type="email" required value={email}
                     placeholder="persona@ejemplo.com"
                     onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="crece">
              <label htmlFor="nom">Nombre</label>
              <input id="nom" className="campo" value={nombre} placeholder="Cómo aparece en la lista"
                     onChange={e => setNombre(e.target.value)} />
            </div>
            <div>
              <label htmlFor="rol">Rol</label>
              <select id="rol" className="campo" value={rol} style={{ width: 160 }}
                      onChange={e => setRol(e.target.value as Rol)}>
                <option value="cajero">Cajero</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <button className="btn primario" disabled={enviando || !email}>
              <Icono nombre="mas" tam={16} /> {enviando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>

        <Nota tono="info">
          <strong>Cajero:</strong> consulta tarjetas, carga saldo y bloquea. No lee las tablas,
          así que no puede sacar la facturación ni el padrón aunque llame la API a mano.{' '}
          <strong>Administrador:</strong> todo lo anterior más canillas, tokens, reportes y personal.
        </Nota>
      </Panel>

      <Panel titulo="Equipo" bajada={`${gente.filter(p => p.activo).length} personas activas.`} pegado>
        {cargando ? <HuesoTabla columnas={5} /> : gente.length === 0 ? (
          <Vacio icono="personas" titulo="Todavía no hay nadie cargado">
            Empezá dando de alta a alguien con el formulario de arriba.
          </Vacio>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr><th>Persona</th><th>Rol</th><th>Estado</th><th>Desde</th><th /></tr>
              </thead>
              <tbody>
                {gente.map(p => (
                  <tr key={p.user_id} style={{ opacity: p.activo ? 1 : 0.55 }}>
                    <td>
                      <strong>{p.nombre ?? '—'}</strong>
                      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{p.email}</div>
                    </td>
                    <td>{p.rol === 'admin'
                      ? <Chip tono="dato">Administrador</Chip>
                      : <Chip>Cajero</Chip>}</td>
                    <td>{p.activo
                      ? <Chip tono="bien">Activo</Chip>
                      : <Chip tono="grave">De baja</Chip>}</td>
                    <td style={{ color: 'var(--ink-2)' }}>{fecha(p.creado_en)}</td>
                    <td>
                      {/* Sobre tu propio usuario no se ofrece nada: bajarte el rol o
                          darte de baja te dejaría afuera del sistema, y si sos el
                          único admin no queda nadie que pueda arreglarlo. El
                          servidor lo rechaza igual, pero un botón que siempre
                          falla es un botón que no debería existir. */}
                      {p.user_id === sesion?.user.id ? (
                        <div style={{ textAlign: 'right', fontSize: 12, color: 'var(--ink-3)' }}>
                          sos vos
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button className="btn sm"
                                  onClick={() => cambiarRol(p, p.rol === 'admin' ? 'cajero' : 'admin')}>
                            Hacer {p.rol === 'admin' ? 'cajero' : 'admin'}
                          </button>
                          {p.activo && (
                            <button className="btn sm grave" onClick={() => setADarDeBaja(p)}>
                              Dar de baja
                            </button>
                          )}
                        </div>
                      )}
                    </td>
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
