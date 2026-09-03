import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Nota } from '../componentes/UI'

export default function Login() {
  const [email, setEmail] = useState('')
  const [clave, setClave] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setError(null); setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: clave })
    if (error) {
      setError(error.message.includes('Email not confirmed')
        ? 'Ese usuario todavía no confirmó el mail. Confirmalo desde Supabase → Authentication.'
        : 'Mail o contraseña incorrectos.')
    }
    setEnviando(false)
  }

  return (
    <div className="portada">
      <form className="panel" onSubmit={entrar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 26 }} aria-hidden="true">🍺</span>
          <div>
            <h2 style={{ fontSize: 18 }}>Grifo</h2>
            <p className="bajada" style={{ margin: 0 }}>Gestión del autoservicio</p>
          </div>
        </div>

        <div style={{ margin: '20px 0 12px' }}>
          <label htmlFor="email">Mail</label>
          <input id="email" className="campo" type="email" value={email} autoFocus
                 onChange={e => setEmail(e.target.value)} autoComplete="username" required />
        </div>

        <div style={{ marginBottom: 18 }}>
          <label htmlFor="clave">Contraseña</label>
          <input id="clave" className="campo" type="password" value={clave}
                 onChange={e => setClave(e.target.value)} autoComplete="current-password" required />
        </div>

        {error && <Nota tono="grave">{error}</Nota>}

        <button className="btn primario bloque lg" disabled={enviando || !email || !clave}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
