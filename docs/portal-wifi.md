# El portal de configuración — cambiar el WiFi sin notebook

## El problema

El WiFi estaba clavado en `secrets.h`, o sea **adentro del binario**. Cambiar de
red significaba: abrir la notebook, editar el archivo, compilar, desenchufar los
12 V, flashear, volver a enchufar.

En el bar eso no existe. La canilla va a estar atornillada abajo de una barra y
el WiFi lo va a cambiar alguien que no programa.

> Es sacar la config del bundle y ponerla en variables de entorno. Lo que cambia
> por instalación no puede estar compilado adentro.

## El huevo y la gallina

"Configurar el WiFi desde la app" choca con algo que no tiene vuelta:
**la app viaja por WiFi**. Si la canilla no está conectada, no hay por dónde
mandarle nada.

La salida es que la canilla **deje de ser cliente y pase a ser el router**:
levanta su propia red, te conectás con el celular y configurás desde ahí.

> Es el wizard de un router nuevo, o el modo recovery de un sistema operativo:
> cuando la vía normal no está, el aparato levanta una vía mínima que no depende
> de nada de afuera.

## Cómo se usa

1. **Desenchufá y volvé a enchufar** la canilla con el botón apretado.
2. Mantenelo **3 segundos**. El LED parpadea mientras cuenta.
3. Soltá. En el monitor sale el recuadro del portal.
4. Con el celular, conectate a la red **`GRIFO-1`** (la clave está en
   `secrets.h`, `PORTAL_PASS`).
5. Se abre sola una página. Si no, entrá a `http://192.168.4.1`.
6. Elegí la red del bar, poné la clave, **Guardar y conectar**.
7. La canilla se reinicia sola y arranca en la red nueva.

## Los tres momentos en que arranca solo

| Situación | Qué hace |
|---|---|
| Canilla nueva, sin nada guardado | Portal |
| Red guardada que no conecta, **y hay red anterior** | Vuelve a la anterior y reinicia |
| Red guardada que no conecta, **sin red anterior** | Portal |

## El rollback: lo que evita dejar la canilla muerta

Si guardás una red nueva y le errás una letra a la clave, la canilla quedaría
incomunicada y sin forma de arreglarla salvo yendo hasta ahí.

Por eso **la red nueva entra a prueba**: se guarda la anterior al lado, y si la
nueva no conecta en 20 segundos, el firmware vuelve solo a la que andaba.

> Es un deploy con rollback automático. Nadie manda a producción algo que no
> sabe deshacer, y "cambiar el WiFi de un aparato al que no llegás" es
> exactamente eso.

Detalle que importa: el respaldo **solo se toma de una red que ya demostró que
anda**. Si ya estábamos probando una, la actual es la sospechosa — copiarla
arriba del respaldo sería tirar la única red buena que queda.

## Qué NO se puede hacer desde el portal

No se ve ni se cambia el token de la canilla. El portal es una red al alcance de
cualquiera que pase cerca: lo único que se puede hacer desde ahí es lo mínimo
para que vuelva a haber red.

> Menor privilegio aplicado a una pantalla de rescate.

Y si nadie lo usa en **10 minutos**, la canilla se reinicia y vuelve a
intentarle a la red guardada — para no quedar transmitiendo una red de
configuración toda la noche.

## Dónde vive cada cosa

| Archivo | Qué hace |
|---|---|
| `src/etapa6_red/ajustes.h/.cpp` | Guarda el WiFi en NVS. Los dos pares y el rollback. |
| `src/etapa6_red/portal.h/.cpp` | El access point, el DNS y la página. |
| `src/etapa6_red/red.cpp` | Decide cuándo conectar, cuándo revertir y cuándo abrir el portal. |

El `secrets.h` pasa a ser el **valor de fábrica**: la primera vez se copia a
NVS, y de ahí en adelante manda NVS. El equipo que ya anda sigue andando sin
tocar nada.

## Prueba de aceptación

1. Arrancá normal. Tiene que conectar como siempre y decir
   `[red] WiFi conectado a "TP-LINK_E64C"`.
2. Reiniciá con el botón apretado 3 s. Tiene que salir el recuadro del portal.
3. Conectate con el celular a `GRIFO-1`. La página se abre sola y **lista las
   redes de tu casa**.
4. Guardá **una clave mal a propósito**. Tiene que reiniciar, no conectar, y
   volver sola a la red anterior.
5. Guardá la clave bien. Tiene que quedar andando.

El punto 4 es el que importa. Si eso funciona, cambiar el WiFi dejó de ser una
operación riesgosa.
