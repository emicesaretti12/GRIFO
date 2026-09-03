import { useEffect, useState } from 'react'

export type Tema = 'sistema' | 'claro' | 'oscuro'

/** Tema claro/oscuro. Por defecto sigue al sistema operativo; la elección
 *  explícita se guarda y gana sobre el sistema en ambos sentidos. */
export function useTema() {
  const [tema, setTema] = useState<Tema>(
    () => (localStorage.getItem('grifo.tema') as Tema) ?? 'sistema'
  )
  useEffect(() => {
    localStorage.setItem('grifo.tema', tema)
    if (tema === 'sistema') document.documentElement.removeAttribute('data-tema')
    else document.documentElement.setAttribute('data-tema', tema)
  }, [tema])
  return { tema, setTema }
}
