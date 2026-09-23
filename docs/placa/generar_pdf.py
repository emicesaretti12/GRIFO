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

    caja(d, 2, 266, 82, 40, "Cargador 12 V", "cables pelados", externo=True)
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
    cable(d, [(258, 46), (296, 46), (296, 110), (318, 110)], "GPIO27", (300, 100), ancla="start")
    cable(d, [(353, 78), (353, 96)], "GPIO14", (349, 84), ancla="end")
    cable(d, [(433, 96), (433, 78)], "GPIO2", (437, 84), ancla="start")
    return d

# ── Encabezado / pie ────────────────────────────────────────────────────────
FECHA = "23/09/2026"
def pagina(c, doc):
    c.saveState()
    c.setFont("Sans", 7.2); c.setFillColor(TENUE)
    c.drawString(20 * mm, 287 * mm, "GRIFO · Placa controladora de canilla · rev A")
    c.drawRightString(190 * mm, 287 * mm, "Requerimientos de diseño · borrador 3")
    c.setStrokeColor(LINEA); c.setLineWidth(0.5)
    c.line(20 * mm, 285 * mm, 190 * mm, 285 * mm)
    c.drawString(20 * mm, 12 * mm, FECHA)
    c.drawRightString(190 * mm, 12 * mm, f"Página {doc.page}")
    c.restoreState()

def portada(c, doc):
    c.saveState()
    c.setFillColor(AMBAR)
    c.rect(20 * mm, 262 * mm, 18 * mm, 1.6 * mm, fill=1, stroke=0)
    c.setFont("Sans", 7.2); c.setFillColor(TENUE)
    c.drawString(20 * mm, 12 * mm, FECHA)
    c.drawRightString(190 * mm, 12 * mm, f"Página {doc.page}")
    c.restoreState()

def ficha(filas):
    t = Table([[Paragraph(f"<b>{a}</b>", celda), Paragraph(b, celda)] for a, b in filas],
              colWidths=[38 * mm, 132 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PANEL),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, LINEA),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t

# ── Contenido ───────────────────────────────────────────────────────────────
h = []
titulo = ParagraphStyle("t", fontName="Sans-B", fontSize=24, leading=28, textColor=TINTA)
sub = ParagraphStyle("s", fontName="Sans", fontSize=11.5, leading=15.5, textColor=TINTA2)
meta = ParagraphStyle("m", fontName="Mono", fontSize=8, leading=12, textColor=TENUE)

h += [Spacer(1, 12 * mm),
      Paragraph("Placa controladora<br/>de canilla GRIFO", titulo), Spacer(1, 5),
      Paragraph("Requerimientos de diseño · revisión A · borrador 3", sub), Spacer(1, 8),
      Paragraph("Estado: BORRADOR PARA REVISIÓN — hay datos a medir antes de fabricar (sección 15)<br/>"
                "Reemplaza: protoboard + módulo relé + conversor de niveles + cableado suelto<br/>"
                "Firmware de referencia: etapa 7 (tablet con NFC), rama claude/grifo-cerveza-esp32-qndb2h",
                meta),
      Spacer(1, 7 * mm),
      ficha([
          ["Alimentación", "<b>Dos cargadores</b>, como en la instalación actual: 12 V para la válvula y "
                           "5 V USB para la electrónica. Masas unidas en la placa."],
          ["Conexiones externas", "Cargador 12 V (bornera, cables pelados) · cargador 5 V (micro-USB, el mismo cable de hoy) · válvula (bornera 2 polos) · "
                                  "caudalímetro (bornera 3 polos). Todas sobre un mismo borde."],
          ["Controlador", "ESP32 NodeMCU-32S de 38 pines, el mismo de hoy, enchufado sobre tiras hembra."],
          ["Tensión máxima", "12 V. La placa no maneja 220 V en ningún punto: la red queda dentro de los cargadores."],
          ["Seguridad por hardware", "La válvula queda cerrada mientras el ESP32 arranca, se reinicia, se reprograma, "
                                     "no está colocado o no tiene alimentación."],
      ]),
      ]

h += [P("1. Objetivo y alcance", h1),
      P("Diseñar una única placa de circuito impreso que reúna todo lo que hoy está repartido en la "
        "protoboard. La instalación en la canilla tiene que ser: <b>enchufar los dos cargadores, atornillar la "
        "válvula y los tres cables del caudalímetro, y nada más</b>. La placa debe poder operarse y diagnosticarse "
        "en el bar sin computadora, y reprogramarse o reemplazarse sin soldar."),
      P("La lógica de venta no cambia: el corte del servicio lo decide el ESP32 localmente comparando enteros, "
        "la válvula está cerrada por defecto y el saldo nunca se guarda en la tarjeta."),

      P("2. Qué reemplaza y por qué", h1),
      tabla([
          ["Hoy en la protoboard", "En la placa rev A", "Qué se gana"],
          ["Módulo relé 12 V + canal 4 del conversor BSS138 + salida open-drain",
           "MOSFET Q1 comandado directo desde 3,3 V",
           "Sin partes móviles ni desgaste de contactos. Desaparece la trampa del riel HV que tenía que quedar vacío."],
          ["Sin diodo en la válvula: el ESP32 se reinicia al cerrarla (mitigado por software)",
           "Diodo D4 soldado junto a la bornera de la válvula",
           "Se elimina la causa del reinicio."],
          ["Cargador de 5 V enchufado al micro-USB del ESP32",
           "Entrada micro-USB propia de la placa: el mismo cargador se enchufa a la placa",
           "El cable deja de tirar del módulo, que va enchufado y podría salirse. El USB del ESP32 queda libre para programar."],
          ["Cargador de 12 V a los bornes DC+/DC− del relé",
           "Bornera propia, con los mismos cables pelados, fusible y protección de polaridad",
           "Un cortocircuito o un cargador invertido no rompen nada."],
          ["Caudalímetro a 3,3 V (fuera de su especificación) con pull-up interno de ≈45 kΩ",
           "Sensor a 5 V, pull-up externo 10 kΩ, filtro y buffer Schmitt a 3,3 V",
           "Señal limpia con cable largo cerca de heladeras y motores; sin conteo doble."],
          ["Un cable suelto en J51 para entrar al portal WiFi", "Pulsador CONFIG", "Operable por cualquier persona."],
          ["Buses armados con jumpers en las filas 5 y 10", "Planos de 3V3 y GND", "Sin conexiones que se aflojen."],
          ["Punta negra del tester en el hueco A33", "Puntos de prueba rotulados, GND tipo lazo", "Medición segura sin tocar borneras."],
          ["Sin indicadores, y sin forma de saber si falta el cargador de 12 V",
           "LEDs 12V, 5V, VÁLVULA y SERVICIO; detección de 12 V en GPIO36",
           "Diagnóstico a simple vista y desde la app."],
      ], [52, 50, 68]),
      ]

h += [
      KeepTogether([P("3. Diagrama de bloques", h1),
      P("Dos entradas de energía independientes. La de 12 V solo alimenta la válvula y la de 5 V solo la electrónica; "
        "las masas se unen en la placa. Las cajas punteadas son externas y se conectan por bornera o conector."),
      Spacer(1, 4), diagrama(), Spacer(1, 4)]),

      P("4. Alimentación: los dos cargadores", h1),
      P("4.1 Requisitos de cada cargador", h2),
      tabla([
          ["", "Cargador de 12 V (válvula)", "Cargador de 5 V (electrónica)"],
          ["Tensión", "12 V DC regulada, ± 5 %", "5 V DC (USB), 4,75–5,25 V"],
          ["Corriente mínima", "1,5 × la corriente de la válvula, y nunca menos de 1 A", "1 A; se recomienda 2 A"],
          ["Tipo", "Adaptador de pared certificado, salida aislada", "Cargador USB certificado, salida aislada"],
          ["Conector en la placa", "Bornera de 2 polos (J1). El cable del cargador ya está pelado",
           "Micro-USB B hembra (J2). El cable fijo del cargador, que hoy va al ESP32, pasa a ir a la placa"],
          ["Cable", "El del cargador, con puntera crimpada en cada punta pelada (sección 12)",
           "El fijo del cargador. Si alguna vez se reemplaza: ≤ 1 m y de buen calibre, porque un cable fino hace caer la "
           "tensión en los picos del WiFi y reinicia el ESP32"],
          ["Qué pasa si falta", "La electrónica funciona pero la válvula no puede abrir. El firmware lo detecta por GPIO36 (sección 7.5)",
           "El ESP32 se apaga. La app muestra la canilla \"Sin señal\"; la válvula queda cerrada por R2"],
      ], [30, 70, 70]),

      P("4.2 Por qué dos entradas y no una", h2),
      B("Es la instalación que ya funciona, y los dos cargadores se usan tal como están: el de 12 V con sus cables pelados y "
        "el de 5 V con su cable micro-USB fijo."),
      B("La corriente de la válvula no circula por la alimentación del ESP32: el ruido al abrir y cerrar queda del lado de 12 V."),
      B("No hace falta un regulador en la placa, que es la pieza que más calienta dentro de un gabinete cerrado."),

      P("4.3 Los conectores no se pueden cruzar", h2),
      P("El cargador de 12 V entra solo por la bornera J1; el de 5 V solo por micro-USB. <b>Es un requisito, no una "
        "preferencia</b>: si las dos entradas fueran borneras iguales, invertirlas pondría 12 V en el pin de 5 V del "
        "ESP32 y lo destruiría."),
      aviso("NUNCA —", "ponerle un conector USB (micro-USB, USB-C ni ningún otro) al cargador de 12 V. Entraría en el "
            "micro-USB de la placa o en el del ESP32 y quemaría el módulo en el acto. Los cables pelados en la bornera "
            "son la conexión correcta y definitiva para los 12 V.", critico=True),
      P("En cambio, confundir los dos micro-USB no rompe nada: el de la placa (J2) y el del módulo reciben los dos 5 V. "
        "Tampoco un cargador de carga rápida puede subir la tensión: para eso necesita negociar por las líneas de datos, "
        "que en J2 quedan sin conectar. Por esa entrada siempre llegan 5 V."),

      P("4.4 El orden de conexión es indistinto", h2),
      tabla([
          ["12 V", "5 V", "Estado", "Válvula"],
          ["No", "No", "Apagada", "Cerrada"],
          ["Sí", "No", "ESP32 apagado; LED 12V encendido", "Cerrada por R2 (sin ESP32 que la comande)"],
          ["No", "Sí", "ESP32 funcionando; LED 12V apagado; el firmware informa \"sin 12 V\"", "No puede abrir: no hay 12 V"],
          ["Sí", "Sí", "Normal", "La comanda el firmware"],
      ], [16, 16, 88, 50]),
      P("La regla de siempre se mantiene: <b>los cables se cambian con los dos cargadores desenchufados</b>."),
      ]

h += [
      P("5. Especificaciones generales", h1),
      tabla([
          ["Parámetro", "Valor", "Nota"],
          ["Entrada de 12 V", "12 V DC ± 5 %", "Solo alimenta la válvula, LED1 y la detección de 12 V."],
          ["Entrada de 5 V", "5 V DC (USB), 4,75–5,25 V", "ESP32, caudalímetro, buffer y LEDs."],
          ["Consumo de 5 V", "≈ 100 mA promedio, picos de ≈ 500 mA", "Picos por transmisión WiFi. 500 mA es lo que Espressif pide dimensionar."],
          ["Carga de la válvula", "Hasta 2 A a 12 V DC (valor de diseño)", "<b>A confirmar</b> con la válvula real (sección 15)."],
          ["Tensión en la válvula", "≈ 11,4 V", "12 V menos la caída de F1 y D1. Verificar la tensión mínima de la válvula."],
          ["Tensión máxima en la placa", "12 V", "Muy baja tensión de seguridad. Nada de 220 V en la placa."],
          ["Tamaño", "≤ 100 × 100 mm", "Tarifa mínima de los fabricantes habituales. Contorno final según gabinete."],
          ["Altura máxima", "≈ 25 mm", "Lo más alto es el ESP32 sobre tiras hembra y el electrolítico C1."],
          ["Montaje", "4 agujeros M3 (Ø 3,2 mm) en las esquinas, a 4 mm del borde", "Sin conexión eléctrica."],
          ["Ambiente", "0–45 °C, humedad alta, sin condensación dentro del gabinete", "Salpicaduras de cerveza; línea fría cerca."],
          ["Programación", "Micro-USB del propio módulo ESP32", "Con los dos cargadores desenchufados (sección 7.2)."],
      ], [36, 56, 78]),

      P("6. Módulo ESP32: huella y pines", h1),
      B("<b>U1</b> — NodeMCU ESP-32S v1.1, 38 pines, micro-USB, conversor CP2102. Es el módulo actual. Va sobre dos "
        "tiras hembra de 1 × 19, paso 2,54 mm: no se suelda."),
      B("<b>Separación entre filas: 22,86 mm (0,9 in)</b>, deducida de la protoboard, donde el módulo ocupa las "
        "columnas B e I. Confirmar con calibre y, antes de fabricar, <b>imprimir la huella en papel a escala 1:1 y "
        "apoyar el módulo encima</b>."),
      B("<b>Cuidado con el espejo</b>: los rótulos del módulo están en la cara de abajo. Visto desde arriba, en la "
        "placa, la izquierda y la derecha se invierten respecto de los documentos de la protoboard. Por eso las "
        "filas se nombran por su contenido y no por su lado."),
      B("<b>Antena</b>: está en la punta opuesta al USB. Tiene que sobresalir del borde de la placa, o tener debajo y "
        "alrededor (≈ 15 mm) una zona sin cobre en ninguna capa y sin componentes. Tiene prioridad sobre el acceso "
        "al micro-USB, que se puede alcanzar con la tapa abierta."),
      P("Posición de los pines usados, contando desde la punta del USB (1) hacia la de la antena (19). "
        "Relevado sobre el módulo real en las etapas 2 y 6:"),
      tabla([
          ["Pos.", "Fila A (5V … 3V3)", "Uso", "Fila B (CLK … GND)", "Uso"],
          ["1", "5V", "Entrada de 5 V (desde D3)", "CLK", "No conectar"],
          ["5", "", "", "P2", "LED SERVICIO"],
          ["8", "P14", "Botón CONFIG", "P16", "—"],
          ["9", "P27", "Pulsos del caudalímetro", "P17", "—"],
          ["10", "P26", "Mando de la válvula", "P5", "RFID SDA (sin montar)"],
          ["11", "P25", "—", "P18", "RFID SCK (sin montar)"],
          ["12", "P33", "—", "P19", "RFID MISO (sin montar)"],
          ["13", "P32", "—", "GND", "Masa"],
          ["17", "P36", "Detección de 12 V", "P22", "RFID RST (sin montar)"],
          ["18", "EN", "Botón RESET (opcional)", "P23", "RFID MOSI (sin montar)"],
          ["19", "3V3", "Salida de 3,3 V", "GND", "Masa"],
      ], [12, 30, 46, 30, 52], mono_cols=(0, 1, 3)),
      P("Todos los pines GND del módulo van a masa. Los pines no listados quedan sin conexión. "
        "No conectar nada a P0, P2 (salvo el LED indicado), P12 ni P15, que definen el modo de arranque, "
        "ni a SD0/SD1/SD2/SD3/CMD/CLK, que son de la memoria flash interna."),
      ]

h += [P("7. Bloques en detalle", h1),
      P("7.1 Entrada de 12 V", h2),
      P("J1 (bornera) → F1 → D1 → bus +12V. Sobre el bus: D2, C1 y C2."),
      B("<b>J1</b> — bornera a tornillo de 2 polos, 5,08 mm, para los cables pelados del cargador. Rotulada "
        "\"12 V\" con \"+\" y \"−\" bien visibles."),
      B("<b>F1</b> — fusible reseteable PTC 1812, I<sub>hold</sub> entre 1,5 y 2 veces la corriente de la válvula "
        "(2 A de diseño), V<sub>máx</sub> ≥ 16 V."),
      B("<b>D1</b> — Schottky SS54 (5 A, 40 V) en serie: si el cargador tiene la polaridad al revés, no pasa corriente y "
        "no se rompe nada (LED1 apagado es la señal). Importa más que nunca: el cable pelado no trae marca de polaridad."),
      B("<b>D2</b> — TVS SMBJ15A a masa. <b>C1</b> 470 µF / 25 V electrolítico y <b>C2</b> 100 nF / 50 V."),
      B("<b>LED1</b> verde \"12V\" con R8 4,7 kΩ."),

      P("7.2 Entrada de 5 V", h2),
      P("J2 (micro-USB) → F2 → bus +5V_IN → D3 → pin 5V del ESP32 (+5V_ESP)."),
      B("<b>J2</b> — micro-USB B hembra con <b>anclajes pasantes en la carcasa</b>: las versiones solo de montaje "
        "superficial se arrancan de la placa al enchufar y desenchufar. Se conectan VBUS y GND; D+, D− e ID quedan "
        "sin conexión. La carcasa va a masa."),
      B("<b>F2</b> — PTC 1206, I<sub>hold</sub> 1,1 A, V<sub>máx</sub> ≥ 6 V. <b>D6</b> — TVS SMAJ5.0A a masa, después de F2: "
        "si un cargador falla y entrega de más, D6 conduce y F2 corta."),
      B("<b>C3</b> 10 µF / 16 V cerámico sobre +5V_IN. <b>LED2</b> verde \"5V\" con R9 1 kΩ."),
      B("<b>D3</b> — Schottky SS34 (3 A, 40 V) hacia el pin 5V del módulo, y <b>C4</b> 100 µF / 16 V electrolítico pegado "
        "a ese pin, para los picos del WiFi. El módulo recibe ≈ 4,6 V, la misma condición en que funciona con su "
        "propio USB. D3 impide que el USB de la computadora alimente al cargador cuando se programa."),
      B("De +5V_IN (antes de D3) salen VSENSOR (por JP1) y LED2."),
      aviso("Para programar —", "desenchufar el cargador de 12 V y el de 5 V (de J2), y conectar la computadora al "
            "micro-USB del módulo. "
            "D3 protege en un sentido, pero si el módulo no tiene diodo propio en su USB, un cargador de 5 V conectado "
            "a la vez podría empujar corriente hacia la computadora. Con el cargador de 12 V desenchufado, además, "
            "la válvula no puede abrir durante la programación."),

      P("7.3 Etapa de la válvula", h2),
      P("Interruptor del lado de masa: la válvula va entre +12V y el drenador de Q1."),
      tabla([
          ["Ref.", "Componente", "Conexión"],
          ["Q1", "MOSFET canal N de nivel lógico AO3400A (SOT-23: 1 G, 2 S, 3 D; verificar con la hoja de datos). "
                 "Alternativa para soldar a mano: IRLB8721PbF (TO-220).",
           "Drenador → J3.2 · Fuente → GND · Compuerta → R1"],
          ["R1", "100 Ω", "GPIO26 → compuerta"],
          ["R2", "10 kΩ", "Compuerta → GND"],
          ["D4", "1N4007 (THT) o S1M (SMD)", "Cátodo → +12V · Ánodo → J3.2"],
          ["LED3 + R6", "LED ámbar \"VÁLVULA\" + 4,7 kΩ", "Ánodo por R6 a +12V · cátodo a J3.2: enciende cuando la placa alimenta la válvula"],
          ["J3", "Bornera 2 polos, 5,08 mm", "1: +12V · 2: VÁLVULA (−)"],
      ], [18, 76, 76]),
      aviso("CRÍTICO —", "R2 es la garantía de seguridad por hardware: sin firmware corriendo, GPIO26 queda en alta impedancia "
            "y R2 mantiene la compuerta en bajo. D4 es obligatorio y va a menos de 10 mm de J3: sin él, el pico de "
            "tensión al cerrar la válvula reinicia el ESP32.", critico=True),
      P("A 2 A, Q1 disipa ≈ 0,16 W: no necesita disipador. LED3 separa dos fallas que hoy se confunden: si enciende y la "
        "cerveza no sale bien, el problema es de la válvula o de la presión (mínimo 0,2 bar); si no enciende, es de la "
        "placa o del firmware."),
      ]

h += [P("7.4 Entrada del caudalímetro", h2),
      P("El sensor se alimenta dentro de su especificación y su señal se limpia y se adapta a 3,3 V antes de llegar al ESP32, "
        "sin depender de cómo esté construida la salida del sensor por dentro."),
      tabla([
          ["Ref.", "Componente", "Conexión"],
          ["J4", "Bornera 3 polos, 3,81 o 5,08 mm, enchufable preferentemente",
           "1: V+ (ROJO) → VSENSOR · 2: GND (NEGRO) · 3: SEÑAL (AMARILLO)"],
          ["JP1", "Puente de soldadura de 3 pads", "Pad 1 = +5V_IN · pad 2 = VSENSOR · pad 3 = 3V3. De fábrica cerrado 1-2 (5 V)"],
          ["C8", "100 nF", "VSENSOR → GND, junto a J4"],
          ["R3", "10 kΩ", "SEÑAL → VSENSOR (pull-up)"],
          ["D5", "Protección ESD unidireccional, V<sub>RWM</sub> 5–6 V (p. ej. PESD5V0S1BA)", "SEÑAL → GND, pegado a J4"],
          ["R4", "1 kΩ", "SEÑAL → entrada de U2"],
          ["C5", "4,7 nF", "Entrada de U2 → GND"],
          ["U2", "74LVC1G17, buffer Schmitt, SOT-23-5 (1 NC, 2 A, 3 GND, 4 Y, 5 VCC)", "VCC = 3V3 · A = filtro · Y → GPIO27"],
          ["C6", "100 nF", "VCC de U2 → GND, a menos de 3 mm"],
      ], [14, 70, 86]),
      P("<b>Cálculo del filtro.</b> Al bajar, el sensor descarga C5 a través de R4: τ = 4,7 µs. Al subir, lo carga R3 + R4: "
        "τ ≈ 52 µs, y la señal cruza el umbral de U2 en ≈ 26 µs. Con 12 820 pulsos por litro y un caudal alto de 6 L/min, "
        "los pulsos llegan a ≈ 1,3 kHz (medio período ≈ 390 µs): el filtro usa menos del 7 % de ese tiempo. Corta a "
        "≈ 34 kHz y deja pasar la señal completa aunque el sensor resulte ser de pocos pulsos por litro."),
      P("El disparador Schmitt evita que un flanco lento o ruidoso se cuente dos veces. La entrada de U2 tolera hasta 5,5 V "
        "aunque U2 esté alimentado a 3,3 V: por eso el sensor puede ir a 5 V sin arriesgar el ESP32."),

      P("7.5 Detección de 12 V", h2),
      B("<b>R11</b> 100 kΩ desde +12V y <b>R12</b> 22 kΩ a masa; el punto medio va a GPIO36 con <b>C9</b> 100 nF a masa."),
      B("Con 11,4 V en el bus quedan ≈ 2,06 V en el pin; con 14 V, ≈ 2,5 V. Dentro del rango útil del ADC con atenuación de "
        "11 dB. GPIO36 es solo entrada y pertenece al ADC1, que funciona con el WiFi encendido."),
      B("Con el ESP32 sin alimentar y 12 V presentes, entran menos de 0,1 mA al pin por la protección interna: aceptable."),
      B("Permite que el firmware no abra una sesión sin 12 V y avise en la app qué cargador falta. Requiere soporte en "
        "firmware (sección 14)."),

      P("7.6 Botones, LEDs y opcionales", h2),
      B("<b>SW1 CONFIG</b> — pulsador táctil 6 × 6 mm. GPIO14 va a 3V3 por R5 10 kΩ, a masa por C7 100 nF, y al pulsador "
        "por <b>R10 1 kΩ en serie</b>; el otro lado del pulsador, a masa. R10 limita la corriente si el pin conmuta "
        "durante el arranque justo con el botón apretado, que es cuando se usa. Apretado, el pin lee ≈ 0,3 V (bajo). "
        "Uso: mantener apretado al enchufar el cargador de 5 V y soltar después de 3 s. Accesible pero hundido."),
      B("<b>LED4 SERVICIO</b> — verde o ámbar, R7 470 Ω desde GPIO2 a masa. Enciende con la canilla habilitada o sirviendo y "
        "parpadea en el portal. <b>No azul</b>: su tensión directa (≈ 3 V) no deja margen a 3,3 V. GPIO2 es pin de "
        "arranque; una carga a masa es compatible (el módulo ya trae su propio LED ahí)."),
      B("<b>SW2 RESET</b> (opcional) — pulsador entre EN y masa, en paralelo con el del módulo."),
      B("<b>J5</b> (sin montar) — tira 1 × 8, 2,54 mm, en el orden del módulo MFRC522: SDA (GPIO5), SCK (18), MOSI (23), "
        "MISO (19), IRQ (sin conexión), GND, RST (22), 3,3 V. Verificar contra el módulo. <b>El lector va a 3,3 V: a 5 V se quema.</b>"),

      P("7.7 Puntos de prueba", h2),
      tabla([
          ["TP", "Red", "Valor esperado"],
          ["TP1", "+12V (después de D1)", "≈ 11,4 V"],
          ["TP2", "+5V_IN (antes de D3)", "4,75–5,25 V"],
          ["TP3", "3V3", "3,3 V ± 0,1"],
          ["TP4, TP5", "GND, tipo lazo para enganchar la punta negra", "0 V"],
          ["TP6", "GATE_DRV (GPIO26)", "0 V cerrada · 3,3 V abierta"],
          ["TP7", "FLOW (salida de U2, GPIO27)", "Pulsos 0–3,3 V con el sensor girando"],
          ["TP8", "SENSE12 (GPIO36)", "≈ 2,06 V con 12 V presentes · 0 V sin ellos"],
      ], [22, 88, 60], mono_cols=(0,)),
      ]

redes = [
    ["Red", "Conecta"],
    ["VIN12", "J1.1 (+), F1.1"],
    ["VIN12_F", "F1.2, D1 ánodo"],
    ["+12V", "D1 cátodo, D2 cátodo, C1 +, C2, R8.1, R6.1, R11.1, D4 cátodo, J3.1, TP1"],
    ["VBUS", "J2 VBUS, F2.1"],
    ["+5V_IN", "F2.2, D6 cátodo, C3, R9.1, D3 ánodo, JP1 pad 1, TP2"],
    ["+5V_ESP", "D3 cátodo, C4 +, U1 5V"],
    ["+3V3", "U1 3V3, U2 VCC (5), C6, R5.1, JP1 pad 3, J5.8, TP3"],
    ["VSENSOR", "JP1 pad 2, J4.1, R3.1, C8"],
    ["GATE_DRV", "U1 P26, R1.1, TP6"],
    ["GATE", "R1.2, Q1 compuerta, R2.1"],
    ["VALV_NEG", "J3.2, Q1 drenador, D4 ánodo, LED3 cátodo"],
    ["LED3_A", "R6.2, LED3 ánodo"],
    ["FLOW_RAW", "J4.3, R3.2, D5 cátodo, R4.1"],
    ["FLOW_RC", "R4.2, C5, U2 A (2)"],
    ["FLOW", "U2 Y (4), U1 P27, TP7"],
    ["SENSE12", "R11.2, R12.1, C9, U1 P36, TP8"],
    ["CFG", "U1 P14, R5.2, C7, R10.1"],
    ["CFG_SW", "R10.2, SW1"],
    ["SRV", "U1 P2, R7.1"],
    ["LED4_A", "R7.2, LED4 ánodo"],
    ["LED1_A / LED2_A", "R8.2 – LED1 ánodo · R9.2 – LED2 ánodo"],
    ["EN", "U1 EN, SW2"],
    ["SPI (sin montar)", "J5.1 – P5 · J5.2 – P18 · J5.3 – P23 · J5.4 – P19 · J5.7 – P22 · J5.5 sin conexión"],
    ["GND", "J1.2 (−), J2 GND y carcasa, D2 ánodo, D6 ánodo, D5 ánodo, C1 −, C2, C3, C4 −, C5, "
            "C6, C7, C8, C9, Q1 fuente, R2.2, R12.2, U1 todos los GND, U2 GND (3), J4.2, J5.6, SW1, SW2, "
            "cátodos de LED1, LED2 y LED4, TP4, TP5"],
]

h += [P("8. Lista de conexiones", h1),
      P("Es el esquemático en forma de tabla: cada red y todo lo que conecta. El diseñador la usa para dibujar el esquemático "
        "y la verifica contra él antes de rutear."),
      tabla(redes, [34, 136], mono_cols=(0,)),

      P("9. Conectores y serigrafía", h1),
      B("<b>Todos los conectores externos sobre un mismo borde</b>: J1, J2, J3 y J4. Así se cablea prolijo hacia el "
        "gabinete y el panel lleva los recortes en una sola cara."),
      B("Rotular cada conector con su función y su tensión: \"12 V VÁLVULA\", \"5 V USB\", \"VÁLVULA\", \"CAUDAL\". "
        "Marcas \"+\" y \"−\" en J1 y J3."),
      B("En J4: <b>ROJO · NEGRO · AMARILLO</b>, además de V+ · GND · SEÑAL. La placa tiene que decir dónde va cada cable "
        "sin consultar este documento."),
      B("Referencia de cada componente, marca de pin 1, dirección de los diodos, nombre de cada LED y de cada TP, y "
        "la posición por defecto de JP1."),
      B("Texto \"GRIFO rev A\", fecha, y un recuadro en blanco para escribir un número de serie a mano."),
      ]

h += [P("10. Reglas de diseño del impreso", h1),
      N(1, "<b>Lazo de potencia de la válvula</b> (J3 → D4 → Q1 → masa → J1) corto y ancho. D4 a menos de 10 mm de J3."),
      N(2, "<b>Ancho de pistas</b>: +12V y válvula ≥ 1,5 mm con cobre de 1 oz; +5V ≥ 0,8 mm; señales 0,25–0,3 mm."),
      N(3, "<b>Masa</b>: plano continuo en la capa inferior. La fuente de Q1 se une a la masa de J1 por un camino directo; "
           "la corriente de la válvula no pasa por debajo del ESP32 ni de U2. Las masas de 12 V y de 5 V se unen en un "
           "solo punto cercano a J1."),
      N(4, "<b>Antena</b>: ver sección 6. Nada metálico cerca: conectores, electrolíticos, tornillos."),
      N(5, "<b>Filtrar en el borde</b>: D5, R3, R4, C5 y U2 cerca de J4, donde entra el ruido del cable largo."),
      N(6, "<b>C4 pegado al pin 5V del módulo</b> y C6 a menos de 3 mm de U2."),
      N(7, "Todos los componentes SMD en la cara superior (montaje de fábrica de una sola cara). Pasivos no menores que 0805."),
      N(8, "Agujeros de montaje sin conexión, con 3 mm libres de cobre alrededor."),

      P("11. Fabricación y montaje", h1),
      tabla([
          ["Ítem", "Requisito"],
          ["Capas", "2"],
          ["Material y espesor", "FR-4, 1,6 mm"],
          ["Cobre", "1 oz (35 µm) en ambas caras"],
          ["Pista / separación mínima", "0,2 / 0,2 mm (holgado para cualquier fabricante)"],
          ["Perforación mínima", "0,3 mm; vías de 0,3 / 0,6 mm"],
          ["Máscara y serigrafía", "Máscara en ambas caras, serigrafía blanca en la cara superior"],
          ["Acabado", "HASL sin plomo o ENIG"],
          ["Test eléctrico", "Sí"],
          ["Cantidad del prototipo", "5 placas; montaje SMD de fábrica en al menos 2"],
          ["Montaje a mano", "Solo componentes pasantes: J1, J3, J4, tiras hembra, SW1, SW2, C1, C4"],
      ], [48, 122]),

      P("12. Gabinete, cableado e instalación", h1),
      B("<b>Gabinete plástico (ABS o policarbonato), nunca metálico</b>: el metal bloquea el WiFi. IP54 o superior."),
      B("Recortes en una sola cara para el micro-USB de la placa y las borneras, o un prensacables (PG7 o PG9) por cable."),
      B("<b>Cables pelados del cargador de 12 V</b>: con <b>puntera crimpada</b> (terminal tubular) en cada punta. Nunca "
        "estañados: el estaño cede bajo el tornillo con el tiempo y el contacto se afloja. Identificar el positivo con el "
        "tester antes de atornillar."),
      B("LEDs visibles desde afuera (ventana o guías de luz). Pulsador CONFIG accesible pero hundido. Micro-USB del "
        "módulo accesible con la tapa abierta."),
      B("Montado <b>por encima</b> de la línea de cerveza fría: la condensación gotea hacia abajo."),
      B("<b>Cable de la válvula</b>: 2 × 0,5 mm² como mínimo."),
      B("<b>Cable del caudalímetro</b>: 3 conductores de 0,22 a 0,5 mm², hasta 3 m, trenzado o mallado (la malla a masa solo "
        "del lado de la placa), separado de cables de 220 V y de motores."),
      B("Opcional: barniz protector sobre la placa, excepto tiras hembra, conectores y pulsadores."),
      ]

bom = [
    ["Ref.", "Cant.", "Componente", "Valor / modelo", "Encapsulado"],
    ["U1", "1", "Módulo ESP32", "NodeMCU ESP-32S v1.1, 38 pines (el actual)", "2 × tira hembra 1×19"],
    ["U2", "1", "Buffer Schmitt", "74LVC1G17", "SOT-23-5"],
    ["Q1", "1", "MOSFET N nivel lógico", "AO3400A (alt. IRLB8721PbF)", "SOT-23 (alt. TO-220)"],
    ["D1", "1", "Schottky", "SS54, 5 A 40 V", "SMC"],
    ["D2", "1", "TVS 12 V", "SMBJ15A", "SMB"],
    ["D3", "1", "Schottky", "SS34, 3 A 40 V", "SMA"],
    ["D4", "1", "Diodo de rueda libre", "1N4007 o S1M", "DO-41 o SMA"],
    ["D5", "1", "Protección ESD", "PESD5V0S1BA o equivalente", "SOD-323"],
    ["D6", "1", "TVS 5 V", "SMAJ5.0A", "SMA"],
    ["F1", "1", "Fusible reseteable", "PTC, I<sub>hold</sub> 2 A, ≥ 16 V", "1812"],
    ["F2", "1", "Fusible reseteable", "PTC, I<sub>hold</sub> 1,1 A, ≥ 6 V", "1206"],
    ["C1", "1", "Electrolítico", "470 µF 25 V", "Radial"],
    ["C2", "1", "Cerámico X7R", "100 nF 50 V", "0805"],
    ["C3", "1", "Cerámico X5R/X7R", "10 µF 16 V", "0805"],
    ["C4", "1", "Electrolítico", "100 µF 16 V", "Radial"],
    ["C5", "1", "Cerámico C0G/X7R", "4,7 nF", "0805"],
    ["C6–C9", "4", "Cerámico X7R", "100 nF", "0805"],
    ["R1", "1", "Resistencia", "100 Ω", "0805"],
    ["R2, R3, R5", "3", "Resistencia", "10 kΩ", "0805"],
    ["R4, R9, R10", "3", "Resistencia", "1 kΩ", "0805"],
    ["R6, R8", "2", "Resistencia", "4,7 kΩ", "0805"],
    ["R7", "1", "Resistencia", "470 Ω", "0805"],
    ["R11", "1", "Resistencia 1 %", "100 kΩ", "0805"],
    ["R12", "1", "Resistencia 1 %", "22 kΩ", "0805"],
    ["LED1, LED2", "2", "LED verde", "12V, 5V", "0805 o 3 mm"],
    ["LED3", "1", "LED ámbar", "VÁLVULA", "0805 o 3 mm"],
    ["LED4", "1", "LED verde o ámbar", "SERVICIO (no azul)", "0805 o 3 mm"],
    ["SW1", "1", "Pulsador táctil", "CONFIG", "6×6 mm THT"],
    ["SW2", "1", "Pulsador táctil (opcional)", "RESET", "6×6 mm THT"],
    ["JP1", "1", "Puente de soldadura", "3 pads, cerrado 1-2", "—"],
    ["J1", "1", "Bornera a tornillo (12 V)", "2 polos", "5,08 mm"],
    ["J2", "1", "Micro-USB B hembra (5 V)", "Con anclajes pasantes en la carcasa", "SMD + THT"],
    ["J3", "1", "Bornera", "2 polos", "5,08 mm"],
    ["J4", "1", "Bornera", "3 polos, enchufable preferentemente", "3,81 o 5,08 mm"],
    ["J5", "1", "Tira macho (sin montar)", "1×8", "2,54 mm"],
    ["TP1–TP8", "8", "Punto de prueba", "TP4 y TP5 tipo lazo", "—"],
    ["H1–H4", "4", "Agujero de montaje", "M3, Ø 3,2 mm", "—"],
]

h += [P("13. Lista de materiales", h1),
      P("Modelos de referencia y de disponibilidad amplia. Se aceptan equivalentes con iguales o mejores valores nominales. "
        "Ya no hacen falta el módulo relé ni el conversor de niveles."),
      tabla(bom, [20, 10, 42, 60, 38], mono_cols=(0,)),
      ]

h += [P("14. Cambios de firmware necesarios", h1),
      P("El mando de la válvula cambia de polaridad: el relé se activaba llevando el pin a masa; el MOSFET se activa "
        "llevándolo a 3,3 V. Se recomienda un entorno de PlatformIO propio para la placa, para que la protoboard siga "
        "funcionando con el firmware actual."),
      tabla([
          ["", "Protoboard (hoy)", "Placa rev A"],
          ["Válvula · GPIO26 · modo", "OUTPUT_OPEN_DRAIN", "OUTPUT"],
          ["Válvula · abrir / cerrar", "LOW / HIGH (pin liberado)", "HIGH / LOW"],
          ["Válvula · sin firmware", "Alta impedancia → cerrada", "Alta impedancia + R2 → cerrada"],
          ["Caudal · GPIO27", "caudalIniciar(true), pull-up interno", "caudalIniciar(false), pull-up R3 y buffer U2"],
          ["Detección de 12 V · GPIO36", "—", "Nuevo: ADC1, atenuación 11 dB. Menos de ≈ 1,6 V (≈ 9 V en el bus) = sin 12 V: "
                                                 "no abrir sesión e informarlo en el latido"],
          ["Botón · GPIO14 · LED · GPIO2", "—", "Sin cambios"],
      ], [44, 56, 70], mono_cols=(1, 2)),
      aviso("Importante —", "con el firmware actual esta placa <b>nunca abre la válvula</b>: en open-drain el pin solo va a masa "
            "o se suelta, y R2 mantiene la compuerta en bajo en los dos casos. La falla es segura, pero la placa no sirve "
            "hasta cargar el firmware nuevo."),
      aviso("Calibración —", "los pulsos por litro medidos en la protoboard <b>no se trasladan</b> a la placa: cambian la "
            "alimentación del sensor, el pull-up y el filtrado. Se recalibra con la placa definitiva."),
      ]

h += [P("15. Datos a confirmar antes de fabricar", h1),
      P("Requieren medir o leer las piezas reales. Ninguno se completó con suposiciones."),
      tabla([
          ["#", "Dato", "Estado", "Cómo obtenerlo", "Qué define"],
          ["1", "Corriente de la válvula, que sea de 12 V DC (no alterna) y su tensión mínima", "<b>Pendiente</b>",
           "Etiqueta (W ÷ 12 V) o tester en serie con la válvula abierta",
           "F1, Q1, pistas. Si fuera de alterna, esta etapa no sirve. Si pide 12 V mínimo, D1 se reemplaza por una protección sin caída"],
          ["2", "Conector del cargador de 12 V", "Resuelto", "Cables pelados", "Bornera J1"],
          ["3", "Corriente del cargador de 12 V", "<b>Pendiente</b>", "Etiqueta", "Tiene que cubrir 1,5 × la válvula"],
          ["4", "Cable del cargador de 5 V", "Resuelto", "Fijo, termina en micro-USB", "Micro-USB J2"],
          ["5", "Corriente del cargador de 5 V", "<b>Pendiente</b>", "Etiqueta", "Mínimo 1 A; si da menos, cambiarlo"],
          ["6", "Modelo del caudalímetro y su rango de alimentación", "<b>Pendiente</b>", "Etiqueta u hoja de datos del vendedor",
           "Posición de fábrica de JP1"],
          ["7", "Si el conteo actual es real o incluye ruido", "<b>Pendiente</b>",
           "Servir la misma cantidad medida tres veces y comparar pulsos: más de 5 % de diferencia es ruido. "
           "Con el sensor quieto 5 min el conteo no se mueve",
           "Confianza en la calibración (hoy 12 820 pulsos/L, unas 28 veces lo típico de un YF-S201)"],
          ["8", "Separación entre filas del módulo, y si tiene diodo en su USB", "<b>Pendiente</b>",
           "Calibre (se espera 22,86 mm); diodo entre el USB y el pin 5V, con el tester en modo diodo",
           "Huella; si se puede programar con el cargador de 5 V puesto"],
          ["9", "Gabinete: modelo y medidas interiores", "<b>Pendiente</b>", "Elegirlo primero",
           "Contorno de la placa, agujeros, altura, recortes del panel"],
      ], [7, 38, 19, 54, 52]),
      ]

h += [P("16. Plan de pruebas de la placa", h1),
      P("Una prueba por vez. No se avanza a la siguiente hasta que la anterior pasa."),
      tabla([
          ["Prueba", "Condiciones", "Resultado esperado"],
          ["1. En frío", "Sin cargadores ni módulo, tester en continuidad",
           "Sin continuidad entre +12V, +5V_IN, +3V3 y GND, ni entre +12V y +5V_IN"],
          ["2. Solo 12 V", "Cargador de 12 V, sin módulo. Antes: identificar el positivo del cable pelado con el tester",
           "LED1 encendido, LED2 y LED3 apagados. TP1 ≈ 11,4 V. TP8 ≈ 2,06 V"],
          ["3. Solo 5 V", "Cargador de 5 V, sin módulo",
           "LED2 encendido, LED1 y LED3 apagados. TP2 entre 4,75 y 5,25 V. Pin 5V del zócalo ≈ 4,6 V"],
          ["4. Los dos, sin módulo", "Ambos cargadores",
           "LED3 apagado: R2 mantiene la válvula cerrada sin ESP32"],
          ["5. Mando", "Módulo con firmware nuevo, sin válvula",
           "Arranque normal. TP3 = 3,3 V. Al habilitar: TP6 = 3,3 V y LED3 encendido. Al cerrar: 0 V y apagado"],
          ["6. Falta 12 V", "Desenchufar el de 12 V con todo funcionando",
           "El firmware lo informa en la app y no abre sesiones"],
          ["7. Válvula", "Con la válvula conectada",
           "50 ciclos de abrir y cerrar <b>sin ningún reinicio</b> del ESP32. Es la prueba de D4"],
          ["8. Caudal", "Con el caudalímetro conectado",
           "Quieto 5 min: 0 pulsos. Tres tiradas iguales dentro del 5 %. Recalibrar con 1 litro medido"],
          ["9. Orden de conexión", "Las cuatro combinaciones de la sección 4.4",
           "La válvula nunca abre sin una sesión"],
          ["10. Sistema completo", "Gabinete cerrado, en la canilla",
           "Pruebas de docs/etapa-07-tablet.md. Señal WiFi mejor que −70 dBm en la app con la tapa puesta"],
      ], [30, 54, 86]),

      P("17. Qué tiene que entregar el diseñador", h1),
      B("Esquemático en PDF y proyecto completo en KiCad (libre, lo puede abrir cualquiera)."),
      B("Gerbers y archivo de perforaciones listos para el fabricante."),
      B("Lista de materiales con número de parte del fabricante y del proveedor, y archivo de posiciones para el montaje."),
      B("Vista 3D con el módulo ESP32 colocado."),
      B("Verificación de reglas de diseño sin errores, y la lista de conexiones de la sección 8 verificada contra el esquemático."),
      B("La huella del ESP32 impresa a escala 1:1 y probada con el módulo real."),

      P("18. Fuera de alcance de la rev A", h1),
      P("<b>Rev B</b>: soldar el módulo ESP32-WROOM-32E directamente y agregar el conversor USB-serie a la placa. Más chica y "
        "más barata en cantidad, pero exige diseño de radiofrecuencia y del circuito de programación. Tiene sentido cuando la "
        "rev A esté validada en el bar. Una entrada única de 12 V con regulador también queda para una revisión posterior."),

      P("19. Registro de cambios", h1),
      tabla([
          ["Versión", "Cambios"],
          ["Borrador 1", "Primera versión: una sola entrada de 12 V con regulador a 5 V en la placa."],
          ["Borrador 2", "Dos entradas de alimentación (12 V y 5 V USB-C), como en la instalación real, con conectores que no se "
                         "pueden cruzar. Detección de 12 V en GPIO36. Filtro del caudal recalculado (C5 de 10 a 4,7 nF). "
                         "Resistencia en serie con el botón CONFIG. Separación y posiciones de pines del módulo relevadas. "
                         "Lista de conexiones completa. Requisitos de cargadores, cableado, fabricación, entregables y pruebas."],
          ["Borrador 3", "Conectores de alimentación según los cargadores reales: bornera para el de 12 V (cables pelados) y "
                         "micro-USB para el de 5 V (cable fijo). Se quitan el jack y las resistencias CC del USB-C. "
                         "Punteras en los cables pelados. Datos a confirmar con su estado."],
      ], [26, 144]),
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
