"""Genera docs/placa/GRIFO-placa-revA-requerimientos.pdf.

Es la fuente del PDF: cuando se confirmen los datos pendientes (sección 12),
se edita acá y se vuelve a correr `python3 docs/placa/generar_pdf.py`.
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, KeepTogether, PageBreak)
from reportlab.graphics.shapes import Drawing, Rect, Line, String, PolyLine
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.join(AQUI, "GRIFO-placa-revA-requerimientos.pdf")

F = "/usr/share/fonts/truetype/dejavu/"
pdfmetrics.registerFont(TTFont("Sans", F + "DejaVuSans.ttf"))
pdfmetrics.registerFont(TTFont("Sans-B", F + "DejaVuSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("Mono", F + "DejaVuSansMono.ttf"))
pdfmetrics.registerFont(TTFont("Mono-B", F + "DejaVuSansMono-Bold.ttf"))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily("Sans", normal="Sans", bold="Sans-B", italic="Sans", boldItalic="Sans-B")

TINTA   = colors.HexColor("#141d1a")
TINTA2  = colors.HexColor("#3d4d47")
TENUE   = colors.HexColor("#6a7b74")
LINEA   = colors.HexColor("#c9d3ce")
PANEL   = colors.HexColor("#eef2ef")
AMBAR   = colors.HexColor("#9a5c06")
AMBAR_S = colors.HexColor("#f6ecdb")
ROJO    = colors.HexColor("#a3322a")
ROJO_S  = colors.HexColor("#f7e3e1")

# ── Estilos ─────────────────────────────────────────────────────────────────
cuerpo = ParagraphStyle("cuerpo", fontName="Sans", fontSize=9.2, leading=13.2,
                        textColor=TINTA2, spaceAfter=5)
h1 = ParagraphStyle("h1", fontName="Sans-B", fontSize=13.5, leading=17,
                    textColor=TINTA, spaceBefore=14, spaceAfter=6)
h2 = ParagraphStyle("h2", fontName="Sans-B", fontSize=10.5, leading=14,
                    textColor=TINTA, spaceBefore=9, spaceAfter=3)
celda = ParagraphStyle("celda", fontName="Sans", fontSize=8.1, leading=10.6,
                       textColor=TINTA2)
celda_b = ParagraphStyle("celda_b", parent=celda, fontName="Sans-B", textColor=TINTA)
cab = ParagraphStyle("cab", fontName="Sans-B", fontSize=7.6, leading=10,
                     textColor=TINTA)
mono = ParagraphStyle("mono", parent=celda, fontName="Mono", fontSize=7.8)
vineta = ParagraphStyle("vineta", parent=cuerpo, leftIndent=11, bulletIndent=0,
                        spaceAfter=3)

def P(t, s=cuerpo): return Paragraph(t, s)
def B(t): return Paragraph(t, vineta, bulletText="•")
def N(i, t): return Paragraph(t, vineta, bulletText=f"{i}.")

def tabla(filas, anchos, cabecera=True, mono_cols=()):
    datos = []
    for i, f in enumerate(filas):
        fila = []
        for j, c in enumerate(f):
            if i == 0 and cabecera:
                fila.append(Paragraph(c, cab))
            elif j in mono_cols:
                fila.append(Paragraph(c, mono))
            else:
                fila.append(Paragraph(c, celda))
        datos.append(fila)
    t = Table(datos, colWidths=[a * mm for a in anchos], repeatRows=1 if cabecera else 0)
    estilo = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINEA),
        ("TOPPADDING", (0, 0), (-1, -1), 3.2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.6),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    if cabecera:
        estilo += [("BACKGROUND", (0, 0), (-1, 0), PANEL),
                   ("LINEBELOW", (0, 0), (-1, 0), 0.8, TINTA)]
    t.setStyle(TableStyle(estilo))
    return t

def aviso(titulo, texto, critico=False):
    fondo, barra = (ROJO_S, ROJO) if critico else (AMBAR_S, AMBAR)
    t = Table([[Paragraph(f"<b>{titulo}</b> {texto}", celda)]], colWidths=[170 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fondo),
        ("LINEBEFORE", (0, 0), (0, -1), 2.4, barra),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    return KeepTogether([Spacer(1, 3), t, Spacer(1, 6)])

# ── Diagrama de bloques ─────────────────────────────────────────────────────
def caja(d, x, y, w, h, titulo, detalle="", externo=False, fuerte=False):
    r = Rect(x, y, w, h, rx=3, ry=3,
             fillColor=colors.white if not fuerte else PANEL,
             strokeColor=TENUE if externo else TINTA,
             strokeWidth=0.7 if externo else 1.0)
    if externo:
        r.strokeDashArray = [3, 2]
    d.add(r)
    cy = y + h / 2 + (4 if detalle else -3)
    d.add(String(x + w / 2, cy, titulo, fontName="Sans-B", fontSize=7.6,
                 fillColor=TINTA, textAnchor="middle"))
    if detalle:
        for k, linea in enumerate(detalle.split("\n")):
            d.add(String(x + w / 2, cy - 10 - k * 8.5, linea, fontName="Mono",
                         fontSize=6.2, fillColor=TENUE, textAnchor="middle"))

def cable(d, pts, etiqueta=None, pos=None, color=TINTA, ancla="middle"):
    d.add(PolyLine(pts, strokeColor=color, strokeWidth=1.0))
    if etiqueta:
        x, y = pos
        d.add(String(x, y, etiqueta, fontName="Mono", fontSize=6.2,
                     fillColor=AMBAR, textAnchor=ancla))

def diagrama():
    W, H = 482, 340
    d = Drawing(W, H)
    # contorno de la placa
    placa = Rect(110, 4, 370, 318, rx=6, ry=6, fillColor=colors.HexColor("#f7f9f8"),
                 strokeColor=AMBAR, strokeWidth=1.3)
    d.add(placa)
    d.add(String(118, 311, "PLACA GRIFO · rev A", fontName="Sans-B", fontSize=7.4,
                 fillColor=AMBAR))
    d.add(String(2, 311, "EXTERNO", fontName="Sans-B", fontSize=7.0, fillColor=TENUE))

    # externos
    caja(d, 2, 262, 82, 40, "Fuente 12 V DC", "≥ 2 A", externo=True)
    caja(d, 2, 140, 82, 40, "Válvula solenoide", "12 V DC", externo=True)
    caja(d, 2, 30, 82, 40, "Caudalímetro", "3 cables", externo=True)

    # columna de la placa
    caja(d, 128, 256, 130, 50, "Protección de entrada", "F1 · D1 · D2 · C1")
    caja(d, 172, 196, 86, 40, "Regulador 5 V", "U1 conmutado")
    caja(d, 128, 128, 130, 52, "Etapa de válvula", "Q1 MOSFET · D4 diodo\nR2 pull-down")
    caja(d, 128, 20, 130, 60, "Entrada de caudal", "JP1 · R3 · R4/C5\nU3 Schmitt @3V3")

    # ESP32
    caja(d, 318, 102, 150, 190, "ESP32 NodeMCU-32S", "módulo enchufable\n(tiras hembra)", fuerte=True)
    ant = Rect(363, 290, 60, 46, fillColor=colors.white, strokeColor=ROJO, strokeWidth=0.8)
    ant.strokeDashArray = [2, 2]
    d.add(ant)
    d.add(String(393, 318, "ANTENA", fontName="Sans-B", fontSize=6.4, fillColor=ROJO,
                 textAnchor="middle"))
    d.add(String(393, 309, "sobre el borde", fontName="Mono", fontSize=5.8, fillColor=ROJO,
                 textAnchor="middle"))

    caja(d, 318, 52, 70, 30, "SW1 CONFIG", "")
    caja(d, 398, 52, 70, 30, "LED SERVICIO", "")
    caja(d, 318, 12, 150, 28, "LEDs 12V · 5V · VÁLVULA", "")

    # cables
    cable(d, [(84, 282), (128, 282)], "J1", (106, 286))
    cable(d, [(215, 256), (215, 236)], "+12 V", (219, 244), ancla="start")
    cable(d, [(258, 216), (318, 216)], "5 V (vía D3)", (288, 220))
    cable(d, [(146, 256), (146, 180)], "+12 V", (150, 214), ancla="start")
    cable(d, [(84, 160), (128, 160)], "J2", (106, 164))
    cable(d, [(318, 154), (258, 154)], "GPIO26", (288, 158))
    cable(d, [(84, 50), (128, 50)], "J3", (106, 54))
    cable(d, [(258, 50), (296, 50), (296, 124), (318, 124)], "GPIO27", (300, 128), ancla="start")
    cable(d, [(353, 82), (353, 102)], "GPIO14", (349, 89), ancla="end")
    cable(d, [(433, 102), (433, 82)], "GPIO2", (437, 89), ancla="start")
    return d

# ── Encabezado / pie ────────────────────────────────────────────────────────
def pagina(c, doc):
    c.saveState()
    c.setFont("Sans", 7.2)
    c.setFillColor(TENUE)
    c.drawString(20 * mm, 287 * mm, "GRIFO · Placa controladora de canilla · rev A")
    c.drawRightString(190 * mm, 287 * mm, "Requerimientos de diseño · borrador para revisión")
    c.setStrokeColor(LINEA); c.setLineWidth(0.5)
    c.line(20 * mm, 285 * mm, 190 * mm, 285 * mm)
    c.drawString(20 * mm, 12 * mm, "23/09/2026")
    c.drawRightString(190 * mm, 12 * mm, f"Página {doc.page}")
    c.restoreState()

def portada(c, doc):
    c.saveState()
    c.setFillColor(AMBAR)
    c.rect(20 * mm, 262 * mm, 18 * mm, 1.6 * mm, fill=1, stroke=0)
    c.setFont("Sans", 7.2); c.setFillColor(TENUE)
    c.drawString(20 * mm, 12 * mm, "23/09/2026")
    c.drawRightString(190 * mm, 12 * mm, f"Página {doc.page}")
    c.restoreState()

# ── Contenido ───────────────────────────────────────────────────────────────
h = []
titulo = ParagraphStyle("t", fontName="Sans-B", fontSize=24, leading=28, textColor=TINTA)
sub = ParagraphStyle("s", fontName="Sans", fontSize=11.5, leading=15.5, textColor=TINTA2)
meta = ParagraphStyle("m", fontName="Mono", fontSize=8, leading=12, textColor=TENUE)

h += [Spacer(1, 14 * mm),
      Paragraph("Placa controladora<br/>de canilla GRIFO", titulo), Spacer(1, 5),
      Paragraph("Requerimientos de diseño · revisión A", sub), Spacer(1, 8),
      Paragraph("Estado: BORRADOR PARA REVISIÓN — contiene datos a confirmar (sección 12)<br/>"
                "Reemplaza: protoboard + módulo relé + conversor de niveles + cableado suelto<br/>"
                "Firmware de referencia: etapa 7 (tablet con NFC), rama claude/grifo-cerveza-esp32-qndb2h",
                meta),
      Spacer(1, 9 * mm)]

h += [P("1. Objetivo", h1),
      P("Diseñar una única placa de circuito impreso que reúna todo lo que hoy está repartido en la "
        "protoboard, de forma que la instalación en la canilla sea: <b>conectar la fuente de 12 V, "
        "la válvula y el caudalímetro a sus borneras, y nada más</b>. La placa debe poder operarse y "
        "diagnosticarse en el bar sin computadora, y reemplazarse o reprogramarse sin soldar."),
      P("La lógica de venta no cambia: el corte del servicio lo sigue decidiendo el ESP32 localmente, "
        "la válvula sigue cerrada por defecto y el saldo nunca se guarda en la tarjeta. Esta placa "
        "agrega una garantía que hoy depende del firmware: <b>la válvula queda cerrada por hardware</b> "
        "mientras el ESP32 arranca, se reinicia, se reprograma o no está colocado."),

      P("2. Qué reemplaza y por qué", h1),
      tabla([
          ["Hoy en la protoboard", "En la placa rev A", "Qué se gana"],
          ["Módulo relé 12 V + canal 4 del conversor BSS138 + salida open-drain",
           "MOSFET Q1 comandado directo desde 3,3 V",
           "Sin partes móviles ni desgaste de contactos. Desaparece la trampa del riel HV "
           "que tenía que quedar vacío."],
          ["Sin diodo en la válvula: el ESP32 se reinicia al cerrarla (mitigado por software)",
           "Diodo D4 soldado junto a la bornera de la válvula",
           "Se elimina la causa del reinicio, no se mitiga."],
          ["ESP32 alimentado aparte por USB con un cargador",
           "Regulador conmutado 12 V → 5 V en la placa",
           "Una sola fuente para todo."],
          ["Caudalímetro a 3,3 V (fuera de su especificación) con pull-up interno de ≈45 kΩ",
           "Sensor a 5 V, pull-up externo 10 kΩ y buffer Schmitt a 3,3 V",
           "Señal limpia con cable largo cerca de heladeras y motores; sin conteo doble."],
          ["Un cable suelto en J51 para entrar al portal WiFi",
           "Pulsador CONFIG",
           "Operable por cualquier persona."],
          ["Buses armados con jumpers en las filas 5 y 10",
           "Planos de 3V3 y GND",
           "Sin conexiones que se aflojen."],
          ["Punta negra del tester en el hueco A33 por convención",
           "Puntos de prueba rotulados, GND tipo lazo",
           "Medición segura sin tocar borneras."],
          ["Sin indicadores",
           "LEDs 12V, 5V, VÁLVULA y SERVICIO",
           "Diagnóstico a simple vista, sin monitor serie."],
      ], [52, 50, 68]),
      ]

h += [PageBreak(),
      P("3. Diagrama de bloques", h1),
      P("La placa tiene una sola entrada de energía (12 V). Todo lo demás se deriva de ahí. "
        "Las cajas punteadas son elementos externos que se conectan por bornera."),
      Spacer(1, 4), diagrama(), Spacer(1, 6),

      P("4. Especificaciones generales", h1),
      tabla([
          ["Parámetro", "Valor", "Nota"],
          ["Alimentación", "12 V DC nominal (10,5–14 V)", "Fuente externa única. Corriente ≥ corriente de válvula + 0,5 A; 2 A mínimo."],
          ["Consumo de la lógica", "≈80 mA promedio, picos ≈500 mA en 3,3 V", "Picos por transmisión WiFi. Del lado de 12 V: &lt; 0,3 A pico."],
          ["Carga de la válvula", "hasta 2 A a 12 V DC", "<b>A confirmar</b> con la válvula real (sección 12)."],
          ["Circuito impreso", "2 capas, FR-4, 1,6 mm, cobre 1 oz (35 µm)", "Acabado HASL sin plomo o ENIG."],
          ["Tamaño", "≤ 100 × 100 mm", "Tarifa mínima de los fabricantes habituales. Contorno final según gabinete."],
          ["Montaje", "4 agujeros M3 (Ø 3,2 mm) en las esquinas, a 4 mm del borde", ""],
          ["Ambiente", "0–45 °C, humedad alta, sin condensación dentro del gabinete", "Bar: salpicaduras de cerveza, línea fría cerca."],
          ["Programación", "USB del módulo ESP32", "El módulo es enchufable: se reprograma o se reemplaza sin soldar."],
      ], [34, 58, 78]),
      ]

h += [PageBreak(),
      P("5. Asignación de pines del ESP32", h1),
      P("Es la misma asignación que usa hoy el firmware (src/comun/valvula.cpp, caudal.cpp y "
        "src/etapa7_tablet/main.cpp). Mantenerla evita tocar el código salvo lo indicado en la sección 11."),
      tabla([
          ["Pin", "Función", "Dir.", "Bloque", "Nota"],
          ["GPIO26", "Mando de la válvula", "Salida", "Etapa de válvula (Q1)", "No es pin de arranque. Pull-down 10 kΩ en la placa."],
          ["GPIO27", "Pulsos del caudalímetro", "Entrada", "Entrada de caudal (U3)", "Contador por hardware (PCNT) con filtro de glitch."],
          ["GPIO14", "Botón CONFIG (portal WiFi)", "Entrada", "SW1", "Activo en bajo. El firmware lo confirma al soltar."],
          ["GPIO2", "LED SERVICIO", "Salida", "LED4", "Pin de arranque: una carga a GND es compatible."],
          ["EN", "Reinicio", "Entrada", "SW2 (opcional)", "En paralelo con el botón EN del módulo."],
          ["5V / GND", "Alimentación del módulo", "—", "Regulador vía D3", ""],
          ["3V3", "Referencia de 3,3 V", "Salida", "U3, pull-ups, JP1", "La entrega el regulador propio del módulo."],
          ["5, 18, 23, 19, 22", "SPI del lector RFID", "—", "J4 (sin montar)", "No se usa en etapa 7. Se deja por si se vuelve al lector."],
          ["0, 12, 15", "—", "—", "—", "Pines de arranque: no conectar nada."],
          ["6 a 11", "—", "—", "—", "Memoria flash interna: no conectar nada."],
      ], [24, 36, 14, 36, 60], mono_cols=(0,)),
      ]

h += [P("6. Bloques en detalle", h1),

      P("6.1 Entrada de 12 V", h2),
      P("Bornera J1 → fusible F1 → diodo serie D1 → bus +12V. Sobre el bus: supresor D2 y capacitores C1/C2."),
      B("<b>F1</b> — fusible reseteable (PTC 1812), I<sub>hold</sub> 2 A, V<sub>máx</sub> ≥ 16 V. Protege ante un "
        "cortocircuito en la válvula o el cableado. Reseteable para no depender de un repuesto en el bar."),
      B("<b>D1</b> — Schottky SS54 (5 A, 40 V) en serie. Protege contra polaridad invertida. Cae ≈0,5 V: la válvula "
        "recibe ≈11,5 V, dentro de la tolerancia habitual de una válvula de 12 V."),
      B("<b>D2</b> — TVS SMBJ15A entre +12V y GND. Absorbe picos de la red y de la fuente."),
      B("<b>C1</b> 470 µF / 25 V electrolítico + <b>C2</b> 100 nF / 50 V cerámico. Reserva para el arranque de la "
        "válvula y los picos del WiFi."),
      B("<b>LED1</b> verde \"12V\" con R8 4,7 kΩ."),

      P("6.2 Regulación a 5 V", h2),
      B("<b>U1</b> — regulador conmutado de 3 pines, compatible en patas con un 7805: Traco TSR 1-2450 o "
        "Recom R-78E5.0-1.0 (1 A). Capacitores de entrada y salida según su hoja de datos."),
      B("<b>No usar un regulador lineal 7805</b>: bajar de 12 a 5 V a ≈250 mA disipa ≈1,75 W de calor dentro de un "
        "gabinete cerrado."),
      B("<b>D3</b> — Schottky SS34 entre la salida de U1 y el pin 5V del módulo. Impide que el USB alimente al "
        "regulador al revés cuando se programa. El módulo recibe ≈4,6 V, que es la misma condición en la que "
        "funciona cuando se alimenta por su propio USB."),
      B("<b>LED2</b> verde \"5V\" con R9 1 kΩ, a la salida de U1."),

      P("6.3 Módulo ESP32", h2),
      B("<b>U2</b> — NodeMCU-32S (ESP32, 38 pines), el mismo módulo que se usa hoy, montado sobre dos tiras hembra "
        "1×19 de 2,54 mm. No se suelda: se puede sacar para reprogramarlo o reemplazarlo."),
      B("<b>Medir la separación entre filas del módulo real</b> antes de dibujar la huella: estos módulos se venden "
        "en dos anchos (22,86 mm y 25,4 mm)."),
      B("<b>Antena</b>: debe sobresalir del borde de la placa, o tener debajo y alrededor (≈15 mm) una zona sin cobre "
        "en ninguna capa y sin componentes. Es la prioridad sobre la ubicación del conector USB, que puede quedar "
        "accesible con la tapa del gabinete abierta."),
      ]

h += [P("6.4 Etapa de la válvula", h2),
      P("Interruptor del lado de masa (low-side). La válvula va entre +12V y el drenador de Q1."),
      tabla([
          ["Ref.", "Componente", "Conexión"],
          ["Q1", "MOSFET canal N de nivel lógico AO3400A (SOT-23, 30 V, 5,7 A). "
                 "Alternativa para soldar a mano: IRLB8721PbF (TO-220).",
           "Drenador → J2 (−) · Fuente → GND · Compuerta → R1"],
          ["R1", "100 Ω", "GPIO26 → compuerta de Q1"],
          ["R2", "10 kΩ", "Compuerta de Q1 → GND"],
          ["D4", "1N4007 (THT) o S1M (SMD), ≥ 1 A", "Cátodo → +12V (J2 +) · Ánodo → J2 (−)"],
          ["LED3", "Ámbar \"VÁLVULA\" + R6 4,7 kΩ", "En paralelo con la válvula: enciende cuando la placa la está alimentando"],
          ["J2", "Bornera 2 polos, 5,08 mm", "1: +12V · 2: VÁLVULA (−)"],
      ], [14, 80, 76]),
      aviso("CRÍTICO —", "R2 es la garantía de seguridad por hardware: mientras el ESP32 arranca, se reinicia, se "
            "reprograma o no está colocado, GPIO26 queda en alta impedancia y R2 mantiene la válvula cerrada. "
            "D4 es obligatorio y va físicamente pegado a J2: sin él, el pico de tensión al cerrar la válvula "
            "reinicia el ESP32 (es el problema que hoy se mitiga por software).", critico=True),
      P("El LED3 separa dos fallas que hoy se confunden: si el LED enciende y la cerveza no sale, el problema es "
        "mecánico o de presión en la válvula; si el LED no enciende, es de la placa o del firmware."),

      P("6.5 Entrada del caudalímetro", h2),
      P("El sensor se alimenta dentro de su especificación y su señal se limpia y se adapta a 3,3 V antes de "
        "llegar al ESP32, sin depender de cómo esté construida la salida del sensor por dentro."),
      tabla([
          ["Ref.", "Componente", "Conexión"],
          ["J3", "Bornera 3 polos, 3,81 o 5,08 mm (enchufable preferentemente)",
           "1: V+ (ROJO) → VSENSOR · 2: GND (NEGRO) · 3: SEÑAL (AMARILLO)"],
          ["JP1", "Puente de soldadura de 3 pads",
           "Elige VSENSOR: pads 1-2 = 5 V (por defecto) · pads 2-3 = 3V3 (configuración probada en protoboard)"],
          ["C8", "100 nF", "VSENSOR → GND, junto a J3"],
          ["R3", "10 kΩ", "SEÑAL → VSENSOR (pull-up externo)"],
          ["D5", "Protección ESD 5 V (p. ej. PESD5V0S1BA)", "SEÑAL → GND, pegado a J3"],
          ["R4 + C5", "1 kΩ serie + 10 nF a GND",
           "Filtro pasabajos, corte ≈ 16 kHz: más de 10 veces la frecuencia máxima esperable del sensor"],
          ["U3", "74LVC1G17 (buffer Schmitt, SOT-23-5), alimentado a 3V3",
           "Entrada: salida del filtro (tolera hasta 5,5 V) · Salida → GPIO27"],
          ["C6", "100 nF", "Desacople de U3, a menos de 3 mm"],
      ], [16, 66, 88]),
      P("El disparador Schmitt evita que un flanco lento o con ruido se cuente dos veces. La entrada de U3 tolera "
        "5 V aunque U3 esté alimentado a 3,3 V: por eso el sensor puede volver a 5 V sin arriesgar el ESP32."),

      P("6.6 Botón, LEDs y opcionales", h2),
      B("<b>SW1 CONFIG</b> — pulsador táctil 6×6 mm entre GPIO14 y GND, con R5 10 kΩ a 3V3 y C7 100 nF a GND. Para "
        "entrar al portal WiFi: mantenerlo apretado al encender, soltar después de 3 s. Accesible pero hundido, "
        "para que un cliente no lo active por accidente."),
      B("<b>LED4 SERVICIO</b> — verde o ámbar, con R7 470 Ω desde GPIO2 a GND. Enciende con la canilla habilitada o "
        "sirviendo y parpadea en el portal. <b>No usar azul</b>: su tensión directa (≈3 V) no deja margen a 3,3 V."),
      B("<b>SW2 RESET</b> (opcional) — pulsador entre EN y GND, en paralelo con el del módulo, para reiniciar con el "
        "gabinete cerrado."),
      B("<b>J4</b> (sin montar) — tira 1×8 de 2,54 mm con el orden del módulo MFRC522: SDA (GPIO5), SCK (18), MOSI (23), "
        "MISO (19), IRQ (sin conexión), GND, RST (22), 3,3 V. Verificar contra el módulo antes de fabricar. "
        "<b>El lector va siempre a 3,3 V: a 5 V se quema.</b>"),

      P("6.7 Puntos de prueba", h2),
      tabla([
          ["TP", "Señal", "Valor esperado"],
          ["TP1", "+12V (después de D1)", "≈ 11,5 V"],
          ["TP2", "Salida de U1 (antes de D3)", "5,0 V ± 0,1"],
          ["TP3", "3V3", "3,3 V ± 0,1"],
          ["TP4, TP5", "GND (tipo lazo, para enganchar la punta negra)", "0 V"],
          ["TP6", "GPIO26 / mando de válvula", "0 V cerrada · 3,3 V abierta"],
          ["TP7", "Salida de U3 / GPIO27", "Pulsos 0–3,3 V con el sensor girando"],
      ], [22, 88, 60], mono_cols=(0,)),
      ]

h += [P("7. Borneras y serigrafía", h1),
      B("Todas las borneras sobre <b>un mismo borde</b> de la placa, para cablear prolijo hacia los prensacables del gabinete."),
      B("Rotular cada borne. En J1 y J2: \"+\" y \"−\". En J3: <b>ROJO · NEGRO · AMARILLO</b>, además de V+ · GND · SEÑAL. "
        "La placa tiene que decir dónde va cada cable sin consultar este documento."),
      B("Referencia de cada componente, marca de pin 1, dirección de los diodos, nombre de cada LED y de cada TP."),
      B("Texto \"GRIFO rev A — 2026-09\" y una flecha que indique el lado del conector USB."),

      P("8. Reglas de diseño del circuito impreso", h1),
      N(1, "<b>Lazo de potencia de la válvula</b> (J2 → D4 → Q1 → retorno a C1/J1) lo más corto y ancho posible. D4 a menos de 10 mm de J2."),
      N(2, "<b>Ancho de pistas</b>: +12V y válvula ≥ 1,5 mm con cobre de 1 oz. Señales 0,25–0,3 mm."),
      N(3, "<b>Masa</b>: plano continuo en la capa inferior. La corriente de retorno de la válvula vuelve al plano cerca de "
           "J1/C1, sin pasar por debajo del ESP32 ni de U3."),
      N(4, "<b>Antena</b>: ver 6.3. Nada metálico cerca (borneras, electrolíticos, el regulador)."),
      N(5, "<b>Filtrar en el borde</b>: D5, R3, R4, C5 y U3 cerca de J3, donde entra el ruido del cable largo."),
      N(6, "<b>Regulador</b>: respetar la huella, los capacitores y las distancias de su hoja de datos; lejos de la antena."),
      N(7, "Agujeros de montaje sin conexión (gabinete plástico). Dejar 3 mm libres de cobre alrededor."),

      P("9. Gabinete e instalación", h1),
      B("<b>Plástico (ABS o policarbonato), nunca metálico</b>: un gabinete de metal bloquea el WiFi."),
      B("IP54 o superior. Un prensacables (PG7 o PG9) por cable."),
      B("Montado <b>por encima</b> de la línea de cerveza fría: la condensación gotea hacia abajo."),
      B("Los LEDs visibles desde afuera (ventana o guías de luz), y el pulsador CONFIG accesible con herramienta o hundido."),
      B("Opcional: barniz protector sobre la placa, excepto tiras hembra, borneras y pulsadores."),
      ]

bom = [
    ["Ref.", "Cant.", "Componente", "Valor / modelo", "Encapsulado"],
    ["U1", "1", "Regulador conmutado 5 V 1 A", "Traco TSR 1-2450 o Recom R-78E5.0-1.0", "SIP-3"],
    ["U2", "1", "Módulo ESP32", "NodeMCU-32S 38 pines (el actual)", "2 × tira hembra 1×19"],
    ["U3", "1", "Buffer Schmitt", "74LVC1G17", "SOT-23-5"],
    ["Q1", "1", "MOSFET N nivel lógico", "AO3400A (alt. IRLB8721PbF)", "SOT-23 (alt. TO-220)"],
    ["D1", "1", "Schottky", "SS54, 5 A 40 V", "SMC"],
    ["D2", "1", "TVS", "SMBJ15A", "SMB"],
    ["D3", "1", "Schottky", "SS34, 3 A 40 V", "SMA"],
    ["D4", "1", "Diodo de rueda libre", "1N4007 o S1M", "DO-41 o SMA"],
    ["D5", "1", "Protección ESD", "PESD5V0S1BA o equivalente", "SOD-323"],
    ["F1", "1", "Fusible reseteable", "PTC, I<sub>hold</sub> 2 A, ≥ 16 V", "1812"],
    ["C1", "1", "Electrolítico", "470 µF 25 V", "Radial"],
    ["C2", "1", "Cerámico X7R", "100 nF 50 V", "0805"],
    ["C3, C4", "2", "Capacitores de U1", "según hoja de datos (típ. 10 µF 25 V / 22 µF 10 V)", "0805 / 1206"],
    ["C5", "1", "Cerámico", "10 nF", "0805"],
    ["C6, C7, C8", "3", "Cerámico X7R", "100 nF", "0805"],
    ["R1", "1", "Resistencia", "100 Ω", "0805"],
    ["R2, R3, R5", "3", "Resistencia", "10 kΩ", "0805"],
    ["R4, R9", "2", "Resistencia", "1 kΩ", "0805"],
    ["R6, R8", "2", "Resistencia", "4,7 kΩ", "0805"],
    ["R7", "1", "Resistencia", "470 Ω", "0805"],
    ["LED1, LED2", "2", "LED verde", "12V, 5V", "0805 o 3 mm"],
    ["LED3", "1", "LED ámbar", "VÁLVULA", "0805 o 3 mm"],
    ["LED4", "1", "LED verde o ámbar", "SERVICIO (no azul)", "0805 o 3 mm"],
    ["SW1", "1", "Pulsador táctil", "CONFIG", "6×6 mm THT"],
    ["SW2", "1", "Pulsador táctil (opcional)", "RESET", "6×6 mm THT"],
    ["JP1", "1", "Puente de soldadura", "3 pads, cerrado 1-2", "—"],
    ["J1, J2", "2", "Bornera a tornillo", "2 polos", "5,08 mm"],
    ["J3", "1", "Bornera a tornillo", "3 polos, enchufable preferentemente", "3,81 o 5,08 mm"],
    ["J4", "1", "Tira macho (sin montar)", "1×8", "2,54 mm"],
    ["TP1–TP7", "7", "Punto de prueba", "TP4 y TP5 tipo lazo", "—"],
    ["H1–H4", "4", "Agujero de montaje", "M3, Ø 3,2 mm", "—"],
]

h += [PageBreak(), P("10. Lista de materiales", h1),
      P("Los modelos son de referencia y de disponibilidad amplia. Se aceptan equivalentes con iguales o mejores valores nominales."),
      tabla(bom, [20, 10, 42, 60, 38], mono_cols=(0,)),
      ]

h += [P("11. Cambio de firmware necesario", h1),
      P("El mando de la válvula cambia de polaridad. El relé se activaba llevando el pin a masa; el MOSFET se activa "
        "llevándolo a 3,3 V."),
      tabla([
          ["", "Protoboard (hoy)", "Placa rev A"],
          ["Pin", "GPIO26", "GPIO26"],
          ["Modo", "OUTPUT_OPEN_DRAIN", "OUTPUT"],
          ["Abrir válvula", "LOW", "HIGH"],
          ["Cerrar válvula", "HIGH (pin liberado)", "LOW"],
          ["Sin firmware corriendo", "Alta impedancia → cerrada", "Alta impedancia + R2 → cerrada"],
          ["Caudalímetro", "caudalIniciar(true): pull-up interno", "caudalIniciar(false): pull-up externo R3 y buffer U3"],
      ], [40, 62, 68], mono_cols=(1, 2)),
      aviso("Importante —", "con el firmware actual, esta placa <b>nunca abre la válvula</b>: en modo open-drain el pin "
            "solo puede ir a masa o soltarse, y R2 mantiene la compuerta en bajo en los dos casos. La falla es segura, "
            "pero la placa no sirve hasta cargar el firmware con el cambio. Se recomienda que el cambio sea una opción "
            "de compilación (por ejemplo, un entorno de PlatformIO propio para la placa), para que la protoboard siga "
            "funcionando con el firmware actual."),
      aviso("Calibración —", "el valor de pulsos por litro medido en la protoboard <b>no se traslada</b> a la placa: "
            "cambian la alimentación del sensor, el pull-up y el filtrado. Hay que volver a calibrar con la placa definitiva."),
      ]

h += [PageBreak(), P("12. Datos a confirmar antes de fabricar", h1),
      P("Ninguno de estos puntos se puede resolver en el escritorio: requieren medir o leer las piezas reales."),
      tabla([
          ["#", "Dato", "Cómo obtenerlo", "Qué define"],
          ["1", "Corriente de la válvula y que sea de 12 V DC (no alterna)",
           "Leer la etiqueta (W ÷ 12 V) o medir con el tester en serie con la válvula abierta",
           "F1, D1, ancho de pistas, Q1. Si es de alterna, esta etapa no sirve y hace falta un relé."],
          ["2", "Modelo del caudalímetro y su rango de alimentación",
           "Etiqueta del sensor u hoja de datos del vendedor",
           "Posición por defecto de JP1"],
          ["3", "Si el conteo actual es real o incluye ruido",
           "Servir la misma cantidad medida tres veces y comparar los pulsos. Si varían más de 5 %, hay ruido. "
           "Con el sensor quieto 5 minutos, el conteo no debe moverse",
           "Confianza en la calibración (hoy 12 820 pulsos/L, unas 28 veces el valor típico de un YF-S201)"],
          ["4", "Separación entre filas de pines del módulo ESP32",
           "Calibre sobre el módulo real",
           "Huella de las tiras hembra"],
          ["5", "Corriente nominal de la fuente de 12 V",
           "Etiqueta de la fuente",
           "Debe cubrir válvula + 0,5 A"],
          ["6", "Gabinete: modelo y medidas interiores",
           "Elegir el gabinete primero",
           "Contorno de la placa, agujeros de montaje, ubicación de borneras y LEDs"],
      ], [7, 44, 64, 55]),

      P("13. Plan de pruebas de la placa", h1),
      P("Una prueba por vez. No se avanza a la siguiente hasta que la anterior pasa."),
      tabla([
          ["Prueba", "Condiciones", "Resultado esperado"],
          ["1. En frío", "Sin alimentación, sin módulo, tester en continuidad",
           "Sin continuidad entre +12V, 5V, 3V3 y GND"],
          ["2. Alimentación", "12 V conectados, <b>sin el módulo ESP32</b>",
           "LED 12V y LED 5V encendidos. TP2 = 5,0 V. LED VÁLVULA apagado (R2 la mantiene cerrada sin ESP32)"],
          ["3. Mando", "Con el módulo y el firmware nuevo, sin válvula",
           "Arranque normal. Al habilitar: TP6 = 3,3 V y LED VÁLVULA encendido. Al cerrar: 0 V y apagado"],
          ["4. Válvula", "Con la válvula conectada",
           "50 ciclos de abrir y cerrar <b>sin ningún reinicio</b> del ESP32. Es la prueba del diodo D4"],
          ["5. Caudal", "Con el caudalímetro conectado",
           "Quieto 5 minutos: 0 pulsos. Soplando: cuenta. Recalibrar con 1 litro medido"],
          ["6. Sistema completo", "Gabinete cerrado, en la canilla",
           "Pruebas de docs/etapa-07-tablet.md. Señal WiFi aceptable (en la app, mejor que −70 dBm) con la tapa puesta"],
      ], [30, 56, 84]),

      P("14. Fuera de alcance de la rev A", h1),
      P("<b>Rev B</b>: soldar el módulo ESP32-WROOM-32E directamente y agregar el conversor USB-serie en la placa. "
        "Resulta más chica y más barata en cantidad, pero exige diseño de radiofrecuencia y del circuito de "
        "programación. Tiene sentido cuando la rev A esté validada en el bar."),
      ]

doc = BaseDocTemplate(SALIDA, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                      topMargin=22 * mm, bottomMargin=20 * mm,
                      title="GRIFO — Placa controladora rev A — Requerimientos",
                      author="Proyecto GRIFO", subject="Requerimientos de diseño de PCB")
marco = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
doc.addPageTemplates([PageTemplate(id="portada", frames=[marco], onPage=portada),
                      PageTemplate(id="resto", frames=[marco], onPage=pagina)])
from reportlab.platypus import NextPageTemplate
h.insert(0, NextPageTemplate("resto"))
doc.build(h)
print("OK", SALIDA)
