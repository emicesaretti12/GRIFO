# Probar el SQL sin tocar Supabase

Todo el backend se puede correr en un Postgres local antes de pegarlo en la
nube. Sirve para dos cosas:

1. **Verificar que las migraciones corren limpias** en una base vacía, en orden,
   sin sorpresas a mitad de camino.
2. **Probar las policies RLS de verdad**, no leyéndolas.

> Es levantar la base en Docker para correr los tests de integración en vez de
> apuntar a producción y cruzar los dedos.

---

## Qué hace el stub

Supabase trae el esquema `auth` con su tabla de usuarios y la función
`auth.uid()`. Un Postgres pelado no. [`00-stub-auth.sql`](00-stub-auth.sql) lo
imita: crea `auth.users`, los roles `anon` / `authenticated` / `service_role`, y
una `auth.uid()` que lee el mismo setting (`request.jwt.claims`) que usa
PostgREST.

Gracias a eso **el código de las policies es idéntico** en los dos lados. No hay
una versión "de prueba" y otra "de verdad".

El stub **aborta solo** si detecta que `auth.uid()` ya existe, o sea si alguien
lo apunta contra un Supabase real por error.

---

## Correrlo

Con un Postgres 16 local andando:

```sh
createdb verif
psql -d verif -v ON_ERROR_STOP=1 -f supabase/_pruebas-locales/00-stub-auth.sql

for f in supabase/[0-9]*.sql; do
  psql -d verif -v ON_ERROR_STOP=1 -q -f "$f" || { echo "FALLO en $f"; break; }
done
```

`ON_ERROR_STOP=1` es lo que hace que esto sirva: sin eso, `psql` sigue de largo
después de un error y termina "bien" con la base a medio construir.

### El único paso que necesita una mano

[`09-primer-admin.sql`](../09-primer-admin.sql) busca un usuario real en
`auth.users` y aborta si no lo encuentra — en Supabase ese usuario se crea desde
*Authentication → Users*. En local hay que insertarlo antes:

```sql
insert into auth.users (email) values ('el-mail-del-admin@ejemplo.com');
```

Que aborte en vez de inventar un usuario es deliberado: crear un admin de la
nada es exactamente lo que no queremos que pase por accidente.

---

## Qué tiene que salir

Cada archivo de pruebas termina imprimiendo su propio veredicto:

```
✅ TODAS LAS PRUEBAS DE BARRILES PASARON
✅ TODAS LAS PRUEBAS DE DEVOLUCIONES PASARON
✅ TODAS LAS PRUEBAS DE CLIENTES PASARON
```

Si alguno falla, aborta con el `assert` que no se cumplió y dice cuál.

---

## Una trampa al escribir pruebas nuevas

Dentro de un `set local role authenticated`, **leer una tabla directamente no
devuelve nada**: las policies RLS la tapan, que es justamente lo que queremos en
producción.

Para verificar el efecto de una función hay que salir del rol primero:

```sql
reset role;
select saldo_centavos into v_saldo from public.tarjetas where uid = '...';
set local role authenticated;
```

Si te olvidás, el assert falla con un valor nulo y parece un bug de la función
cuando en realidad la policy estaba haciendo bien su trabajo.


---

## El stub no es Supabase, y eso te puede morder

Un doble de prueba que no se parece al original da confianza falsa. Ya pasó una
vez acá:

`00-stub-auth.sql` declara `auth.users.email` como `unique`. El `auth.users` de
Supabase **no** tiene esa constraint sola — la unicidad va junto con el proveedor
y el `instance_id`. Una prueba con `on conflict (email)` pasaba en local y
explotaba en la nube con:

```
42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
```

**Regla que salió de eso: una prueba no escribe en `auth.users`.**

Si necesitás probar qué puede hacer alguien que no es admin, no hace falta crear
un usuario: alcanza con ponerle al JWT un `sub` que no esté en `personal`.

```sql
perform set_config('request.jwt.claims',
                   json_build_object('sub', gen_random_uuid())::text, true);
set local role authenticated;
```

Y si una prueba **tiene** que crear datos, va envuelta en `begin; … rollback;`
como hace [`08-pruebas-personal.sql`](../08-pruebas-personal.sql). Una prueba no
ensucia el sistema que está probando.
