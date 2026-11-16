# Cargar saldo con Mercado Pago

El cliente elige un monto en su app, paga en Mercado Pago y el saldo se acredita
solo. La parte que habla con Mercado Pago es una **función del servidor** en
Supabase (`supabase/functions/mercadopago`): es la única que conoce la
credencial del bar.

> **Nunca se acredita por lo que dice el que avisa.** Ni la app ("ya pagué") ni
> el aviso de Mercado Pago mueven plata: la función le pregunta a Mercado Pago
> por ese pago con la credencial del bar, y acredita lo que Mercado Pago
> contesta. Y cada pago se acredita una sola vez, aunque el aviso llegue diez.

Hasta que no se haga esto, la app dice "la carga con Mercado Pago todavía no
está activada" y todo lo demás (QR, caja, tickets) funciona igual.

## Con SEN POS

SEN POS tiene su propia carga con Mercado Pago para **su** app (`/billetera`,
funciones `mp-preferencia` y `mp-webhook`). Las dos pueden convivir con la misma
cuenta de Mercado Pago: cada una reconoce solo sus pagos por la referencia y
ignora los de la otra, y las dos acreditan en la misma billetera.

Lo que conviene decidir es **cuál app usan los clientes**: la de canillas (entra
con nombre y DNI, sin contraseña) o la del POS (email y clave, y además pide
comida). Si queda solo la del POS, esta función no hace falta.

## Paso 1 — La base

Correr `supabase/31-mercadopago.sql` en el editor SQL (después de `29-qr.sql`).

## Paso 2 — La credencial de Mercado Pago

1. Entrar a <https://www.mercadopago.com.ar/developers/panel> con la cuenta
   **del bar** (la que va a recibir la plata).
2. **Crear aplicación** → tipo de pago: *Pagos online* → producto: *Checkout Pro*.
3. En la aplicación, **Credenciales de producción** → copiar el **Access Token**
   (empieza con `APP_USR-`).

**Ese token es la llave de la caja.** No va en el repositorio, ni en Vercel, ni
en un chat. Va en un solo lugar: el paso 3.

## Paso 3 — Publicar la función

En el panel de Supabase → **Edge Functions**:

1. **Deploy a new function** → *Via Editor* → nombre: `mercadopago` (exacto).
2. Pegar el contenido de `supabase/functions/mercadopago/index.ts` y publicar.
3. En los ajustes de la función, **apagar "Verify JWT"**. A esta función la
   llama Mercado Pago, que no tiene un token de Supabase; la función se protege
   sola.
4. **Edge Functions → Secrets**, agregar:

| Secreto | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | el Access Token del paso 2 |
| `APP_URL` | la dirección de la app, sin barra final: `https://grifo-phi.vercel.app` |

Con la terminal, lo mismo es:

```bash
supabase functions deploy mercadopago --project-ref TU_PROYECTO
supabase secrets set MP_ACCESS_TOKEN=APP_USR-... APP_URL=https://grifo-phi.vercel.app --project-ref TU_PROYECTO
```

(`supabase/config.toml` ya trae el "Verify JWT" apagado para esta función.)

## Paso 4 — Probar con un pago real y chico

1. Abrir `…/#/cliente` en un celular, entrar, **Cargar saldo → Otro monto →
   1000**.
2. Pagar. Mercado Pago devuelve a la app y aparece "Se acreditaron $ 1.000".
3. En **Cierre de caja** figura como *Mercado Pago*, fuera del cajón.

Si algo falla, **Edge Functions → mercadopago → Logs** dice qué.

| Lo que dice la app | Qué es |
|---|---|
| "todavía no está activada" | la función no está publicada, o falta `MP_ACCESS_TOKEN` o `APP_URL` |
| "no está disponible. Avisale al personal" | el Access Token está mal copiado o es de prueba |
| "Todavía no vemos tu pago" | el pago quedó sin terminar; si se terminó, entra solo en segundos |

## Opcional — Firmar los avisos

En el panel de Mercado Pago → la aplicación → **Webhooks** → configurar la URL
`https://TU_PROYECTO.supabase.co/functions/v1/mercadopago?webhook=1`, evento
*Pagos*, y copiar la **clave secreta** al secreto `MP_WEBHOOK_SECRET`. Con eso
la función rechaza avisos que no vengan firmados por Mercado Pago. No es
obligatorio: aun sin firma, un aviso falso no puede acreditar nada.

## Lo que NO hace sola

- **Devoluciones y contracargos.** Si se devuelve un pago desde Mercado Pago, o
  el banco lo desconoce, el saldo **no** se descuenta solo: el cliente puede
  habérselo tomado. Queda anotado en los logs de la función; hay que corregir
  la cuenta a mano con **Ajustar saldo**.
- **Montos:** entre $ 1.000 y $ 200.000, sin centavos. Se cambian en
  `pago_crear` (`31-mercadopago.sql`) y en `Cliente.tsx`.
- Mercado Pago cobra su comisión sobre cada pago: el saldo que se acredita es
  lo que pagó el cliente, no lo que le llega al bar.
