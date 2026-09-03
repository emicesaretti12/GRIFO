# Publicar en Vercel

La app es una SPA estática: `npm run build` deja archivos sueltos en `app/dist/`.
No hay servidor que mantener ni base que conectar — Supabase ya es el backend.

**Por qué conviene para este proyecto:** con la app publicada, las tablets de las
canillas no dependen de la red local del bar. Andan desde cualquier WiFi, y si
mañana cambian el router no hay nada que reconfigurar.

---

## Los pasos

1. **[vercel.com](https://vercel.com) → Add New → Project** → importá el repo
   `emicesaretti12/GRIFO`.

2. **La rama.** Por defecto Vercel publica la rama principal. Mientras el trabajo
   viva en `claude/grifo-cerveza-esp32-qndb2h`, poné esa en
   *Settings → Git → Production Branch*.

3. **La configuración ya está en el repo.** El [`vercel.json`](../vercel.json) de
   la raíz dice qué compilar y de dónde sacar la salida, así que no hay que tocar
   Build Command ni Output Directory a mano.

4. **Variables de entorno** (*Settings → Environment Variables*), para Production,
   Preview y Development:

   | Nombre | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://bkrwabezndztkldwygjd.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | la publishable key (`sb_publishable_…`) |

   > Estas dos **terminan dentro del JavaScript que baja el navegador**, y está
   > bien: la anon key es pública por diseño. Lo que protege los datos es el
   > login del personal más las policies RLS.
   >
   > **La `sb_secret_` no va acá ni en ningún lado del front.** Si la ponés en
   > Vercel con el prefijo `VITE_`, Vite la mete en el bundle y queda a la vista
   > de cualquiera que abra las devtools.

5. **Deploy.** Tarda un par de minutos la primera vez.

---

## Después del primer deploy

### Regenerá los QR de las pantallas

⚠️ **Esto es importante y fácil de pasar por alto.** El QR que vincula cada
pantalla se arma con la dirección desde la que estás mirando el panel. Si lo
generaste con la app corriendo en `localhost`, ese QR apunta a `localhost` y en
la tablet no va a funcionar.

Entrá al panel **desde la URL de Vercel**, andá a **Canillas → Rotar token**, y
usá ese QR nuevo.

### Nada que configurar para las rutas

La pantalla de canilla vive en `#/pantalla`, con **ruteo por hash**. Eso fue a
propósito: con rutas normales, recargar `/pantalla` le pediría al hosting una
ruta que no existe y habría que agregar una regla de reescritura. Con hash, el
servidor solo ve `/` y siempre responde bien — una tablet que se reinicia sola
vuelve a la pantalla correcta sin ayuda.

---

## Preview deploys y la base de datos

Cada rama y cada PR reciben su propia URL de preview. Ojo con esto: **todas
apuntan a la misma base de Supabase**. Un preview no es un entorno aparte — si
cargás saldo desde ahí, se lo estás cargando a una tarjeta real.

Si más adelante querés separarlos, la forma es un segundo proyecto de Supabase
para pruebas y variables distintas en el scope *Preview* de Vercel.

---

## Alternativas

Netlify y Cloudflare Pages funcionan igual de bien: son archivos estáticos. La
configuración equivalente es *build command* `npm --prefix app install && npm
--prefix app run build` y *publish directory* `app/dist`.

También se puede servir desde una PC del bar con `npm run preview` o cualquier
servidor estático, pero ahí las tablets quedan atadas a esa máquina y a esa red
— que es justo lo que evitás publicándolo.
