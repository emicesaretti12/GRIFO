import { Panel, Nota } from '../componentes/UI'
import { useAvisos } from '../componentes/Toast'
import QR from '../componentes/QR'
import Icono from '../componentes/Icono'

/**
 * Cómo llevarse la caja al celular. No hay nada que instalar de una tienda: es
 * la misma app, en una ruta pensada para el teléfono.
 */
export default function CajaMovil() {
  const { avisar } = useAvisos()
  const link = `${location.origin}${location.pathname}#/movil`
  const nfc = typeof window !== 'undefined' && 'NDEFReader' in window

  return (
    <>
      <div className="rejilla lado">
        <Panel titulo="Llevate la caja al celular"
               bajada="Escaneá el QR con el teléfono del mozo. Entra con su propio usuario, así que rigen los mismos permisos.">
          <QR texto={link} tam={230} />
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn sm" onClick={() => {
              void navigator.clipboard?.writeText(link); avisar('Link copiado', { tono: 'bien' })
            }}>Copiar link</button>
            <a className="btn sm" href={link} target="_blank" rel="noreferrer">Abrir acá</a>
          </div>
        </Panel>

        <div>
          <Panel titulo="Qué se puede hacer desde el teléfono">
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9, color: 'var(--ink-2)' }}>
              <li><strong>Leer la tarjeta acercándola al celular</strong>, con el NFC</li>
              <li>Ver el saldo, el estado y los últimos movimientos</li>
              <li><strong>Cargar saldo en la mesa</strong>, sin volver a caja</li>
              <li>Bloquear una tarjeta perdida en el momento</li>
            </ul>
          </Panel>

          <Panel titulo="Para que el NFC funcione">
            <Nota tono={nfc ? 'bien' : 'ojo'}>
              {nfc
                ? 'Este navegador soporta lectura NFC.'
                : 'Este navegador no soporta NFC — es normal en una computadora. Lo que importa es el teléfono.'}
            </Nota>
            <ul style={{ margin: '4px 0 0', paddingLeft: 20, lineHeight: 1.9, color: 'var(--ink-2)' }}>
              <li><strong>Android con Chrome.</strong> En iPhone no se puede: Apple no
                  le da acceso al NFC a las páginas web.</li>
              <li><strong>Por HTTPS.</strong> Con la app publicada funciona; entrando por
                  IP local, no.</li>
              <li><strong>NFC prendido</strong> en los ajustes del teléfono.</li>
            </ul>
            <Nota tono="info">
              Sin NFC la pantalla igual sirve: se carga el número de la tarjeta a
              mano y todo lo demás funciona igual.
            </Nota>
          </Panel>

          <Panel titulo="Dejarlo como app en el teléfono">
            <p className="bajada" style={{ marginTop: 0 }}>
              En Chrome, con la página abierta: menú <Icono nombre="mas" tam={13} /> →
              <strong> Agregar a pantalla principal</strong>. Queda con ícono propio y
              se abre sin barras del navegador.
            </p>
          </Panel>
        </div>
      </div>
    </>
  )
}
