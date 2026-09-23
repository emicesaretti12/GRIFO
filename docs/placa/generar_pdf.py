"""Genera docs/placa/GRIFO-HW-001-especificacion-PCB-revA.pdf.

Es la fuente del PDF: se edita acá y se vuelve a correr
`python3 docs/placa/generar_pdf.py`.
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
SALIDA = os.path.join(AQUI, "GRIFO-HW-001-especificacion-PCB-revA.pdf")

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
                    textColor=TINTA, spaceBefore=14, spaceAfter=6, keepWithNext=1)
h2 = ParagraphStyle("h2", fontName="Sans-B", fontSize=10.5, leading=14,
                    textColor=TINTA, spaceBefore=9, spaceAfter=3, keepWithNext=1)
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
    lineas = detalle.split("\n") if detalle else []
    cy = y + h / 2 + (4 * len(lineas)) - 3
    d.add(String(x + w / 2, cy, titulo, fontName="Sans-B", fontSize=7.6,
                 fillColor=TINTA, textAnchor="middle"))
    for k, linea in enumerate(lineas):
        d.add(String(x + w / 2, cy - 10 - k * 8.5, linea, fontName="Mono",
                     fontSize=6.2, fillColor=TENUE, textAnchor="middle"))

def cable(d, pts, etiqueta=None, pos=None, ancla="middle"):
    d.add(PolyLine(pts, strokeColor=TINTA, strokeWidth=1.0))
    if etiqueta:
        x, y = pos
        d.add(String(x, y, etiqueta, fontName="Mono", fontSize=6.2,
                     fillColor=AMBAR, textAnchor=ancla))

def diagrama():
    d = Drawing(482, 342)
    d.add(Rect(110, 4, 370, 318, rx=6, ry=6, fillColor=colors.HexColor("#f7f9f8"),
               strokeColor=AMBAR, strokeWidth=1.3))
    d.add(String(118, 311, "PLACA GRIFO · rev A", fontName="Sans-B", fontSize=7.4,
                 fillColor=AMBAR))
    d.add(String(2, 311, "EXTERNO", fontName="Sans-B", fontSize=7.0, fillColor=TENUE))

    caja(d, 2, 266, 82, 40, "Adaptador 12 V", "cable desnudo", externo=True)
    caja(d, 2, 195, 82, 40, "Válvula solenoide", "12 V DC", externo=True)
    caja(d, 2, 110, 82, 40, "Cargador 5 V", "micro-USB", externo=True)
    caja(d, 2, 26, 82, 40, "Caudalímetro", "3 cables", externo=True)

    caja(d, 128, 262, 130, 46, "Entrada 12 V", "F1 · D1 · D2 · C1")
    caja(d, 128, 186, 130, 56, "Etapa de válvula", "Q1 MOSFET · D4 diodo\nR2 pull-down")
    caja(d, 128, 104, 130, 52, "Entrada 5 V", "F2 · D6 · D3 · C3/C4")
    caja(d, 128, 18, 130, 58, "Entrada de caudal", "JP1 · R3 · R4/C5\nU2 Schmitt @3V3")

    caja(d, 318, 96, 150, 196, "ESP32 NodeMCU-32S", "U1 · enchufable\n(tiras hembra)", fuerte=True)
    ant = Rect(363, 290, 60, 46, fillColor=colors.white, strokeColor=ROJO, strokeWidth=0.8)
    ant.strokeDashArray = [2, 2]
    d.add(ant)
    d.add(String(393, 318, "ANTENA", fontName="Sans-B", fontSize=6.4, fillColor=ROJO,
                 textAnchor="middle"))
    d.add(String(393, 309, "sobre el borde", fontName="Mono", fontSize=5.8, fillColor=ROJO,
                 textAnchor="middle"))

    caja(d, 318, 50, 70, 28, "SW1 CONFIG")
    caja(d, 398, 50, 70, 28, "LED SERVICIO")
    caja(d, 318, 12, 150, 26, "LEDs 12V · 5V · VÁLVULA")

    cable(d, [(84, 286), (128, 286)], "J1", (96, 290))
    cable(d, [(84, 215), (128, 215)], "J3", (96, 219))
    cable(d, [(84, 130), (128, 130)], "J2", (96, 134))
    cable(d, [(84, 46), (128, 46)], "J4", (96, 50))

    cable(d, [(193, 262), (193, 242)], "+12 V", (197, 249), ancla="start")
    cable(d, [(258, 284), (318, 284)], "12 V → GPIO36", (288, 288))
    cable(d, [(318, 215), (258, 215)], "GPIO26", (288, 219))
    cable(d, [(258, 130), (318, 130)], "5 V (vía D3)", (288, 134))
    cable(d, [(193, 104), (193, 76)], "5 V → VSENSOR", (197, 87), ancla="start")
    cable(d, [(258, 46), (296, 46), (296, 110), (318, 110)], "GPIO27", (292, 100), ancla="end")
    cable(d, [(353, 78), (353, 96)], "GPIO14", (349, 84), ancla="end")
    cable(d, [(433, 96), (433, 78)], "GPIO2", (437, 84), ancla="start")
    return d

# ── Encabezado / pie ────────────────────────────────────────────────────────
DOC, REV, FECHA = "GRIFO-HW-001", "Rev A", "23/09/2026"

def pagina(c, doc):
    c.saveState()
    c.setFont("Sans", 7.2); c.setFillColor(TENUE)
    c.drawString(20 * mm, 287 * mm, f"{DOC} · Especificación técnica · PCB controladora de canilla")
    c.drawRightString(190 * mm, 287 * mm, REV)
    c.setStrokeColor(LINEA); c.setLineWidth(0.5)
    c.line(20 * mm, 285 * mm, 190 * mm, 285 * mm)
    c.drawString(20 * mm, 12 * mm, FECHA)
    c.drawRightString(190 * mm, 12 * mm, f"Página {doc.page} de {{PAGINAS}}".replace("{PAGINAS}", str(TOTAL[0] or "")))
    c.restoreState()

TOTAL = [None]

def tabla_ficha(filas, anchos):
    t = Table([[Paragraph(f"<b>{a}</b>", celda)] + [Paragraph(x, celda) for x in resto]
               for a, *resto in filas], colWidths=[a * mm for a in anchos])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, LINEA),
        ("LINEABOVE", (0, 0), (-1, 0), 0.8, TINTA),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3.2), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.6),
    ]))
    return t

estilo_req = ParagraphStyle("req", parent=vineta, leftIndent=20)

def req(codigo, texto):
    return Paragraph(texto, estilo_req, bulletText=codigo)

# ── Contenido ───────────────────────────────────────────────────────────────
def contenido():
    h = []
    titulo = ParagraphStyle("t", fontName="Sans-B", fontSize=18, leading=22, textColor=TINTA)
    meta = ParagraphStyle("m", fontName="Mono", fontSize=7.8, leading=11.5, textColor=TENUE)
    h += [Paragraph("PCB controladora de canilla GRIFO", titulo), Spacer(1, 3),
          Paragraph(f"Especificación técnica · Documento {DOC} · {REV} · {FECHA}", meta),
          Spacer(1, 4)]

    h += [P("1. Alcance", h1),
          P("Placa controladora para un dispensador de cerveza autoservicio de una canilla. Integra: zócalo para módulo "
            "ESP32 NodeMCU-32S, driver low-side para electroválvula de 12 V DC, acondicionamiento de señal de un "
            "caudalímetro de efecto Hall, dos entradas de alimentación independientes (12 V y 5 V) y una HMI mínima. "
            "Reemplaza un montaje en protoboard con módulo relé y conversor de niveles, ya validado en campo."),

          P("2. Características generales", h1),
          tabla_ficha([
              ["Entrada 12 V", "12 V DC ± 5 %, adaptador externo aislado, cable desnudo a bornera. Alimenta exclusivamente la electroválvula."],
              ["Entrada 5 V", "5 V DC (USB), cargador externo aislado con cable fijo micro-USB. Alimenta la lógica."],
              ["Masas", "Comunes en placa, unidas en un único punto junto a J1."],
              ["Consumo 5 V", "100 mA típico, 500 mA pico (transmisión WiFi)."],
              ["Carga", "Electroválvula 12 V DC, inductiva, ≤ 2 A (valor de diseño)."],
              ["Entrada de señal", "Caudalímetro Hall de colector abierto, 3 hilos, cable ≤ 3 m, f<sub>máx</sub> 1,5 kHz."],
              ["Tensión máxima en placa", "12 V (muy baja tensión de seguridad). Sin tensión de red en la placa."],
              ["Controlador", "NodeMCU ESP-32S v1.1 (ESP32-D0WD-V3, 38 pines, CP2102, micro-USB), enchufable."],
              ["PCB", "2 capas, FR-4 1,6 mm, cobre 1 oz, ≤ 100 × 100 mm, 4 agujeros M3."],
              ["Ambiente", "0–45 °C, humedad alta sin condensación. Gabinete plástico IP54."],
          ], [38, 132]),

          P("3. Requisitos funcionales y de seguridad", h1),
          req("R1", "La electroválvula permanece desenergizada con GPIO26 en alta impedancia: arranque, reset, programación, "
                    "módulo retirado o entrada de 5 V ausente."),
          req("R2", "Ninguna secuencia de conexión o desconexión de las dos entradas energiza la válvula sin comando."),
          req("R3", "Supresión de la sobretensión inductiva en placa. La conmutación de la válvula no provoca reset del ESP32."),
          req("R4", "Entrada 12 V: protección contra inversión de polaridad, sobrecorriente y transitorios. Entrada 5 V: "
                    "protección contra sobrecorriente y sobretensión."),
          req("R5", "Entradas no intercambiables mecánicamente: 12 V solo por bornera, 5 V solo por micro-USB."),
          req("R6", "Programación por el micro-USB del módulo sin retroalimentar la entrada de 5 V."),
          req("R7", "Detección de presencia de 12 V por ADC del ESP32."),
          req("R8", "Señal de caudal con histéresis, entrada tolerante a 5 V, salida a 3,3 V hacia el GPIO."),
          req("R9", "Indicación visual de 12 V, 5 V, válvula energizada y estado de servicio."),

          KeepTogether([P("4. Diagrama de bloques", h1), Spacer(1, 2), diagrama()]),
          ]

    h += [P("5. Asignación de E/S del módulo", h1),
          P("Posiciones contadas desde el extremo del conector USB (1) hacia la antena (19). Fila A: 5V … 3V3; fila B: CLK … GND. "
            "Los rótulos están en la cara inferior del módulo: la vista desde el lado componentes es especular. "
            "Separación entre filas: 22,86 mm; verificar con la muestra."),
          tabla([
              ["Señal", "GPIO", "Pos.", "Tipo", "Notas"],
              ["VALVE_EN", "26", "A10", "Salida", "Activo alto. R2 10 kΩ a GND en la compuerta."],
              ["FLOW", "27", "A9", "Entrada", "Contador PCNT con filtro de glitch."],
              ["SENSE12", "36", "A17", "ADC1_CH0", "Solo entrada, sin pull interno."],
              ["CFG", "14", "A8", "Entrada", "Activo bajo. Se lee durante el arranque."],
              ["LED_SRV", "2", "B5", "Salida", "Pin de arranque; carga a GND admitida."],
              ["RESET", "EN", "A18", "Entrada", "En paralelo con el pulsador del módulo."],
              ["+5V_ESP", "5V", "A1", "Alim.", "Desde D3."],
              ["+3V3", "3V3", "A19", "Alim.", "Salida del LDO del módulo. Carga externa < 20 mA."],
              ["GND", "GND", "B13, B19", "Alim.", "Todos los GND del módulo a masa."],
              ["SPI (J5, sin montar)", "5, 18, 19, 22, 23", "B10, B11, B12, B17, B18", "—", "SDA, SCK, MISO, RST, MOSI."],
              ["Sin conexión", "0, 12, 15, 6–11", "—", "—", "Pines de arranque y de flash."],
          ], [30, 24, 26, 20, 70], mono_cols=(1, 2)),

          P("6. Notas de diseño por bloque", h1),
          P("<b>Entrada 12 V.</b> J1 → F1 (PTC, I<sub>hold</sub> 2 A) → D1 (Schottky serie 5 A / 40 V) → +12V. D2 TVS SMBJ15A; "
            "C1 470 µF / 25 V, C2 100 nF. Tensión en la válvula ≈ 11,4 V a plena carga."),
          P("<b>Entrada 5 V.</b> J2 micro-USB B con anclajes THT; solo VBUS y GND (D+, D− e ID sin conexión: un cargador "
            "de carga rápida no puede negociar más de 5 V). → F2 (PTC, I<sub>hold</sub> 1,1 A) → D6 TVS SMAJ5.0A → +5V_IN → "
            "D3 SS34 → +5V_ESP, con C4 100 µF junto al pin 5V del módulo. D3 cumple R6."),
          P("<b>Driver de válvula.</b> Q1 MOSFET N de nivel lógico (ref. AO3400A; R<sub>DS(on)</sub> ≤ 50 mΩ a V<sub>GS</sub> "
            "2,5 V), R1 100 Ω serie, R2 10 kΩ G–S (R1). D4 de rueda libre ≥ 1 A a menos de 10 mm de J3 (R3). LED3 + R6 en "
            "paralelo con la carga. P<sub>Q1</sub> ≈ 0,16 W a 2 A."),
          P("<b>Caudal.</b> VSENSOR por JP1: +5V_IN (por defecto) o 3V3. Pull-up R3 10 kΩ a VSENSOR, ESD D5, filtro "
            "R4 1 kΩ / C5 4,7 nF (τ de bajada 4,7 µs; cruce de umbral en subida ≈ 26 µs; f<sub>c</sub> ≈ 34 kHz), "
            "U2 74LVC1G17 alimentado a 3V3 (R8)."),
          P("<b>SENSE12.</b> R11 100 kΩ / R12 22 kΩ, C9 100 nF: 2,06 V con 11,4 V y ≤ 2,5 V con 14 V (ADC1, 11 dB). "
            "Inyección < 0,1 mA con el módulo sin alimentar."),
          P("<b>HMI.</b> SW1 CFG en GPIO14: pull-up R5 10 kΩ, C7 100 nF, R10 1 kΩ en serie con el pulsador (limita la "
            "corriente si el pin conmuta durante el arranque). SW2 RESET en EN (opcional). LED1 12V, LED2 5V, LED3 VÁLVULA, "
            "LED4 SERVICIO en GPIO2 con R7 470 Ω (V<sub>F</sub> ≤ 2,2 V: no azul)."),
          P("<b>J5 (sin montar).</b> 1×8, 2,54 mm, orden MFRC522: SDA, SCK, MOSI, MISO, IRQ (NC), GND, RST, 3V3."),
          ]

    redes = [
        ["Red", "Conecta"],
        ["VIN12", "J1.1 (+), F1.1"],
        ["VIN12_F", "F1.2, D1 A"],
        ["+12V", "D1 K, D2 K, C1 +, C2, R8.1, R6.1, R11.1, D4 K, J3.1, TP1"],
        ["VBUS", "J2 VBUS, F2.1"],
        ["+5V_IN", "F2.2, D6 K, C3, R9.1, D3 A, JP1.1, TP2"],
        ["+5V_ESP", "D3 K, C4 +, U1 5V"],
        ["+3V3", "U1 3V3, U2.5, C6, R5.1, JP1.3, J5.8, TP3"],
        ["VSENSOR", "JP1.2, J4.1, R3.1, C8"],
        ["GATE_DRV", "U1 GPIO26, R1.1, TP6"],
        ["GATE", "R1.2, Q1 G, R2.1"],
        ["VALV_NEG", "J3.2, Q1 D, D4 A, LED3 K"],
        ["FLOW_RAW", "J4.3, R3.2, D5 K, R4.1"],
        ["FLOW_RC", "R4.2, C5, U2.2 (A)"],
        ["FLOW", "U2.4 (Y), U1 GPIO27, TP7"],
        ["SENSE12", "R11.2, R12.1, C9, U1 GPIO36, TP8"],
        ["CFG", "U1 GPIO14, R5.2, C7, R10.1"],
        ["CFG_SW", "R10.2, SW1"],
        ["SRV", "U1 GPIO2, R7.1"],
        ["EN", "U1 EN, SW2"],
        ["LED_x", "R8.2–LED1 A · R9.2–LED2 A · R6.2–LED3 A · R7.2–LED4 A"],
        ["SPI (NM)", "J5.1–GPIO5 · J5.2–GPIO18 · J5.3–GPIO23 · J5.4–GPIO19 · J5.7–GPIO22 · J5.5 NC"],
        ["GND", "J1.2 (−), J2 GND y carcasa, D2 A, D5 A, D6 A, C1 −, C2, C3, C4 −, C5–C9, Q1 S, R2.2, R12.2, U1 GND, "
                "U2.3, J4.2, J5.6, SW1, SW2, LED1/LED2/LED4 K, TP4, TP5"],
    ]
    h += [P("7. Lista de conexiones", h1),
          tabla(redes, [26, 144], mono_cols=(0, 1))]

    bom = [
        ["Ref.", "Cant.", "Descripción", "Valor / referencia", "Encapsulado"],
        ["U1", "1", "Módulo ESP32", "NodeMCU ESP-32S v1.1, 38 pines", "2 × tira hembra 1×19, 2,54"],
        ["U2", "1", "Buffer Schmitt", "74LVC1G17", "SOT-23-5"],
        ["Q1", "1", "MOSFET N nivel lógico", "AO3400A", "SOT-23"],
        ["D1", "1", "Schottky", "SS54 (5 A, 40 V)", "SMC"],
        ["D2", "1", "TVS", "SMBJ15A", "SMB"],
        ["D3", "1", "Schottky", "SS34 (3 A, 40 V)", "SMA"],
        ["D4", "1", "Rueda libre", "S1M / 1N4007", "SMA / DO-41"],
        ["D5", "1", "ESD", "PESD5V0S1BA", "SOD-323"],
        ["D6", "1", "TVS", "SMAJ5.0A", "SMA"],
        ["F1", "1", "PTC", "I<sub>hold</sub> 2 A, ≥ 16 V", "1812"],
        ["F2", "1", "PTC", "I<sub>hold</sub> 1,1 A, ≥ 6 V", "1206"],
        ["C1", "1", "Electrolítico", "470 µF 25 V", "Radial"],
        ["C4", "1", "Electrolítico", "100 µF 16 V", "Radial"],
        ["C3", "1", "MLCC X5R", "10 µF 16 V", "0805"],
        ["C5", "1", "MLCC C0G", "4,7 nF", "0805"],
        ["C2, C6–C9", "5", "MLCC X7R", "100 nF 50 V", "0805"],
        ["R1", "1", "Resistor", "100 Ω", "0805"],
        ["R2, R3, R5", "3", "Resistor", "10 kΩ", "0805"],
        ["R4, R9, R10", "3", "Resistor", "1 kΩ", "0805"],
        ["R6, R8", "2", "Resistor", "4,7 kΩ", "0805"],
        ["R7", "1", "Resistor", "470 Ω", "0805"],
        ["R11 / R12", "2", "Resistor 1 %", "100 kΩ / 22 kΩ", "0805"],
        ["LED1, LED2", "2", "LED", "Verde", "0805"],
        ["LED3", "1", "LED", "Ámbar", "0805"],
        ["LED4", "1", "LED", "Verde o ámbar, V<sub>F</sub> ≤ 2,2 V", "0805"],
        ["SW1, SW2", "2", "Pulsador táctil", "SW2 opcional", "6 × 6 mm THT"],
        ["JP1", "1", "Puente de soldadura", "3 pads, 1-2 cerrado", "—"],
        ["J1", "1", "Bornera a tornillo", "2 polos, 12 V", "5,08 mm"],
        ["J2", "1", "Micro-USB B hembra", "Anclajes THT", "SMD + THT"],
        ["J3", "1", "Bornera a tornillo", "2 polos, válvula", "5,08 mm"],
        ["J4", "1", "Bornera enchufable", "3 polos, caudalímetro", "3,81 o 5,08 mm"],
        ["J5", "1", "Tira macho (NM)", "1×8", "2,54 mm"],
        ["TP1–TP8", "8", "Punto de prueba", "TP4, TP5 tipo lazo", "—"],
    ]
    h += [P("8. Lista de materiales de referencia", h1),
          P("Se aceptan equivalentes de iguales o mejores características."),
          tabla(bom, [22, 10, 38, 58, 42], mono_cols=(0,))]

    h += [P("9. Requisitos de layout", h1),
          N(1, "Lazo de potencia J3 → Q1 → masa → J1 mínimo. D4 a menos de 10 mm de J3."),
          N(2, "Ancho de pista: +12V y válvula ≥ 1,5 mm; +5V ≥ 0,8 mm; señal 0,25–0,3 mm."),
          N(3, "Plano de masa continuo en la capa inferior. Retorno de la válvula sin pasar bajo U1 ni U2; unión de masas de "
               "12 V y 5 V en un punto junto a J1."),
          N(4, "Antena del módulo (extremo opuesto al USB) fuera del contorno, o zona libre de cobre en todas las capas y de "
               "componentes de ≈ 15 mm."),
          N(5, "D5, R3, R4, C5 y U2 junto a J4. C4 junto al pin 5V del módulo; C6 a menos de 3 mm de U2."),
          N(6, "J1, J2, J3 y J4 sobre un mismo borde. Micro-USB del módulo accesible con el gabinete abierto."),
          N(7, "SMD solo en la cara superior; pasivos ≥ 0805. Agujeros M3 sin conexión, 3 mm libres de cobre."),
          N(8, "Serigrafía: referencias, polaridades, tensión de cada entrada, colores de J4 (ROJO V+ · NEGRO GND · "
               "AMARILLO SEÑAL), posición por defecto de JP1, \"GRIFO rev A\" y campo para número de serie."),

          P("10. Fabricación y montaje", h1),
          tabla_ficha([
              ["Laminado", "FR-4, 1,6 mm, 2 capas, cobre 1 oz"],
              ["Reglas", "Pista/separación ≥ 0,2 mm; perforación ≥ 0,3 mm; vía 0,3/0,6 mm"],
              ["Terminación", "Máscara en ambas caras, serigrafía blanca superior, HASL sin plomo o ENIG, test eléctrico"],
              ["Montaje", "SMD de fábrica (incluye J2). THT a mano: J1, J3, J4, tiras hembra, SW1, SW2, C1, C4"],
              ["Prototipo", "5 PCB, al menos 2 ensambladas"],
          ], [38, 132]),

          P("11. Ensayos de aceptación", h1),
          tabla([
              ["#", "Condición", "Criterio"],
              ["E1", "Sin alimentación ni módulo", "Sin continuidad entre +12V, +5V_IN, +3V3 y GND"],
              ["E2", "Solo 12 V, sin módulo", "LED1 on, LED2/LED3 off. TP1 ≈ 11,4 V; TP8 ≈ 2,06 V"],
              ["E3", "12 V con polaridad invertida", "Sin corriente; LED1 off; sin daño"],
              ["E4", "Solo 5 V, sin módulo", "LED2 on. TP2 4,75–5,25 V; pin 5V del zócalo ≈ 4,6 V"],
              ["E5", "12 V y 5 V, sin módulo", "LED3 off (R1)"],
              ["E6", "Módulo con firmware de ensayo", "TP6 0 / 3,3 V según comando; LED3 acompaña"],
              ["E7", "Válvula conectada, 50 ciclos", "Sin reset del ESP32 (R3)"],
              ["E8", "Caudalímetro en reposo, 5 min", "0 pulsos en TP7"],
              ["E9", "Cuatro combinaciones de entradas", "Válvula nunca energizada sin comando (R2)"],
              ["E10", "Gabinete cerrado, instalado", "RSSI WiFi ≥ −70 dBm"],
          ], [12, 60, 98], mono_cols=(0,)),

          P("12. Entregables", h1),
          B("Esquemático (PDF) y proyecto fuente KiCad."),
          B("Gerber, perforaciones, BOM con números de parte de fabricante y proveedor, archivo pick-and-place."),
          B("Modelo 3D con el módulo montado. Informe DRC y verificación de la lista de conexiones de la sección 7."),
          B("Huella del módulo verificada 1:1 contra la muestra."),

          P("13. Provisto por el cliente", h1),
          B("Módulo NodeMCU ESP-32S v1.1 de muestra."),
          B("Electroválvula y caudalímetro para los ensayos E7 y E8."),
          B("Modelo de gabinete, que define el contorno, las fijaciones y los recortes."),
          B("Firmware de ensayo y de producción."),
          ]
    return h

def construir():
    doc = BaseDocTemplate(SALIDA, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                          topMargin=22 * mm, bottomMargin=20 * mm,
                          title=f"{DOC} {REV} — Especificación técnica PCB controladora de canilla GRIFO",
                          author="GRIFO", subject="Especificación técnica de PCB")
    marco = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
    doc.addPageTemplates([PageTemplate(id="p", frames=[marco], onPage=pagina)])
    doc.build(contenido())
    return doc.page

# dos pasadas: la primera cuenta las páginas para el pie "Página n de N"
TOTAL[0] = construir()
construir()
print("OK", SALIDA, TOTAL[0], "páginas")
