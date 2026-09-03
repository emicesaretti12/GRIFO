import { useState } from 'react'
import { useAncho } from '../lib/useAncho'

export type Punto = { etiqueta: string; valor: number; detalle?: string }

/** Redondea el techo del eje a un número limpio (1.000 / 2.500 / 5.000…) para
 *  que las marcas del eje sean legibles y no valores arbitrarios. */
function techoLindo(max: number): number {
  if (max <= 0) return 1
  const exp = Math.floor(Math.log10(max))
  const base = Math.pow(10, exp)
  for (const m of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (max <= base * m) return base * m
  }
  return base * 10
}

/* ═══ Columnas — una magnitud a lo largo del tiempo ═══════════════════════ */
export function Columnas({ datos, formato, alto = 200 }: {
  datos: Punto[]
  formato: (n: number) => string
  alto?: number
}) {
  const { ref, ancho } = useAncho<HTMLDivElement>()
  const [sobre, setSobre] = useState<number | null>(null)

  const MI = 52, MD = 8, MT = 12, MB = 26          // márgenes
  const w = Math.max(ancho, 260)
  const areaW = w - MI - MD
  const areaH = alto - MT - MB

  const max = techoLindo(Math.max(...datos.map(d => d.valor), 0))
  const marcas = [0, max / 2, max]
  const banda = datos.length ? areaW / datos.length : areaW
  // Barra fina: nunca llena la banda, y como mucho 24px. El aire es del diseño.
  const bw = Math.max(3, Math.min(24, banda - Math.max(2, banda * 0.28)))
  const iMax = datos.reduce((m, d, i) => (d.valor > datos[m].valor ? i : m), 0)

  const x = (i: number) => MI + banda * i + banda / 2
  const y = (v: number) => MT + areaH - (v / max) * areaH

  return (
    <div className="grafico" ref={ref}>
      <svg height={alto} viewBox={`0 0 ${w} ${alto}`} role="img"
           aria-label={`Columnas: ${datos.length} períodos, máximo ${formato(max)}`}>
        {marcas.map((m, i) => (
          <g key={i}>
            <line className="grilla" x1={MI} x2={w - MD} y1={y(m)} y2={y(m)} />
            <text className="eje-texto" x={MI - 8} y={y(m) + 4} textAnchor="end">{formato(m)}</text>
          </g>
        ))}

        {datos.map((d, i) => {
          const h = Math.max(d.valor > 0 ? 2 : 0, areaH - (y(d.valor) - MT))
          const r = Math.min(4, bw / 2)
          return (
            <g key={i}>
              <rect x={x(i) - bw / 2} y={MT + areaH - h} width={bw} height={h}
                    rx={r} ry={r} fill="var(--serie-1)"
                    opacity={sobre === null || sobre === i ? 1 : 0.45} />
              {/* Tapa la esquina redondeada de abajo: la barra nace cuadrada en la base */}
              {h > r && (
                <rect x={x(i) - bw / 2} y={MT + areaH - r} width={bw} height={r}
                      fill="var(--serie-1)" opacity={sobre === null || sobre === i ? 1 : 0.45} />
              )}
              <rect x={MI + banda * i} y={MT} width={banda} height={areaH} fill="transparent"
                    onMouseEnter={() => setSobre(i)} onMouseLeave={() => setSobre(null)} />
            </g>
          )
        })}

        {/* Etiqueta directa SOLO en el máximo: un número sobre cada barra es ruido */}
        {datos.length > 0 && datos[iMax].valor > 0 && (
          <text className="eje-texto" x={x(iMax)} y={y(datos[iMax].valor) - 6}
                textAnchor="middle" style={{ fontWeight: 700, fill: 'var(--ink-2)' }}>
            {formato(datos[iMax].valor)}
          </text>
        )}

        <line className="linea-base" x1={MI} x2={w - MD} y1={MT + areaH} y2={MT + areaH} />

        {datos.map((d, i) => (
          (datos.length <= 10 || i % Math.ceil(datos.length / 8) === 0) && (
            <text key={i} className="eje-texto" x={x(i)} y={alto - 8} textAnchor="middle">
              {d.etiqueta}
            </text>
          )
        ))}
      </svg>

      {sobre !== null && (
        <div className="globo" style={{ left: x(sobre), top: y(datos[sobre].valor) - 10 }}>
          <div className="t">{datos[sobre].etiqueta}</div>
          <div className="v">{formato(datos[sobre].valor)}</div>
          {datos[sobre].detalle && <div className="t">{datos[sobre].detalle}</div>}
        </div>
      )}

      <TablaOculta datos={datos} formato={formato} />
    </div>
  )
}

/* ═══ Barras — ranking por categoría ══════════════════════════════════════ */
export function Barras({ datos, formato, alto = 22 }: {
  datos: Punto[]
  formato: (n: number) => string
  alto?: number
}) {
  const { ref, ancho } = useAncho<HTMLDivElement>()
  const [sobre, setSobre] = useState<number | null>(null)

  const w = Math.max(ancho, 260)
  // El margen derecho se calcula a partir del texto MÁS LARGO que va a ir ahí.
  // Si se fija a ojo, el número del valor termina montado sobre lo que venga
  // después — y una etiqueta pisada es peor que no tener etiqueta.
  const masLargo = Math.max(...datos.map(d => formato(d.valor).length), 4)
  const MD = Math.min(w * 0.42, masLargo * 7.6 + 18)
  const areaW = Math.max(40, w - MD)

  const max = Math.max(...datos.map(d => d.valor), 1)
  const paso = alto + 26
  const h = datos.length * paso

  return (
    <div className="grafico" ref={ref}>
      <svg height={h} viewBox={`0 0 ${w} ${h}`} role="img"
           aria-label={`Barras por categoría, máximo ${formato(max)}`}>
        {datos.map((d, i) => {
          const bw = Math.max(2, (d.valor / max) * areaW)
          const y = i * paso
          const r = Math.min(4, alto / 2)
          const activo = sobre === null || sobre === i
          return (
            <g key={i} onMouseEnter={() => setSobre(i)} onMouseLeave={() => setSobre(null)}>
              {/* Categoría y detalle van juntos ARRIBA de la barra: así el
                  extremo derecho queda libre solo para el valor. */}
              <text className="eje-texto" x={0} y={y + 12}
                    style={{ fill: 'var(--ink)', fontSize: 13, fontWeight: 600 }}>
                {d.etiqueta}
                {d.detalle && (
                  <tspan style={{ fill: 'var(--ink-3)', fontWeight: 400 }}>  ·  {d.detalle}</tspan>
                )}
              </text>

              <rect x={0} y={y + 18} width={bw} height={alto} rx={r} ry={r}
                    fill="var(--serie-1)" opacity={activo ? 1 : 0.45} />
              {/* Nace cuadrada del eje: la punta redondeada es solo el extremo del dato */}
              {bw > r && <rect x={0} y={y + 18} width={r} height={alto}
                               fill="var(--serie-1)" opacity={activo ? 1 : 0.45} />}

              <text className="eje-texto" x={Math.min(bw, areaW) + 10} y={y + 18 + alto / 2 + 4}
                    style={{ fill: 'var(--ink)', fontWeight: 700, fontSize: 13 }}>
                {formato(d.valor)}
              </text>
            </g>
          )
        })}
      </svg>
      <TablaOculta datos={datos} formato={formato} />
    </div>
  )
}

/** Los mismos datos como tabla, para lectores de pantalla. Que la información
 *  no dependa de poder ver un gráfico. */
function TablaOculta({ datos, formato }: { datos: Punto[]; formato: (n: number) => string }) {
  return (
    <table className="sr">
      <tbody>
        {datos.map((d, i) => (
          <tr key={i}><th scope="row">{d.etiqueta}</th><td>{formato(d.valor)}</td></tr>
        ))}
      </tbody>
    </table>
  )
}
