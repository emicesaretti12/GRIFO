import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import Icono from './Icono'

type Tono = 'bien' | 'grave' | 'neutro'
type Tostada = { id: number; tono: Tono; titulo: string; detalle?: string }

const Ctx = createContext<{
  avisar: (titulo: string, opciones?: { tono?: Tono; detalle?: string }) => void
}>({ avisar: () => {} })

export const useAvisos = () => useContext(Ctx)

/**
 * Avisos efímeros en una esquina. Reemplazan a los carteles que empujaban el
 * contenido: el layout ya no salta cuando aparece un mensaje, y el usuario no
 * pierde de vista lo que estaba mirando.
 */
export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Tostada[]>([])

  const avisar = useCallback((titulo: string, o?: { tono?: Tono; detalle?: string }) => {
    const id = Date.now() + Math.random()
    setLista(l => [...l, { id, titulo, tono: o?.tono ?? 'neutro', detalle: o?.detalle }])
    // Los errores quedan más tiempo: hay que poder leerlos.
    const vida = o?.tono === 'grave' ? 7000 : 3800
    setTimeout(() => setLista(l => l.filter(t => t.id !== id)), vida)
  }, [])

  return (
    <Ctx.Provider value={{ avisar }}>
      {children}
      <div className="tostadas" role="status" aria-live="polite">
        {lista.map(t => (
          <div key={t.id} className={`tostada ${t.tono}`}>
            <Icono nombre={t.tono === 'grave' ? 'alerta' : t.tono === 'bien' ? 'ok' : 'info'} tam={17} />
            <div className="cuerpo">
              <strong>{t.titulo}</strong>
              {t.detalle && <small>{t.detalle}</small>}
            </div>
            <button className="btn fantasma sm" aria-label="Cerrar aviso"
                    onClick={() => setLista(l => l.filter(x => x.id !== t.id))}>
              <Icono nombre="cerrar" tam={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
