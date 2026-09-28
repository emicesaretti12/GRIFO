"""Genera docs/placa/GRIFO-HW-001-esquematico-revA.pdf (A3 apaisado, 1 hoja).

Es el esquemático de la especificación GRIFO-HW-001 Rev A: mismas referencias
y mismas redes que la lista de conexiones de la sección 7.
"""
import math, os
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib import colors
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.path.join(AQUI, "GRIFO-HW-001-esquematico-revA.pdf")
F = "/usr/share/fonts/truetype/dejavu/"
for n, a in [("Sans", "DejaVuSans.ttf"), ("Sans-B", "DejaVuSans-Bold.ttf"),
             ("Mono", "DejaVuSansMono.ttf"), ("Mono-B", "DejaVuSansMono-Bold.ttf")]:
    pdfmetrics.registerFont(TTFont(n, F + a))

TINTA = colors.HexColor("#141d1a")
TENUE = colors.HexColor("#6a7b74")
RED = colors.HexColor("#1d4e89")      # etiquetas de red
POT = colors.HexColor("#9a5c06")      # símbolos de alimentación
MARCO = colors.HexColor("#9fb0a9")

W, H = landscape(A3)
c = canvas.Canvas(SALIDA, pagesize=(W, H))
c.setTitle("GRIFO-HW-001 Rev A — Esquemático")
c.setAuthor("GRIFO")

def lw(v=0.9): c.setLineWidth(v)
def col(k): c.setStrokeColor(k); c.setFillColor(k)

def wire(*pts):
    col(TINTA); lw(0.9)
    p = c.beginPath(); p.moveTo(*pts[0])
    for q in pts[1:]: p.lineTo(*q)
    c.drawPath(p, stroke=1, fill=0)

def dot(x, y):
    col(TINTA); c.circle(x, y, 1.9, stroke=0, fill=1)

def txt(x, y, s, size=7, font="Sans", ancla="l", k=TINTA):
    c.setFont(font, size); c.setFillColor(k)
    {"l": c.drawString, "c": c.drawCentredString, "r": c.drawRightString}[ancla](x, y, s)

def gnd(x, y):
    col(TINTA); lw(0.9)
    c.line(x, y, x, y - 6)
    for i, w in enumerate((12, 8, 4)):
        c.line(x - w / 2, y - 6 - 3 * i, x + w / 2, y - 6 - 3 * i)

def pwr(x, y, nombre):
    col(POT); lw(0.9)
    c.line(x, y, x, y + 8); c.line(x - 6, y + 8, x + 6, y + 8)
    txt(x, y + 11, nombre, 6.8, "Sans-B", "c", POT)

def net(x, y, nombre, lado="r"):
    """Etiqueta de red pegada a (x, y); lado = hacia dónde se extiende."""
    c.setFont("Mono-B", 6.6)
    w = pdfmetrics.stringWidth(nombre, "Mono-B", 6.6) + 8
    x0 = x if lado == "r" else x - w
    col(RED); lw(0.7)
    c.roundRect(x0, y - 5, w, 10, 2, stroke=1, fill=0)
    txt(x0 + 4, y - 2.4, nombre, 6.6, "Mono-B", "l", RED)

def nc(x, y):
    col(TINTA); lw(0.8)
    c.line(x - 3, y - 3, x + 3, y + 3); c.line(x - 3, y + 3, x + 3, y - 3)

def tp(x, y, nombre, dx=0, dy=10):
    col(TINTA); lw(0.8)
    c.line(x, y, x + dx, y + dy)
    c.setFillColor(colors.white); c.circle(x + dx, y + dy + 2.6, 2.6, stroke=1, fill=1)
    txt(x + dx + 5, y + dy + 0.5, nombre, 6.2, "Sans-B", "l", TENUE)

# ── Componentes de dos terminales ───────────────────────────────────────────
HB = 12  # medio largo del cuerpo

def _simbolo(tipo):
    col(TINTA); lw(0.9)
    if tipo in ("R", "PTC"):
        c.setFillColor(colors.white); c.rect(-11, -4, 22, 8, stroke=1, fill=1)
        if tipo == "PTC":
            c.line(-12, -8, 9, 8); c.line(9, 8, 13, 8)
    elif tipo in ("C", "CP"):
        c.line(-12, 0, -2.2, 0); c.line(2.2, 0, 12, 0)
        lw(1.4); c.line(-2.2, -7, -2.2, 7)
        if tipo == "CP":
            p = c.beginPath(); p.moveTo(3.2, -7); p.curveTo(1.6, -3, 1.6, 3, 3.2, 7)
            c.drawPath(p, stroke=1, fill=0)
            lw(0.7); c.line(-8, 5, -8, 9); c.line(-10, 7, -6, 7)
        else:
            c.line(2.2, -7, 2.2, 7)
    elif tipo in ("D", "DS", "DZ", "LED"):
        c.line(-12, 0, -6, 0); c.line(6, 0, 12, 0)
        p = c.beginPath(); p.moveTo(-6, -6); p.lineTo(-6, 6); p.lineTo(6, 0); p.close()
        c.setFillColor(colors.white); c.drawPath(p, stroke=1, fill=1)
        c.line(6, -6, 6, 6)
        if tipo == "DS":
            c.line(6, 6, 9, 6); c.line(9, 6, 9, 3.5); c.line(6, -6, 3, -6); c.line(3, -6, 3, -3.5)
        if tipo == "DZ":
            c.line(6, 6, 3.5, 8.5); c.line(6, -6, 8.5, -8.5)
        if tipo == "LED":
            for ox in (-2, 3):
                c.line(ox, 8, ox + 5, 14)
                c.line(ox + 5, 14, ox + 2, 13.5); c.line(ox + 5, 14, ox + 4.6, 11)
    elif tipo == "SW":
        c.line(-12, 0, -7, 0); c.line(7, 0, 12, 0)
        c.setFillColor(colors.white)
        c.circle(-6, 0, 1.4, stroke=1, fill=1); c.circle(6, 0, 1.4, stroke=1, fill=1)
        c.line(-8, 5, 8, 5); c.line(0, 5, 0, 10); c.line(-3, 10, 3, 10)

def comp(tipo, p1, p2, ref, val="", lado=None):
    (x1, y1), (x2, y2) = p1, p2
    d = math.hypot(x2 - x1, y2 - y1)
    ux, uy = (x2 - x1) / d, (y2 - y1) / d
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    wire((x1, y1), (mx - ux * HB, my - uy * HB))
    wire((mx + ux * HB, my + uy * HB), (x2, y2))
    c.saveState(); c.translate(mx, my); c.rotate(math.degrees(math.atan2(uy, ux)))
    _simbolo(tipo); c.restoreState()
    vertical = abs(ux) < 0.5
    lado = lado or ("r" if vertical else "a")
    off = 19 if tipo in ("LED", "SW") else 11
    if "\n" in val and lado == "r":
        a, b = val.split("\n")
        txt(mx + off, my + 4, ref, 7, "Sans-B"); txt(mx + off, my - 4, a, 6.3, "Sans", k=TENUE)
        txt(mx + off, my - 11, b, 6.3, "Sans", k=TENUE)
    elif lado == "r":
        txt(mx + off, my + 1.5, ref, 7, "Sans-B"); txt(mx + off, my - 6.5, val, 6.3, "Sans", k=TENUE)
    elif lado == "l":
        txt(mx - 11, my + 1.5, ref, 7, "Sans-B", "r"); txt(mx - 11, my - 6.5, val, 6.3, "Sans", "r", TENUE)
    elif lado == "a":
        txt(mx, my + 10, ref, 7, "Sans-B", "c"); txt(mx, my - 15, val, 6.3, "Sans", "c", TENUE)
    elif lado == "b":
        txt(mx, my - 15, ref + ("  " + val if val else ""), 6.6, "Sans", "c")

def conector(x, y_top, pines, ref, titulo, ancho=34, paso=20, lado_pines="r"):
    """Caja de conector; los pines salen por la derecha (o izquierda). Devuelve dict n→(x,y)."""
    alto = paso * (len(pines) - 1) + 20
    col(TINTA); lw(1.0); c.setFillColor(colors.white)
    c.rect(x, y_top - alto, ancho, alto, stroke=1, fill=1)
    txt(x + ancho / 2, y_top + 13, ref, 7.2, "Sans-B", "c")
    txt(x + ancho / 2, y_top + 5, titulo, 6.0, "Sans", "c", TENUE)
    pos = {}
    for i, (n, nombre) in enumerate(pines):
        yy = y_top - 10 - paso * i
        if lado_pines == "r":
            xp = x + ancho; wire((xp, yy), (xp + 10, yy)); pos[n] = (xp + 10, yy)
            txt(x + 3, yy - 2.3, f"{n}", 6.2, "Mono-B"); txt(x + ancho - 3, yy - 2.3, nombre, 5.6, "Sans", "r", TENUE)
        else:
            xp = x; wire((xp, yy), (xp - 10, yy)); pos[n] = (xp - 10, yy)
            txt(x + ancho - 3, yy - 2.3, f"{n}", 6.2, "Mono-B", "r"); txt(x + 3, yy - 2.3, nombre, 5.6, "Sans", "l", TENUE)
    return pos

def bloque(x, y, w, h, titulo):
    col(MARCO); lw(0.7); c.setDash(4, 3)
    c.roundRect(x, y, w, h, 5, stroke=1, fill=0); c.setDash()
    txt(x + 8, y + h - 12, titulo, 7.6, "Sans-B", "l", TENUE)

# ── Marco y rótulo ──────────────────────────────────────────────────────────
col(TINTA); lw(1.2); c.rect(20, 20, W - 40, H - 40)

# ═══ Bloque A: entrada 12 V ═════════════════════════════════════════════════
bloque(34, 540, 440, 270, "A · ENTRADA 12 V (electroválvula)")
j1 = conector(52, 760, [(1, "+12V"), (2, "GND")], "J1", "bornera 5,08", ancho=40, paso=40)
y12 = j1[1][1]
comp("PTC", j1[1], (160, y12), "F1", "PTC 2 A hold")
comp("DS", (160, y12), (215, y12), "D1", "SS54")
wire((215, y12), (462, y12))
pwr(462, y12, "+12V")
gnd(*j1[2])
tp(200 + 25, y12, "TP1")
yg = 670
for x in (236, 280, 320, 360, 404): dot(x, y12)
comp("DZ", (236, yg), (236, y12), "D2", "SMBJ15A"); gnd(236, yg)
comp("CP", (280, y12), (280, yg), "C1", "470µ\n25 V"); gnd(280, yg)
comp("C", (320, y12), (320, yg), "C2", "100n"); gnd(320, yg)
comp("R", (360, y12), (360, 705), "R8", "4k7")
comp("LED", (360, 705), (360, yg), "LED1", "verde"); gnd(360, yg)
comp("R", (404, y12), (404, 705), "R11", "100k")
comp("R", (404, 705), (404, yg), "R12", "22k"); gnd(404, yg)
dot(404, 705); wire((404, 705), (452, 705)); dot(452, 705)
comp("C", (452, 705), (452, yg), "C9", "100n"); gnd(452, yg)
dot(432, 705); wire((432, 705), (432, 600))
net(432, 600, "SENSE12", "l")
tp(432, 630, "TP8", dx=6, dy=0)

# ═══ Bloque B: entrada 5 V ══════════════════════════════════════════════════
bloque(34, 300, 440, 225, "B · ENTRADA 5 V (lógica)")
j2 = conector(52, 480, [(1, "VBUS"), (2, "D−"), (3, "D+"), (4, "ID"), (5, "GND")], "J2", "micro-USB B", ancho=40, paso=16)
for n in (2, 3, 4): nc(*j2[n])
y5 = j2[1][1]
wire(j2[1], (115, y5))
comp("PTC", (115, y5), (175, y5), "F2", "PTC 1,1 A hold")
wire((175, y5), (320, y5))
tp(185, y5, "TP2")
yb5 = 365
for x in (200, 245, 290): dot(x, y5)
comp("DZ", (200, yb5), (200, y5), "D6", "SMAJ5.0A"); gnd(200, yb5)
comp("C", (245, y5), (245, yb5), "C3", "10µ"); gnd(245, yb5)
comp("R", (290, y5), (290, 425), "R9", "1k")
comp("LED", (290, 425), (290, yb5), "LED2", "verde"); gnd(290, yb5)
pwr(320, y5, "+5V_IN"); dot(320, y5)
comp("DS", (320, y5), (380, y5), "D3", "SS34")
wire((380, y5), (462, y5)); dot(410, y5)
comp("CP", (410, y5), (410, yb5), "C4", "100µ\n16 V"); gnd(410, yb5)
pwr(462, y5, "+5V_ESP")
gnd(j2[5][0] + 8, j2[5][1]); wire(j2[5], (j2[5][0] + 8, j2[5][1]))
txt(52, 372, "Carcasa de J2 a GND", 5.8, "Sans", k=TENUE)

# ═══ Bloque D: módulo ESP32 ═════════════════════════════════════════════════
bloque(490, 300, 290, 510, "U1 · MÓDULO ESP32")
bx, by, bw, bh = 560, 340, 140, 420
col(TINTA); lw(1.2); c.setFillColor(colors.HexColor("#eef2ef")); c.rect(bx, by, bw, bh, stroke=1, fill=1)
txt(bx + bw / 2, by + bh - 20, "U1", 9, "Sans-B", "c")
txt(bx + bw / 2, by + bh - 32, "NodeMCU ESP-32S v1.1", 6.8, "Sans", "c")
txt(bx + bw / 2, by + bh - 42, "zócalo 2 × 19, 2,54 mm", 6.0, "Sans", "c", TENUE)
txt(bx + bw / 2, by + 14, "Pos.: A/B = fila, n = desde el USB", 5.6, "Sans", "c", TENUE)
izq = [("5V", "A1", "+5V_ESP"), ("3V3", "A19", "+3V3"), ("GND", "B13", "GND"), ("GND", "B19", "GND"),
       ("EN", "A18", "EN"), ("GPIO36", "A17", "SENSE12")]
der = [("GPIO26", "A10", "GATE_DRV"), ("GPIO27", "A9", "FLOW"), ("GPIO14", "A8", "CFG"), ("GPIO2", "B5", "SRV"),
       ("GPIO5", "B10", "SPI_SDA"), ("GPIO18", "B11", "SPI_SCK"), ("GPIO23", "B18", "SPI_MOSI"),
       ("GPIO19", "B12", "SPI_MISO"), ("GPIO22", "B17", "SPI_RST")]
for i, (pin, posn, red) in enumerate(izq):
    yy = by + bh - 70 - i * 34
    wire((bx, yy), (bx - 22, yy))
    txt(bx + 4, yy - 2.4, pin, 6.6, "Mono-B"); txt(bx - 3, yy + 3, posn, 5.6, "Mono", "r", TENUE)
    if red == "GND":
        gnd(bx - 22, yy)
    elif red == "+3V3":
        pwr(bx - 22, yy, "+3V3")
    else:
        net(bx - 22, yy, red, "l")
for i, (pin, posn, red) in enumerate(der):
    yy = by + bh - 70 - i * 34
    wire((bx + bw, yy), (bx + bw + 22, yy))
    txt(bx + bw - 4, yy - 2.4, pin, 6.6, "Mono-B", "r"); txt(bx + bw + 3, yy + 3, posn, 5.6, "Mono", "l", TENUE)
    net(bx + bw + 22, yy, red, "r")
txt(bx + bw / 2, by - 16, "No conectar: GPIO0, GPIO12, GPIO15, GPIO6–11", 6, "Sans", "c", TENUE)

# ═══ Bloque E: driver de electroválvula ═════════════════════════════════════
bloque(800, 540, 356, 270, "E · DRIVER ELECTROVÁLVULA")
yv, yn = 750, 690
pwr(880, yv, "+12V")
wire((880, yv), (1060, yv))
dot(960, yv); dot(1010, yv)
wire((880, yn), (1060, yn))
dot(960, yn); dot(1010, yn); dot(880, yn)
comp("R", (960, yv), (960, 720), "R6", "4k7", "l")
comp("LED", (960, 720), (960, yn), "LED3", "ámbar VÁLV.", "l")
comp("D", (1010, yn), (1010, yv), "D4", "S1M")
j3 = conector(1070, 760, [(1, "+"), (2, "−")], "J3", "bornera 5,08", ancho=34, paso=60, lado_pines="l")
wire((1060, yv), j3[1]); wire((1060, yn), j3[2])
# electroválvula externa
col(TENUE); lw(0.8); c.setDash(3, 2)
c.rect(1112, 690, 34, 60, stroke=1, fill=0); c.setDash()
for k in range(4):
    c.arc(1122, 700 + k * 11, 1136, 711 + k * 11, -90, 180)
txt(1129, 680, "EV 12 V DC", 5.8, "Sans", "c", TENUE); txt(1129, 672, "(externa)", 5.6, "Sans", "c", TENUE)
wire((1104, 750), (1112, 750)); wire((1104, 690), (1112, 690))
# Q1 NMOS: drenador arriba (880, yn), fuente abajo
xq, yg = 880, 645
col(TINTA); lw(0.9)
wire((xq, yn), (xq, 665), (xq - 12, 665))
wire((xq, 610), (xq, 625), (xq - 12, 625))
lw(1.3)
for y0 in (660, 642, 624):
    c.line(xq - 12, y0 - 4, xq - 12, y0 + 6)
lw(1.3); c.line(xq - 18, 626, xq - 18, 664)
lw(0.9); wire((xq - 12, 645), (xq, 645), (xq, 625))
p = c.beginPath(); p.moveTo(xq - 12, 645); p.lineTo(xq - 6, 648); p.lineTo(xq - 6, 642); p.close()
c.setFillColor(TINTA); c.drawPath(p, stroke=1, fill=1)
wire((xq - 18, yg), (xq - 32, yg))
gnd(xq, 610)
txt(xq + 8, 650, "Q1", 7, "Sans-B"); txt(xq + 8, 642, "AO3400A", 6.3, "Sans", k=TENUE)
txt(xq + 3, 668, "D", 5.6, "Sans", k=TENUE); txt(xq + 3, 616, "S", 5.6, "Sans", k=TENUE); txt(xq - 24, yg + 3, "G", 5.6, "Sans", k=TENUE)
comp("R", (xq - 32 - 60, yg), (xq - 32, yg), "R1", "100")
dot(xq - 40, yg)
comp("R", (xq - 40, yg), (xq - 40, 585), "R2", "10k", "l"); gnd(xq - 40, 585)
net(xq - 92, yg, "GATE_DRV", "l")
tp(xq - 92, yg, "TP6", dx=0, dy=12)
txt(812, 560, "R2 mantiene Q1 abierto con GPIO26 en alta impedancia (válvula cerrada).", 5.8, "Sans", "l", TENUE)

# ═══ Bloque F: HMI ═════════════════════════════════════════════════════════
bloque(800, 300, 356, 225, "F · PULSADORES Y SEÑALIZACIÓN")
# CFG
xc, ycfg = 850, 420
pwr(xc, 475, "+3V3")
comp("R", (xc, 475), (xc, ycfg), "R5", "10k", "l")
dot(xc, ycfg)
net(xc - 10, ycfg, "CFG", "l"); wire((xc - 10, ycfg), (xc, ycfg))
comp("C", (xc, ycfg), (xc, 360), "C7", "100n", "l"); gnd(xc, 360)
comp("R", (xc, ycfg), (xc + 60, ycfg), "R10", "1k")
comp("SW", (xc + 60, ycfg), (xc + 60, 360), "SW1", "CONFIG"); gnd(xc + 60, 360)
# EN
xe = 985
net(xe - 10, ycfg, "EN", "l"); wire((xe - 10, ycfg), (xe, ycfg))
comp("SW", (xe, ycfg), (xe, 360), "SW2", "RESET (opc.)"); gnd(xe, 360)
# SRV
xs = 1040
net(xs - 18, ycfg, "SRV", "l"); wire((xs - 18, ycfg), (xs - 10, ycfg))
comp("R", (xs - 10, ycfg), (xs + 50, ycfg), "R7", "470")
comp("LED", (xs + 50, ycfg), (xs + 50, 360), "LED4", "SERVICIO"); gnd(xs + 50, 360)

# ═══ Bloque C: entrada del caudalímetro ═════════════════════════════════════
bloque(34, 40, 560, 245, "C · ENTRADA CAUDALÍMETRO")
j4 = conector(52, 205, [(1, "V+ ROJO"), (2, "GND NEGRO"), (3, "SEÑ. AMAR.")], "J4", "bornera 3 p.", ancho=58, paso=30)
ys = j4[3][1]
gnd(j4[2][0] + 8, j4[2][1]); wire(j4[2], (j4[2][0] + 8, j4[2][1]))
yvs = 232
wire(j4[1], (140, j4[1][1]), (140, yvs), (320, yvs))
dot(140, yvs); dot(160, yvs); dot(260, yvs); dot(320, yvs)
txt(172, yvs + 4, "VSENSOR", 6.3, "Mono-B", k=RED)
col(TINTA); lw(0.9)
for i, x in enumerate((300, 320, 340)):
    c.setFillColor(colors.white); c.rect(x - 4, 244, 8, 8, stroke=1, fill=1)
    txt(x, 255, str(i + 1), 5.6, "Mono-B", "c")
lw(2.2); c.line(304, 248, 316, 248)
wire((320, 244), (320, yvs))
wire((296, 248), (282, 248), (282, 256)); pwr(282, 256, "+5V_IN")
wire((344, 248), (360, 248), (360, 256)); pwr(360, 256, "+3V3")
txt(372, 238, "JP1 (1-2 cerrado)", 5.8, "Sans", "l", TENUE)
comp("C", (160, yvs), (160, 190), "C8", "100n", "l"); gnd(160, 190)
wire(j4[3], (275, ys))
dot(200, ys); dot(260, ys)
comp("R", (260, yvs), (260, ys), "R3", "10k")
comp("DZ", (200, ys - 60), (200, ys), "D5", "ESD 5V", "l"); gnd(200, ys - 60)
comp("R", (275, ys), (335, ys), "R4", "1k")
wire((335, ys), (400, ys)); dot(355, ys)
comp("C", (355, ys), (355, ys - 60), "C5", "4n7", "l"); gnd(355, ys - 60)
ux0, ux1 = 400, 450
col(TINTA); lw(1.1)
p = c.beginPath(); p.moveTo(ux0, ys - 22); p.lineTo(ux0, ys + 22); p.lineTo(ux1, ys); p.close()
c.setFillColor(colors.white); c.drawPath(p, stroke=1, fill=1)
lw(0.7)
c.line(410, ys - 4, 418, ys - 4); c.line(418, ys - 4, 418, ys + 4); c.line(414, ys + 4, 422, ys + 4); c.line(414, ys - 4, 414, ys + 4)
txt(ux0 + 2, ys + 26, "U2  74LVC1G17", 6.8, "Sans-B")
txt(ux0 - 7, ys + 2, "2", 5.6, "Mono", "r", TENUE); txt(ux1 + 3, ys + 3, "4", 5.6, "Mono", k=TENUE)
wire((420, ys + 12), (420, 205)); txt(423, ys + 16, "5", 5.6, "Mono", k=TENUE)
wire((420, ys - 12), (420, ys - 38)); txt(423, ys - 20, "3", 5.6, "Mono", k=TENUE); gnd(420, ys - 38)
wire((420, 205), (480, 205)); dot(420, 205); pwr(420, 205, "+3V3")
tp(450, 205, "TP3")
comp("C", (480, 205), (480, 170), "C6", "100n ≤3 mm"); gnd(480, 170)
wire((ux1, ys), (520, ys)); net(520, ys, "FLOW", "r")
tp(500, ys, "TP7", dx=0, dy=-18)
txt(46, 52, "Filtro: bajada τ = 4,7 µs · subida hasta umbral ≈ 26 µs · fc ≈ 34 kHz · f máx. del sensor 1,5 kHz", 5.8, "Sans", "l", TENUE)

# ═══ Bloque G: J5 y notas ═══════════════════════════════════════════════════
bloque(610, 40, 166, 245, "G · LECTOR RFID (NM)")
j5 = conector(630, 240, [(1, "SDA"), (2, "SCK"), (3, "MOSI"), (4, "MISO"), (5, "IRQ"), (6, "GND"),
                         (7, "RST"), (8, "3V3")], "J5", "1×8 2,54 · NM", ancho=40, paso=22)
for n, red in [(1, "SPI_SDA"), (2, "SPI_SCK"), (3, "SPI_MOSI"), (4, "SPI_MISO"), (7, "SPI_RST")]:
    net(j5[n][0], j5[n][1], red, "r")
nc(*j5[5]); gnd(j5[6][0] + 8, j5[6][1]); wire(j5[6], (j5[6][0] + 8, j5[6][1]))
wire(j5[8], (j5[8][0] + 62, j5[8][1])); pwr(j5[8][0] + 62, j5[8][1], "+3V3")

# notas
bloque(800, 150, 356, 135, "NOTAS")
notas = [
    "1. Redes con el mismo nombre están unidas. Todas las masas son una sola red; las de 12 V y 5 V",
    "    se unen en un único punto junto a J1.",
    "2. Referencias y redes según GRIFO-HW-001 Rev A, sección 7.",
    "3. D4 a menos de 10 mm de J3. Lazo J3 → Q1 → GND → J1 mínimo.",
    "4. D5, R3, R4, C5 y U2 junto a J4. C4 junto al pin 5V de U1.",
    "5. NM = no montar. JP1 de fábrica en 1-2 (VSENSOR = 5 V).",
    "6. LED4: V_F ≤ 2,2 V (no azul). R11/R12 al 1 %.",
    "7. Mando de válvula activo alto (GPIO26 = 1 → válvula energizada).",
]
for i, s in enumerate(notas):
    txt(810, 258 - i * 12, s, 6.3, "Sans")

# rótulo
col(TINTA); lw(1.0); c.setFillColor(colors.white)
c.rect(800, 40, 356, 100, stroke=1, fill=1)
c.line(800, 100, 1156, 100); c.line(800, 70, 1156, 70); c.line(1000, 40, 1000, 100); c.line(1080, 40, 1080, 70)
txt(810, 120, "PCB controladora de canilla GRIFO", 11, "Sans-B")
txt(810, 106, "Esquemático eléctrico", 7.5, "Sans", k=TENUE)
txt(810, 88, "Documento", 5.8, "Sans", k=TENUE); txt(810, 77, "GRIFO-HW-001", 8.5, "Mono-B")
txt(1010, 88, "Revisión", 5.8, "Sans", k=TENUE); txt(1010, 77, "A", 8.5, "Mono-B")
txt(810, 58, "Fecha", 5.8, "Sans", k=TENUE); txt(810, 47, "28/09/2026", 8, "Mono-B")
txt(1010, 58, "Hoja", 5.8, "Sans", k=TENUE); txt(1010, 47, "1 / 1", 8, "Mono-B")
txt(1090, 58, "Formato", 5.8, "Sans", k=TENUE); txt(1090, 47, "A3", 8, "Mono-B")

c.showPage(); c.save()
print("OK", SALIDA)
