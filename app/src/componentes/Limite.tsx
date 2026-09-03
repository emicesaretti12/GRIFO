import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Red de contención. Sin esto, un error de render en cualquier pantalla deja la
 * app en blanco y el cajero no entiende qué pasó ni cómo salir.
 */
export class Limite extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error de render:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="portada">
        <div className="panel">
          <h2>Algo se rompió en la pantalla</h2>
          <p className="bajada">
            No se perdió nada: todas las operaciones se confirman en el servidor
            antes de mostrarse. Recargá para seguir.
          </p>
          <pre style={{
            fontSize: 12, background: 'var(--superficie-2)', padding: 12,
            borderRadius: 8, overflow: 'auto', color: 'var(--ink-2)',
          }}>{String(this.state.error)}</pre>
          <button className="btn primario bloque" onClick={() => location.reload()}>
            Recargar
          </button>
        </div>
      </div>
    )
  }
}
