# Cableado completo del sistema

Todo junto: lector, caudalímetro, relé, botón y válvula. Es el cableado de la
etapa 6 en adelante, con el ESP32 **clavado al protoboard**.

### La válvula solenoide

Ya va conectada. Sus dos cables (soldados a las patitas metálicas con las que
vino) van a los bornes de salida del relé:

| Válvula | → | Dónde |
|---|---|---|
| un cable | → | `COM` del relé |
| el otro | → | positivo de la fuente de 12 V |
| `NO` y `NC` | | quedan **vacíos** |

⚠️ **Falta el diodo 1N4007** en paralelo con la bobina de la válvula, con la
banda hacia el positivo. Sin él, cada vez que el relé corta, la bobina devuelve
un pico de tensión que castiga los contactos. Es la trampa 7 de
[`pinout-y-trampas.md`](pinout-y-trampas.md), y no es opcional antes del bar.

---

## Antes de tocar nada

Leé [`protocolo-electrico.md`](protocolo-electrico.md). Las dos que más importan:

- **Cable de masa fijo** atornillado en `DC-`, y su punta libre en `B33`. La
  punta negra del tester va a `A33`, que se deja libre justamente para eso.
  Nunca a la bornera.
- **El `DC+` tapado con cinta.** No se toca con nada.

Y el orden de siempre: cambio de cable = **las dos fuentes desenchufadas**.
Encender es 12 V primero y USB después; apagar al revés.

---

## Por qué el caudalímetro sale del conversor

Quedó un conflicto abierto en la etapa 4:

| Pieza | Qué necesita del riel `HV` |
|---|---|
| Relé | que esté **desconectado** — a 5 V su pull-up de 10k deja el relé pegado |
| Caudalímetro | que esté **a 5 V** — de ahí sacaba su pull-up |

Y hay un tercer problema si los dos comparten el conversor con el riel suelto:
adentro de la plaquita los cuatro canales comparten ese riel a través de sus
resistencias de 10k. Con `HV4` a 11,3 V por el relé, esa tensión se filtra por
`HV4 → 10k → riel → 10k → HV1` y le llegan unos **11 V a la pata de señal del
sensor**, que está alimentado a 5. La corriente es chica, pero no es un lugar
donde queramos estar.

**La salida: alimentar el caudalímetro con 3,3 V.** Si anda, su señal nunca pasa
de 3,3 V y va **directo al ESP32**, sin conversor. El conversor queda para el
relé solo y el conflicto desaparece.

> Es bajar el privilegio del componente en vez de construir una barrera para
> contenerlo. Si no puede generar el valor peligroso, no hace falta filtrarlo.

**Si a 3,3 V el sensor no cuenta**, el plan B es un transistor NPN para el relé
(`2N2222`/`BC547` + una resistencia de 1k, monedas) y el conversor vuelve a ser
del caudalímetro con el riel a 5 V. El esquema está en
[`etapa-04-rele.md`](etapa-04-rele.md).

---

## El ESP32 va clavado al protoboard

Al principio estaba suelto y todo iba con cables macho-hembra directo a los
pines. Ahora está clavado: los pines quedaron en las columnas **`B`** (izquierda)
y **`I`** (derecha), y las columnas libres son **`A`** y **`J`**.

| Fila | `B` (izq) | `I` (der) |
|---|---|---|
| 40 | `GND` | `3V3` |
| 41 | `P23` | `EN` |
| 42 | `P22` | `P36` |
| 46 | `GND` | `P32` |
| 47 | `P19` | `P33` |
| 48 | `P18` | `P25` |
| 49 | `P5` | `P26` |
| 50 | `P17` | `P27` |
| 51 | `P16` | `P14` |
| 58 | `CLK` | `5V` |

**Para verificar que estás leyendo bien las filas:** el hueco `J` enfrente de
`B40` tiene que ser el pin que dice `3V3`. Si eso da, el resto cae solo.

---

## Los dos buses: filas 5 y 10

Cada fila tiene **un solo hueco libre**, pero el `3V3` y el `GND` los necesitan
cuatro cosas cada uno. La salida es repartirlos.

Los cinco huecos de una fila están unidos por abajo, así que un cable
macho-macho desde el pin hasta una fila vacía convierte esa fila en una regleta.

```
  J40 ──────cable──────> A5
                          │
                   (unidos por abajo)
                          │
                    B5  C5  D5  E5   ← tres tomas más de 3,3 V
```

> Es exportar una constante una vez e importarla donde la necesites, en lugar de
> repetir el valor.

| Cable macho-macho | Deja |
|---|---|
| `J40` → `A5` | **fila 5 = bus de 3,3 V** |
| `A40` → `A10` | **fila 10 = bus de GND** |

### Qué cuelga de cada bus

| Fila 5 — **3,3 V** | | Fila 10 — **GND** | |
|---|---|---|---|
| `A5` | viene de `J40` | `A10` | viene de `A40` |
| `B5` | → `H32` (riel `LV` del conversor) | `B10` | → `C33` (masa del conversor) |
| `C5` | `3.3V` del lector | `C10` | `GND` del lector |
| `D5` | rojo del caudalímetro | `D10` | negro del caudalímetro |
| | | `E10` | una punta del botón |

---

## La lista completa

### Lector RFID — MFRC522

Es un chip de 3,3 V. Va **directo**, sin conversor.

| Pin del lector | → | Hueco | (pin del ESP32) |
|---|---|---|---|
| `SDA` / `SS` | → | `A49` | `P5` |
| `SCK` | → | `A48` | `P18` |
| `MOSI` | → | `A41` | `P23` |
| `MISO` | → | `A47` | `P19` |
| `RST` | → | `A42` | `P22` |
| `3.3V` | → | `C5` | bus |
| `GND` | → | `C10` | bus |

⚠️ **Con 5 V se quema.** No hay vuelta atrás con eso.

📏 **No más de 20-30 cm** de cable: el SPI no tolera cables largos. Por eso la
caja del ESP32 vive dentro de la columna de la canilla.

### Caudalímetro

| Cable | → | Hueco | |
|---|---|---|---|
| rojo | → | `D5` | **3,3 V**, *no 5 V* |
| negro | → | `D10` | GND |
| amarillo | → | `J50` | `P27`, directo y sin conversor |

El pull-up lo pone el ESP32 por dentro (`caudalIniciar(true)` en el firmware).

### Relé y conversor — todos macho-macho

| Desde | → | Hasta |
|---|---|---|
| `J49` (`P26`) | → | `G35` (`LV4`) |
| `B5` (bus 3,3 V) | → | `H32` (riel `LV`) |
| `B10` (bus GND) | → | `C33` (masa del conversor) |
| `IN` del relé | → | `C35` (`HV4`) |
| `DC-` del relé | → | `B33` |
| `DC+` del relé | → | positivo de la fuente de 12 V, **tapado con cinta** |

**Jumper del relé en `L`.**

🚫 **El riel `HV` (`A32`/`B32`/`C32`) queda VACÍO.** Si le ponés los 5 V, el relé
se activa y no suelta nunca. Es el bug que nos costó media etapa encontrar, y
desde afuera parece que el firmware no corta.

Ojo con esto: `H32` (que sí lleva 3,3 V) y `B32` están **en la misma fila pero de
lados distintos del canal**. Son dos nodos separados. Un agujero de diferencia
entre "anda" y "el relé queda trabado".

### Botón — ya no se usa para servir

`ABRIR_CON_LA_TARJETA = true` en `main.cpp`: **la válvula abre sola mientras la
tarjeta esté apoyada** y cierra al retirarla. El botón dejó de participar de la
venta.

Lo que se gana es que no hay nada que aprender: el cliente apoya la tarjeta y
sale cerveza. Lo que se pierde es el segundo consentimiento — con botón hacían
falta **dos** acciones deliberadas para que saliera líquido; ahora una tarjeta
apoyada de casualidad abre la canilla igual. Los frenos que quedan son el límite
de saldo y los 90 s de apertura máxima.

> Es el `confirm()` antes de la acción destructiva. Sacarlo hace la interfaz más
> rápida, y también más fácil de disparar sin querer.

**El pin sigue conectado**, porque al arrancar es lo que pide el portal:

| Punta | Hueco |
|---|---|
| una | `E10` (bus de GND) |
| la otra | `J51` (`P14`) |

Para entrar al portal: enchufar con el cable puesto en `J51`, esperar 3 s, y
**sacarlo**. El portal se confirma al soltar, no al apretar — si el cable queda
puesto, el firmware lo toma por un contacto trabado y arranca normal.

En operación normal **ese cable va afuera**.

Para volver al modo con botón, `ABRIR_CON_LA_TARJETA = false` y recompilar.

---

## Checklist en frío

Con **nada enchufado**, tester en `Ω` escala `200`. Todo tiene que dar `1`
(abierto):

| Puntas en | |
|---|---|
| `H32` y `A33` | riel 3,3 V contra masa |
| `B32` y `A33` | riel HV contra masa |
| `B5` y `B10` | los dos buses entre sí |
| `B32` y `H32` | los dos rieles entre sí |
| `DC+` y `DC-` | la fuente de 12V |

Si alguna da `0`, **no se enchufa nada** hasta entenderlo.

---

## Probar

```bash
cd ~/GRIFO && git pull && pio run -e etapa6_red -t upload
```

Con los **12 V desenchufados** mientras se graba. Después los enchufás y abrís
el monitor.

Los criterios están en [`etapa-05-maquina.md`](etapa-05-maquina.md). El que
decide lo del caudalímetro a 3,3 V:

**Soplá por la entrada del sensor.** Si los pulsos suben, anda a 3,3 V y el
cableado queda así para siempre. Si no sube ninguno, hace falta el transistor.
