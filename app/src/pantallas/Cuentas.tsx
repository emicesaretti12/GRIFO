import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pesos, fecha } from '../lib/plata'
import { bajarCSV } from '../lib/csv'
import { mensajeDeError, type Cuenta, type RespuestaDevolucion } from '../lib/tipos'
import { Panel, Stat, Chip, Vacio, HuesoTabla, Nota } from '../componentes/UI'
import { Confirmar } from '../componentes/Modal'
import { useAvisos } from '../componentes/Toast'
import Icono from '../componentes/Icono'
import QR from '../componentes/QR'

type Filtro = 'todas' | 'con-saldo' | 'bloqueadas'

type Padron = {
  ok: true
  /** Sobre TODAS las cuentas, no sobre las que se ven con el filtro. */
  total_centavos: number
  con_saldo: number
  bloqueadas: number
  cuentas: Cuenta[]
}

const NOMBRE_TIPO: Record<Cuenta['tipo'], string> = { app: 'App', ticket: 'Ticket', tarjeta: 'Tarjeta vieja' }

/** El padrón: todas las cuentas de clientes y la plata que el bar les debe.
 *
 *  Un mismo DNI puede aparecer dos veces, una por la app y otra por el ticket:
 *  son dos saldos distintos a propósito (ver docs/qr.md). */
export default function Cuentas({ alAbrir }: { alAbrir: (uid: string) => void }) {
  const { avisar } = useAvisos()
  const [padron, setPadron] = useState<Padron | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [cargando, setCargando] = useState(true)
  const [devolviendo, setDevolviendo] = useState<Cuenta | null>(null)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    let vigente = true
    setCargando(true)
    // Debounce: sin esto le pegamos a la API en cada tecla.
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('admin_listar_cuentas', {
        p_buscar: busqueda.trim() || null, p_filtro: filtro,
      })
      if (!vigente) return
      setCargando(false)
      if (error) {
        const falta = error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')
        avisar('No pudimos buscar', { tono: 'grave', detalle: falta ? mensajeDeError({ motivo: 'sin_backend' }) : error.message })
        return
      }
      const r = data as Padron | { ok: false; motivo: string }
      if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: mensajeDeError(r) }); return }
      setPadron(r)
    }, 250)
    return () => { vigente = false; clearTimeout(t) }
  }, [busqueda, filtro, vuelta, avisar])

  // Las tarjetas de antes del QR no se abren en la caja: solo queda devolverles
  // el saldo, si tenían.
  const devolver = useCallback(async (c: Cuenta) => {
    const { data, error } = await supabase.rpc('caja_devolver_tarjeta', { p_uid: c.uid })
    setDevolviendo(null)
    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return }
    const r = data as RespuestaDevolucion
    if (!r.ok) { avisar('No se pudo devolver', { tono: 'grave', detalle: mensajeDeError(r) }); return }
    avisar(`Devolvele ${pesos(r.devuelto_centavos)} en efectivo`, { tono: 'bien', detalle: 'La tarjeta quedó en cero.' })
    setVuelta(v => v + 1)
  }, [avisar])

  const cuentas = padron?.cuentas ?? []
  const enlace = `${location.origin}${location.pathname}#/cliente`

  return (
    <>
      <div className="rejilla c3">
        <div className="panel"><Stat etiqueta="Saldo en circulación" valor={pesos(padron?.total_centavos)}
          pie="plata ya cobrada que el bar todavía debe en cerveza" /></div>
        <div className="panel"><Stat etiqueta="Cuentas con saldo" valor={padron ? String(padron.con_saldo) : '—'} /></div>
        <div className="panel"><Stat etiqueta="Bloqueadas" valor={padron ? String(padron.bloqueadas) : '—'} /></div>
      </div>

      <Panel accion={
        <button className="btn sm" disabled={cuentas.length === 0}
                onClick={() => bajarCSV('cuentas', [
                  ['DNI', 'Nombre', 'Tipo', 'Saldo', 'Bloqueada', 'Motivo', 'Ultimo movimiento'],
                  ...cuentas.map(c => [
                    c.dni ?? '', c.nombre ?? '', NOMBRE_TIPO[c.tipo], (c.saldo_centavos / 100).toFixed(2),
                    c.bloqueada ? 'si' : 'no', c.bloqueada_motivo ?? '', c.actualizada_en,
                  ]),
                ])}>
          <Icono nombre="descargar" tam={15} /> Exportar CSV
        </button>
      }>
        <div className="fila">
          <div className="crece buscador">
            <Icono nombre="buscar" tam={16} />
            <input className="campo" placeholder="Buscar por DNI o por nombre…" aria-label="Buscar por DNI o por nombre"
                   value={busqueda} onChange={e => setBusqueda(e.target.value)} />
          </div>
          <div className="grupo-btn">
            {([['todas', 'Todas'], ['con-saldo', 'Con saldo'], ['bloqueadas', 'Bloqueadas']] as const)
              .map(([id, texto]) => (
                <button key={id} aria-pressed={filtro === id} onClick={() => setFiltro(id)}>{texto}</button>
              ))}
          </div>
        </div>
      </Panel>

      <Panel pegado>
        {cargando && !padron ? <HuesoTabla /> : cuentas.length === 0 ? (
          <Vacio icono="personas" titulo="Ninguna cuenta coincide">
            {busqueda ? 'Probá con otro DNI o con otro nombre.' : 'Todavía no hay clientes.'}
          </Vacio>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th><th>DNI</th><th>Cuenta</th><th className="num">Saldo</th>
                  <th>Estado</th><th>Último movimiento</th><th><span className="sr">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {cuentas.map(c => (
                  <tr key={c.uid}>
                    <td style={{ fontWeight: 600 }}>{c.nombre ?? '—'}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{c.dni ?? '—'}</td>
                    <td>
                      {c.tipo === 'app' ? <Chip tono="dato">App</Chip>
                        : c.tipo === 'ticket' ? <Chip>Ticket</Chip>
                        : <Chip tono="ojo">Tarjeta vieja</Chip>}
                    </td>
                    <td className="num" style={{ fontWeight: 650 }}>{pesos(c.saldo_centavos)}</td>
                    <td>{c.bloqueada
                      ? <Chip tono="grave">{c.bloqueada_motivo || 'Bloqueada'}</Chip>
                      : <Chip tono="bien">Activa</Chip>}</td>
                    <td style={{ color: 'var(--ink-2)' }}>{fecha(c.actualizada_en)}</td>
                    <td className="num">
                      {c.tipo === 'tarjeta'
                        ? c.saldo_centavos > 0 && (
                            <button className="btn sm" onClick={() => setDevolviendo(c)}>Devolver saldo</button>
                          )
                        : <button className="btn sm" onClick={() => alAbrir(c.uid)}>Abrir en la caja</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel titulo="La app de los clientes"
             bajada="El link que abren en su celular para cargar saldo y mostrar su QR.">
        <div className="fila" style={{ alignItems: 'center', gap: 20 }}>
          <div style={{ flex: 'none' }}><QR texto={enlace} tam={150} /></div>
          <div className="crece">
            <p style={{ margin: '0 0 8px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 14, overflowWrap: 'anywhere' }}>{enlace}</p>
            <Nota tono="info">
              Imprimí este QR y pegalo en la barra y en las mesas. El cliente lo escanea con la
              cámara, entra con su nombre y su DNI, y ya puede cargar con Mercado Pago.
            </Nota>
          </div>
        </div>
      </Panel>

      {devolviendo && (
        <Confirmar titulo="Devolver el saldo de una tarjeta vieja"
                   bajada={`${devolviendo.nombre ?? devolviendo.uid} tiene ${pesos(devolviendo.saldo_centavos)}.`}
                   textoAccion="Devolver en efectivo"
                   onSi={() => devolver(devolviendo)} onCerrar={() => setDevolviendo(null)}>
          <Nota tono="ojo">
            Las tarjetas ya no abren ninguna canilla: ahora se usa el QR. Devolvele la plata
            en efectivo y, si quiere seguir, cargale un ticket con su DNI en la caja.
          </Nota>
        </Confirmar>
      )}
    </>
  )
}
