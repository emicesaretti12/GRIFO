import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { fecha } from '../lib/plata'
import { mensajeDeError, type Rol } from '../lib/tipos'

type FilaPersonal = {
  user_id: string
  nombre: string | null
  rol: Rol
  activo: boolean
  creado_en: string
}

export default function Personal() {
  const [gente, setGente] = useState<FilaPersonal[]>([])
  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [rol, setRol] = useState<Rol>('cajero')
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)

  async function cargar() {
    const { data, error: err } = await supabase
      .from('personal').select('*').order('creado_en')
    if (err) setError(err.message)
    else setGente(data as FilaPersonal[])
  }
  useEffect(() => { void cargar() }, [])

  async function alta(e: FormEvent) {
    e.preventDefault()
    setError(null); setExito(null)
    const { data, error: err } = await supabase.rpc('admin_set_rol', {
      p_email: email, p_rol: rol, p_nombre: nombre || null,
    })
    if (err) { setError(err.message); return }
    const r = data as { ok: boolean; motivo?: string; detalle?: string }
    if (!r.ok) { setError(mensajeDeError(r)); return }
    setExito(`${email} quedó como ${rol}.`)
    setEmail(''); setNombre('')
    await cargar()
  }

  async function baja(emailBaja: string) {
    if (!confirm(`¿Dar de baja a ${emailBaja}?`)) return
    setError(null); setExito(null)
    const { data, error: err } = await supabase.rpc('admin_baja_personal', { p_email: emailBaja })
    if (err) { setError(err.message); return }
    const r = data as { ok: boolean; motivo?: string }
    if (!r.ok) { setError(mensajeDeError(r)); return }
    setExito('Dado de baja.')
    await cargar()
  }

  return (
    <>
      <div className="panel">
        <h2>Dar de alta o cambiar rol</h2>
        <p className="sub">
          La persona tiene que existir antes en Supabase → Authentication → Users.
          Acá solo le asignás el rol.
        </p>

        <form onSubmit={alta}>
          <div className="fila">
            <div style={{ flex: 2 }}>
              <label htmlFor="mail">Mail</label>
              <input id="mail" className="campo" type="email" required
                     value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div>
              <label htmlFor="nom">Nombre</label>
              <input id="nom" className="campo" value={nombre}
                     onChange={e => setNombre(e.target.value)} />
            </div>
            <div className="angosto">
              <label htmlFor="rol">Rol</label>
              <select id="rol" className="campo" value={rol}
                      onChange={e => setRol(e.target.value as Rol)}>
                <option value="cajero">Cajero</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="angosto">
              <button className="btn primario">Guardar</button>
            </div>
          </div>
        </form>

        {error && <div className="aviso error">{error}</div>}
        {exito && <div className="aviso exito">{exito}</div>}
      </div>

      <div className="panel">
        <h2>Personal</h2>
        <p className="sub">
          El cajero carga saldo y consulta tarjetas. El admin además toca precios,
          calibración, tokens y ve los reportes.
        </p>
        <div className="tabla-scroll">
          <table>
            <thead>
              <tr><th>Nombre</th><th>Rol</th><th>Estado</th><th>Desde</th></tr>
            </thead>
            <tbody>
              {gente.map(p => (
                <tr key={p.user_id}>
                  <td>{p.nombre ?? '—'}</td>
                  <td><span className={p.rol === 'admin' ? 'chip ok' : 'chip neutro'}>{p.rol}</span></td>
                  <td>{p.activo ? 'Activo' : <span className="chip neutro">De baja</span>}</td>
                  <td>{fecha(p.creado_en)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {gente.length === 0 && <p className="vacio">Todavía no hay nadie cargado.</p>}
        <p className="sub" style={{ marginTop: 12 }}>
          Para dar de baja, escribí el mail arriba y usá el botón de abajo.
        </p>
        <BajaRapida onBaja={baja} />
      </div>
    </>
  )
}

function BajaRapida({ onBaja }: { onBaja: (email: string) => void }) {
  const [email, setEmail] = useState('')
  return (
    <div className="fila">
      <div>
        <label htmlFor="baja">Mail a dar de baja</label>
        <input id="baja" className="campo" type="email" value={email}
               onChange={e => setEmail(e.target.value)} />
      </div>
      <div className="angosto">
        <button className="btn peligro" disabled={!email} onClick={() => onBaja(email)}>
          Dar de baja
        </button>
      </div>
    </div>
  )
}
