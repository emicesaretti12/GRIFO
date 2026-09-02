import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: clave })
    if (error) setError('No pudimos entrar: revisá el mail y la contraseña.')
    setEnviando(false)
  }

  return (
    <div className="login">
      <form className="panel caja" onSubmit={entrar}>
        <h2>Grifo — Gestión</h2>
        <p className="sub">Entrá con tu usuario del personal.</p>

        <div style={{ marginBottom: 12 }}>
          <label htmlFor="email">Mail</label>
          <input id="email" className="campo" type="email" value={email}
                 onChange={e => setEmail(e.target.value)} autoComplete="username" required />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label htmlFor="clave">Contraseña</label>
          <input id="clave" className="campo" type="password" value={clave}
                 onChange={e => setClave(e.target.value)} autoComplete="current-password" required />
        </div>

        {error && <div className="aviso error">{error}</div>}

        <button className="btn primario ancho" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
