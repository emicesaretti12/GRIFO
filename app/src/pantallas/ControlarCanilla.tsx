import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fecha } from '../lib/plata'
import { useIntervalo } from '../lib/useIntervalo'
import {
  mensajeDeError, saludDeCanilla, haceCuanto, estadoDeOrden,
  NOMBRE_ORDEN, DETALLE_ORDEN,
  type Grifo, type OrdenCanilla, type TipoOrden,
} from '../lib/tipos'
import { Modal, Confirmar } from '../componentes/Modal'
import { Chip, Nota } from '../componentes/UI'
import Icono from '../componentes/Icono'

type Avisar = (t: string, o?: { tono?: 'bien' | 'grave' | 'neutro'; detalle?: string }) => void

/**
 * Mandarle órdenes a una canilla.
 *
 * ── Por qué esto no es un botón que "hace" algo ─────────────────────────────
 * El ESP32 está detrás del router del bar: sin IP pública y sin puerto abierto.
 * Nadie de afuera puede iniciarle una conversación.
 *
 * Así que acá no se ejecuta nada: se **deja anotada** una orden, y la canilla la
 * busca en su próximo latido. Por eso la pantalla habla de "pedido" y muestra en
 * qué estado va, en vez de fingir que pasó al instante.
 *
 *   Es la diferencia entre un webhook y un polling. Cuando el que tiene que
 *   recibir no es alcanzable, el que recibe pregunta — y la interfaz tiene que
 *   ser honesta sobre eso en vez de mentir un spinner.
 */
export default function ControlarCanilla({ grifo, onCerrar, avisar }: {
  grifo: Grifo
  onCerrar: () => void
  avisar: Avisar
}) {
  const [ordenes, setOrdenes] = useState<OrdenCanilla[]>([])
  const [ssid, setSsid] = useState('')
  const [clave, setClave] = useState('')
  const [verClave, setVerClave] = useState(false)
  const [confirmando, setConfirmando] = useState<TipoOrden | null>(null)
  const [mandando, setMandando] = useState(false)

  const enLinea = saludDeCanilla(grifo.ultimo_latido) === 'en-linea'

  const traer = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_listar_ordenes', { p_grifo: grifo.id })
    if (!error) setOrdenes(data as OrdenCanilla[])
  }, [grifo.id])

  useEffect(() => { void traer() }, [traer])

  // Mientras el modal esté abierto, se refresca solo: lo interesante de esta
  // pantalla es justamente ver la orden pasar de "esperando" a "aplicada".
  useIntervalo(() => { void traer() }, 5000)

  async function ordenar(tipo: TipoOrden, datos: Record<string, string> = {}) {
    setMandando(true)
    const { data, error } = await supabase.rpc('admin_ordenar', {
      p_grifo: grifo.id, p_tipo: tipo, p_datos: datos,
    })
    setMandando(false)
    setConfirmando(null)

    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return }
    const r = data as { ok: boolean; motivo?: string }
    if (!r.ok) { avisar('No se pudo', { tono: 'grave', detalle: mensajeDeError(r) }); return }

    avisar(enLinea ? 'Pedido. Llega en menos de 30 s.' : 'Anotado. Se aplica cuando vuelva.',
           { tono: 'bien' })
    if (tipo === 'wifi') { setSsid(''); setClave('') }
    await traer()
  }

  async function cancelar(id: number) {
    const { data, error } = await supabase.rpc('admin_cancelar_orden', { p_orden: id })
    if (error) { avisar('Error', { tono: 'grave', detalle: error.message }); return }
    if (!(data as { ok: boolean }).ok) {
      avisar('Ya no se puede', { tono: 'grave', detalle: 'La canilla ya la aplicó.' })
    }
    await traer()
  }

  const pendientes = ordenes.filter(o => !o.aplicada_en && !o.cancelada_en)

  return (
    <>
      {confirmando && (
        <Confirmar
          titulo={`${NOMBRE_ORDEN[confirmando]} · ${grifo.nombre}`}
          bajada={confirmando === 'reiniciar'
            ? 'La canilla se reinicia sola. No lo hace si está sirviendo: espera a que el cliente termine.'
            : 'Se le borra la red guardada. Al reiniciar va a levantar su propio WiFi (GRIFO-' +
              grifo.id + ') para configurarla desde el celular, y hasta entonces no puede vender.'}
          textoAccion={confirmando === 'reiniciar' ? 'Reiniciar' : 'Borrar el WiFi'}
          tono={confirmando === 'reiniciar' ? 'primario' : 'grave'}
          onSi={() => ordenar(confirmando)}
          onCerrar={() => setConfirmando(null)} />
      )}

      <Modal titulo={`Controlar · ${grifo.nombre}`}
             bajada="Acá no se ejecuta nada al instante. Se deja la orden anotada y la canilla la busca en su próximo latido."
             onCerrar={onCerrar}
             acciones={<button className="btn" onClick={onCerrar}>Cerrar</button>}>

        {/* ── Dónde está parada ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {enLinea
            ? <Chip tono="bien">En línea</Chip>
            : <Chip tono="grave">Sin señal · {haceCuanto(grifo.ultimo_latido)}</Chip>}
          {grifo.ip_local && <Chip>{grifo.ip_local}</Chip>}
          {grifo.firmware && <Chip>{grifo.firmware}</Chip>}
          {grifo.senal_dbm != null && enLinea && <Chip>{grifo.senal_dbm} dBm</Chip>}
          {enLinea && grifo.estado_texto && <Chip tono="bien">{grifo.estado_texto}</Chip>}
        </div>

        {grifo.ultimo_evento && (
          <p className="bajada" style={{ marginTop: -6 }}>
            <strong>Lo último que le pasó:</strong> {grifo.ultimo_evento}
          </p>
        )}

        {!enLinea && (
          <Nota tono="ojo">
            La canilla no está reportando. La orden <strong>queda anotada igual</strong> y
            se aplica sola en cuanto vuelva a conectarse. Si nunca vuelve, hay que ir con
            un celular y usar el portal.
          </Nota>
        )}

        {/* ── Cambiar de red ────────────────────────────────────────────── */}
        <h4 style={{ margin: '20px 0 4px', fontSize: 14 }}>Cambiar de red WiFi</h4>
        <p className="bajada" style={{ marginTop: 0 }}>
          Mudás la canilla a otra red sin ir hasta ahí.
        </p>

        <div className="rejilla c2" style={{ gap: 12 }}>
          <div>
            <label htmlFor="os">Red</label>
            <input id="os" className="campo" value={ssid} placeholder="Nombre exacto de la red"
                   autoCapitalize="off" spellCheck={false}
                   onChange={e => setSsid(e.target.value)} />
          </div>
          <div>
            <label htmlFor="oc">Clave</label>
            <input id="oc" className="campo" type={verClave ? 'text' : 'password'}
                   value={clave} autoCapitalize="off" spellCheck={false}
                   onChange={e => setClave(e.target.value)} />
            <button type="button" className="btn sm" style={{ marginTop: 6 }}
                    onClick={() => setVerClave(v => !v)}>
              {verClave ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </div>

        <Nota tono="info">
          <strong>Se puede probar sin miedo.</strong> La red nueva entra a prueba y la
          anterior queda de respaldo: si no conecta en 20 segundos, la canilla
          <strong> vuelve sola</strong> a la que andaba. La clave viaja una sola vez y el
          servidor la borra apenas la canilla confirma — en el historial queda el nombre
          de la red, nunca la clave.
        </Nota>

        <button className="btn primario" disabled={ssid.trim() === '' || mandando}
                style={{ marginTop: 10 }}
                onClick={() => ordenar('wifi', { ssid: ssid.trim(), pass: clave })}>
          Mandarle la red nueva
        </button>

        {/* ── Las otras dos ─────────────────────────────────────────────── */}
        <hr style={{ border: 0, borderTop: '1px solid var(--linea)', margin: '22px 0 16px' }} />

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" disabled={mandando} onClick={() => setConfirmando('reiniciar')}>
            <Icono nombre="refrescar" tam={14} /> Reiniciar
          </button>
          <button className="btn" disabled={mandando} onClick={() => setConfirmando('olvidar_wifi')}>
            <Icono nombre="alerta" tam={14} /> Borrar el WiFi
          </button>
        </div>
        <p className="bajada" style={{ marginTop: 8 }}>
          Borrar el WiFi la deja levantando su propio portal, para configurarla desde el
          celular estando al lado. Es la salida cuando no sabés a qué red mandarla.
        </p>

        {/* ── Qué pasó con lo que pediste ───────────────────────────────── */}
        <hr style={{ border: 0, borderTop: '1px solid var(--linea)', margin: '22px 0 14px' }} />
        <h4 style={{ margin: '0 0 10px', fontSize: 14 }}>
          Últimas órdenes{pendientes.length > 0 ? ` · ${pendientes.length} sin aplicar` : ''}
        </h4>

        {ordenes.length === 0 ? (
          <p className="bajada" style={{ margin: 0 }}>Todavía no le mandaste ninguna.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {ordenes.slice(0, 8).map(o => {
              const est = estadoDeOrden(o)
              return (
                <div key={o.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px',
                  border: '1px solid var(--linea)', borderRadius: 10, flexWrap: 'wrap',
                }}>
                  <div className="crece" style={{ minWidth: 150 }}>
                    <strong style={{ fontSize: 13.5 }}>
                      {NOMBRE_ORDEN[o.tipo]}{o.ssid ? ` → ${o.ssid}` : ''}
                    </strong>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {fecha(o.creada_en)} · {DETALLE_ORDEN[est]}
                    </div>
                  </div>
                  {est === 'aplicada'   && <Chip tono="bien">Aplicada</Chip>}
                  {est === 'entregada'  && <Chip tono="ojo">Recibida</Chip>}
                  {est === 'esperando'  && <Chip>Esperando</Chip>}
                  {est === 'cancelada'  && <Chip>Cancelada</Chip>}
                  {(est === 'esperando' || est === 'entregada') && (
                    <button className="btn sm" onClick={() => cancelar(o.id)}>Cancelar</button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Modal>
    </>
  )
}
