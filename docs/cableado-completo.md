# Cableado completo del sistema

Todo junto: lector, caudalímetro, relé y botón. Es el cableado de la etapa 5 en
adelante.

**La válvula sigue sin conectarse.** Los bornes de salida del relé quedan al
aire hasta la etapa 7.

---

## Antes de tocar nada

Leé [`protocolo-electrico.md`](protocolo-electrico.md). Las dos que más importan:

- **Cable de masa fijo** atornillado en `DC-`, y su punta libre en `B33`. La
  punta negra del tester va a `A33` o `C33`, nunca a la bornera.
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

## La lista

El ESP32 está suelto (no clavado al protoboard), así que casi todo va con cables
**macho-hembra**: la hembra calza sobre el pin, el macho va al protoboard o al
componente.

### Lector RFID — MFRC522

Es un chip de 3,3 V. Va **directo**, sin conversor.

| Pin del lector | → | ESP32 |
|---|---|---|
| `SDA` / `SS` | → | `P5` |
| `SCK` | → | `P18` |
| `MOSI` | → | `P23` |
| `MISO` | → | `P19` |
| `RST` | → | `P22` |
| `3.3V` | → | `3V3` |
| `GND` | → | `GND` |

⚠️ **Con 5 V se quema.** No hay vuelta atrás con eso.

📏 **No más de 20-30 cm** entre el ESP32 y el lector: el SPI no tolera cables
largos. Por eso la caja del ESP32 vive dentro de la columna de la canilla.

### Caudalímetro

| Cable | → | Adónde |
|---|---|---|
| rojo | → | **`3V3`** del ESP32 ← *no 5V* |
| negro | → | `GND` |
| amarillo | → | **`P27`** directo, sin pasar por el conversor |

El pull-up lo pone el ESP32 por dentro (`caudalIniciar(true)` en el firmware).

### Relé — por el canal 4 del conversor

| Desde | → | Hasta |
|---|---|---|
| `DC+` del relé | → | positivo de la fuente de 12V (y tapado con cinta) |
| `DC-` del relé | → | negativo de la fuente **y** a `B33` |
| `IN` del relé | → | **`C35`** (`HV4`) |
| `P26` del ESP32 | → | **`G35`** (`LV4`) |
| `3V3` del ESP32 | → | **`H32`** (riel `LV` del conversor) |
| `GND` del ESP32 | → | **`A33`** |

**Jumper del relé en `L`.**

🚫 **El riel `HV` (`A32`/`B32`/`C32`) queda VACÍO.** Si le ponés los 5 V, el relé
se activa y no suelta nunca. Es el bug que nos costó media etapa encontrar.

### Botón

| Desde | → | Hasta |
|---|---|---|
| una pata | → | `P14` |
| la otra | → | `GND` |

Si no hay botón, un cable macho-macho hace lo mismo: tocar es apretar.

---

## Mapa del conversor en este protoboard

Las patitas están en la columna **`d`** (lado HV) y **`f`** (lado LV). El cuerpo
de la plaquita tapa la `e`.

| Fila | Patita HV | Patita LV | Uso ahora |
|---|---|---|---|
| 30 | `HV1` `D30` | `LV1` `F30` | **libre** (era el caudalímetro) |
| 31 | `HV2` `D31` | `LV2` `F31` | libre |
| 32 | `HV` `D32` | `LV` `F32` | `HV` **vacío** · `LV` = 3,3 V |
| 33 | `GND` `D33` | `GND` `F33` | masa común |
| 34 | `HV3` `D34` | `LV3` `F34` | libre |
| 35 | `HV4` `D35` | `LV4` `F35` | **relé** |

**Huecos libres:** `a`, `b`, `c` del lado HV · `g`, `h`, `i`, `j` del lado LV.

---

## Checklist en frío

Con **nada enchufado**, tester en `Ω` escala `200`. Todo tiene que dar `1`
(abierto):

| Puntas en | |
|---|---|
| `H32` y `A33` | riel 3,3 V contra masa |
| `B32` y `A33` | riel HV contra masa |
| `B32` y `H32` | los dos rieles entre sí |
| `DC+` y `DC-` | la fuente de 12V |

Si alguna da `0`, **no se enchufa nada** hasta entenderlo.

---

## Probar

```bash
cd ~/GRIFO && git pull && pio run -e etapa5_maquina -t upload
```

Con los **12 V desenchufados** mientras se graba. Después los enchufás y abrís
el monitor.

Los criterios están en [`etapa-05-maquina.md`](etapa-05-maquina.md). El que
decide lo del caudalímetro a 3,3 V:

**Soplá por la entrada del sensor.** Si los pulsos suben, anda a 3,3 V y el
cableado queda así para siempre. Si no sube ninguno, hace falta el transistor.
