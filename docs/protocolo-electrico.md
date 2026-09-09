# Protocolo eléctrico

Reglas que valen para **todas** las etapas de acá en adelante.

Existen porque en la etapa 4 se quemó un ESP32. No fue mala suerte ni mal pulso:
el procedimiento pedía acertarle con una punta suelta a un tornillo que estaba a
un centímetro de otro con 12 V, y pedirlo varias veces seguidas. Un procedimiento
que solo funciona si nadie se equivoca nunca **es un procedimiento roto**.

> En software no se confía en que nadie mande `undefined`. Se valida en el borde.
> Acá es igual: no se confía en la puntería, se saca el peligro del alcance.

---

## Las seis reglas

### 1. Nunca hay manos en el circuito con los 12 V enchufados

Cambiar un cable, mover un jumper, apretar un tornillo: **la fuente de 12 V sale
de la pared primero**. Siempre. Sin excepciones y sin "es un segundito".

### 2. El `DC+` no se toca con nada, nunca

Es el único punto del proyecto que puede matar una placa de un roce.

Una vez atornillado su cable, **tapalo con cinta** (aisladora, o teflón, o papel
y cinta de papel — cualquier cosa que impida un contacto accidental). Si no se
puede tocar, no se puede tocar por error.

### 3. Hay un cable de masa fijo, y es el único que se usa

Atornillá un cable macho-macho **de forma permanente** en el borne `DC-`.

Esa punta libre es **la única** que se usa para todos los tests de "tocar contra
masa". La mano no vuelve a acercarse a la bornera.

También sirve de punto para la punta negra del tester.

### 4. Las puntas nunca van del lado del ESP32

El conversor de niveles divide el mundo en dos:

| Lado | Qué hay | Se puede tocar |
|---|---|---|
| **HV** (`a`-`e`, columnas del lado del relé) | hasta 12 V | sí, con el cable de masa fijo |
| **LV** (`f`-`j`, lado del ESP32) | máximo 3,3 V | **no**, salvo la medición de verificación |

Todo test manual va del lado **HV**, y con el ESP32 **desconectado** del canal.

La única medición permitida del lado LV es la de verificación (punta roja en el
hueco LV, punta negra en el cable de masa fijo), y se hace con el `P26`
**todavía sin conectar**.

Del lado LV, la fuente de 12 V no tiene por qué llegar nunca. Si llegó, se quemó
algo.

### 5. Se flashea con los 12 V desenchufados

Un intento de flasheo con la fuente puesta se cortó a la mitad:
`The chip stopped responding`.

Grabar la placa y alimentar el relé no necesitan pasar al mismo tiempo. Primero
se graba con solo el USB, después se enchufan los 12 V.

### 6. Antes de dar energía, se mide en frío

Con **todo desenchufado** (sin USB y sin 12 V) no hay forma de romper nada. Ese
es el momento de revisar. Ver el checklist de abajo.

---

## Checklist en frío

Con **nada enchufado**. Tester en `Ω`, escala `200`.

| Puntas en | Esperado | Si da distinto |
|---|---|---|
| riel `3V3` y `GND` | abierto (`1`) | hay un corto: no enchufar |
| riel `5V` y `GND` | abierto (`1`) | hay un corto: no enchufar |
| riel `3V3` y riel `5V` | abierto (`1`) | los rieles están unidos: no enchufar |
| `DC+` y `DC-` del relé | abierto (`1`) | corto en la fuente: no enchufar |
| hueco `LV` del canal y `GND` | abierto (`1`) | — |

`1` en el display quiere decir "fuera de escala", o sea **circuito abierto**, que
es lo que queremos. Un `0` quiere decir unido.

Si algo da unido cuando no debería, **no se enchufa nada** hasta entenderlo.

---

## Orden de energizado

Siempre este, en los dos sentidos:

**Encender:** 12 V → después USB
**Apagar:** USB → después 12 V

Y cualquier cambio de cable: **los dos apagados**.

---

## Si un paso parece pedir algo raro

Si una instrucción te hace acercar una punta al `DC+`, o tocar el lado LV con
los 12 V puestos, **el paso está mal escrito**. Pará y preguntá.

Eso no es prudencia de más: es exactamente lo que pasó.
