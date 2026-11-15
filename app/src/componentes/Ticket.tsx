import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import QRVector from './QRVector'
import { pesos } from '../lib/plata'
import { NOMBRE_MEDIO } from '../lib/tipos'
import { ZONA } from '../lib/jornada'

// ─────────────────────────────────────────────────────────────────────────────
// El ticket de la caja, con el QR para servirse.
//
// Es para el cliente que no tiene celular: da su DNI, paga, y se lleva este
// papel. El QR de abajo es lo que muestra en la tablet del grifo.
//
// ── Pensado para una impresora térmica ───────────────────────────────────────
// Todo negro pleno sobre blanco, sin grises: una térmica no tiene grises, los
// simula con puntitos y el resultado es un borrón. Por eso tampoco hay fondos
// ni líneas finas, y el QR es un vector con módulos enteros.
//
// Si no hay térmica, sale igual en una hoja común: queda arriba a la izquierda,
// del ancho de un ticket, y se recorta.
// ─────────────────────────────────────────────────────────────────────────────

export type DatosTicket = {
  nombre: string
  dni: string
  /** Con o sin el prefijo `GRIFO:`. */
  codigo: string
  venceEn: string
  saldoCentavos: number
  /** Solo si el ticket sale por una carga (no en una reimpresión). */
  cargadoCentavos?: number
  medio?: string
  cajero?: string | null
  emitido: Date
}

export type AnchoPapel = 80 | 58
const CLAVE_ANCHO = 'grifo.ticket.ancho'

export function leerAnchoPapel(): AnchoPapel {
  try { return localStorage.getItem(CLAVE_ANCHO) === '58' ? 58 : 80 } catch { return 80 }
}
export function guardarAnchoPapel(a: AnchoPapel) {
  try { localStorage.setItem(CLAVE_ANCHO, String(a)) } catch { /* sin almacenamiento */ }
}

/** El texto que va adentro del QR: siempre con el prefijo. */
export function textoDelQR(codigo: string): string {
  const c = codigo.trim().toUpperCase()
  return c.startsWith('GRIFO:') ? c : `GRIFO:${c}`
}

function dniConPuntos(dni: string): string {
  return dni.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

// Las fechas del ticket van siempre en hora argentina y de 24 horas, aunque la
// computadora de la caja tenga otra zona: "vale hasta las 6:00" tiene que decir
// 6:00. Y se arman pieza por pieza: el formato automático de es-AR escribe
// "15-11" y "9:00 a. m.", que en un ticket se leen mal.
const piezas = new Intl.DateTimeFormat('es-AR', {
  timeZone: ZONA, hourCycle: 'h23', weekday: 'long',
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})
function partes(d: Date): Record<string, string> {
  return Object.fromEntries(piezas.formatToParts(d).map(p => [p.type, p.value]))
}

export function Ticket({ datos, ancho = 80 }: { datos: DatosTicket; ancho?: AnchoPapel }) {
  const vence = partes(new Date(datos.venceEn))
  const hecho = partes(datos.emitido)
  return (
    <div className={ancho === 58 ? 'ticket angosto' : 'ticket'}>
      <p className="ticket-marca">GRIFO</p>
      <p className="ticket-centro">Cerveza tirada, al mililitro</p>

      <hr />
      <p className="ticket-nombre">{datos.nombre}</p>
      <p>DNI {dniConPuntos(datos.dni)}</p>
      <p>{hecho.day}/{hecho.month}/{hecho.year} {hecho.hour}:{hecho.minute}{datos.cajero ? ` · Atendió ${datos.cajero}` : ''}</p>

      <hr />
      {datos.cargadoCentavos != null && (
        <>
          <p className="ticket-renglon"><span>Carga</span><span>{pesos(datos.cargadoCentavos)}</span></p>
          {datos.medio && <p className="ticket-renglon"><span>Pago</span><span>{NOMBRE_MEDIO[datos.medio] ?? datos.medio}</span></p>}
        </>
      )}
      <p className="ticket-renglon fuerte"><span>Tu saldo</span><span>{pesos(datos.saldoCentavos)}</span></p>

      <hr />
      <p className="ticket-centro fuerte">Mostrá este código en la tablet del grifo</p>
      <QRVector className="ticket-qr" texto={textoDelQR(datos.codigo)} margen={3}
                titulo="Código QR para servirte" />
      <p className="ticket-centro">
        Vale hasta las {Number(vence.hour)}:{vence.minute} del {vence.weekday} {vence.day}/{vence.month}.
      </p>

      <hr />
      <p className="ticket-chico">
        Cuidalo como a la plata: el que tiene este papel puede servirse con tu saldo.
        Si lo perdés, avisá en la caja con tu DNI y te dan uno nuevo.
      </p>
      <p className="ticket-chico">
        El saldo que no uses queda a tu nombre. Pedí la devolución en la caja, con tu DNI.
      </p>
    </div>
  )
}

/**
 * Deja el ticket listo para imprimir y abre el diálogo de impresión.
 *
 * El ticket se dibuja en un nodo aparte, colgado directo del <body>, y al
 * imprimir se oculta todo lo demás. Así el papel trae solo el ticket y no la
 * pantalla de la caja; y como lo demás no ocupa lugar, la térmica no escupe
 * medio metro de papel en blanco.
 */
export function TicketParaImprimir({ datos, ancho, imprimir }: {
  datos: DatosTicket
  ancho: AnchoPapel
  /** Cambia de valor cada vez que hay que imprimir. 0 = no imprimir. */
  imprimir: number
}) {
  useEffect(() => {
    if (!imprimir) return
    // Sin márgenes de página: el ticket trae los suyos. La regla se agrega solo
    // mientras se imprime un ticket, para no cambiarle la hoja a nada más.
    const estilo = document.createElement('style')
    estilo.textContent = '@page { margin: 0; }'
    document.head.append(estilo)
    document.body.classList.add('imprimiendo-ticket')

    const quitar = () => {
      estilo.remove()
      document.body.classList.remove('imprimiendo-ticket')
      window.removeEventListener('afterprint', quitar)
    }
    window.addEventListener('afterprint', quitar)

    // Un cuadro de espera: que el ticket esté pintado antes de abrir el diálogo.
    const id = requestAnimationFrame(() => window.print())
    return () => { cancelAnimationFrame(id); quitar() }
  }, [imprimir])

  return createPortal(
    <div className="ticket-impresion"><Ticket datos={datos} ancho={ancho} /></div>,
    document.body,
  )
}
