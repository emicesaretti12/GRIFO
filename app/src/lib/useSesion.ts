import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Rol } from './tipos'

/**
 * Estado de autenticación + rol del usuario.
 *
 * El rol se lee de la base, NO del token: es la base la que manda. Acá solo lo
 * usamos para dibujar el menú. Aunque alguien se truchara el rol en el front,
 * las RPC y las policies lo rebotan igual.
 */
export function useSesion() {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [rol, setRol] = useState<Rol | null>(null)
  const [nombre, setNombre] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session)
      if (!data.session) setCargando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSesion(s)
      if (!s) { setRol(null); setNombre(null); setCargando(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!sesion) return
    let vigente = true
    setCargando(true)
    supabase
      .from('personal')
      .select('rol, nombre, activo')
      .eq('user_id', sesion.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!vigente) return
        setRol(data && data.activo ? (data.rol as Rol) : null)
        setNombre(data?.nombre ?? null)
        setCargando(false)
      })
    return () => { vigente = false }
  }, [sesion])

  return {
    sesion,
    rol,
    nombre,
    cargando,
    esAdmin: rol === 'admin',
    esPersonal: rol !== null,
    salir: () => supabase.auth.signOut(),
  }
}
