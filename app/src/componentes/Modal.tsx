import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Diálogo accesible. Reemplaza a confirm() y prompt() del navegador, que
 * bloquean el hilo, no se pueden estilar y en una tablet quedan de otro mundo.
 *
 * Hace lo que un diálogo tiene que hacer: cierra con Escape, atrapa el foco
 * adentro mientras está abierto, y lo devuelve a donde estaba al cerrarse.
 */
export function Modal({ titulo, bajada, children, acciones, onCerrar }: {
  titulo: string
  bajada?: string
  children?: ReactNode
  acciones: ReactNode
  onCerrar: () => void
}) {
  const caja = useRef<HTMLDivElement>(null)
  const foco = useRef<HTMLElement | null>(null)

  useEffect(() => {
    foco.current = document.activeElement as HTMLElement
    const primero = caja.current?.querySelector<HTMLElement>(
      'input, select, textarea, button, [href]'
    )
    primero?.focus()

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onCerrar(); return }
      if (e.key !== 'Tab' || !caja.current) return

      // Trampa de foco: con Tab en el último elemento volvemos al primero, y
      // al revés con Shift+Tab. Si no, el foco se escapa al fondo de la página
      // y quien navega con teclado queda perdido.
      const focos = caja.current.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href]'
      )
      if (focos.length === 0) return
      const primero = focos[0], ultimo = focos[focos.length - 1]
      if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus() }
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus() }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      foco.current?.focus()
    }
  }, [onCerrar])

  return (
    <div className="telon" onMouseDown={e => { if (e.target === e.currentTarget) onCerrar() }}>
      <div className="modal" ref={caja} role="dialog" aria-modal="true" aria-label={titulo}>
        <h2>{titulo}</h2>
        {bajada && <p className="bajada">{bajada}</p>}
        {children}
        <div className="acciones">{acciones}</div>
      </div>
    </div>
  )
}

/** Confirmación con un texto de acción explícito ("Bloquear", "Rotar token"),
 *  nunca un "Aceptar" genérico que no dice qué va a pasar. */
export function Confirmar({ titulo, bajada, textoAccion, tono = 'primario', onSi, onCerrar, children }: {
  titulo: string
  bajada?: string
  textoAccion: string
  tono?: 'primario' | 'grave'
  onSi: () => void
  onCerrar: () => void
  children?: ReactNode
}) {
  const [enviando, setEnviando] = useState(false)
  return (
    <Modal titulo={titulo} bajada={bajada} onCerrar={onCerrar} acciones={
      <>
        <button className="btn" onClick={onCerrar} disabled={enviando}>Cancelar</button>
        <button className={`btn ${tono}`} disabled={enviando}
                onClick={() => { setEnviando(true); onSi() }}>
          {enviando ? 'Un segundo…' : textoAccion}
        </button>
      </>
    }>
      {children}
    </Modal>
  )
}
