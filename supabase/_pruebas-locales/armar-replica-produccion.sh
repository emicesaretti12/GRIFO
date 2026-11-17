#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Copia local de PRODUCCIÓN: canillas 01-28 + las migraciones de SEN POS (sin su
# baseline), en el mismo orden en que se aplicaron. Después corre, en orden, los
# archivos que se le pasen.
#
#   GRIFO=/ruta/a/GRIFO SENPOS=/ruta/a/sen-pos ./armar-replica-produccion.sh \
#       supabase/INSTALAR-QR.sql supabase/33-pruebas-con-pos.sql
#
# Necesita Postgres 17 en el socket /tmp, puerto 5433, con usuario postgres
# (SEN POS usa ALTER COLUMN ... SET EXPRESSION, que es de la 17), y los roles
# anon, authenticated y service_role creados.
# ─────────────────────────────────────────────────────────────────────────────
# Arma "prod": canillas 01-28 + POS (sin su baseline) = producción hoy.
# uso: armar.sh [extra...]   (extra = archivos a correr después, en orden)
set -u
DB=prod
P="su postgres -c"
export PGHOST=/tmp PGPORT=5433
$P "PGHOST=/tmp PGPORT=5433 psql -q -c 'drop database if exists $DB'" >/dev/null
$P "PGHOST=/tmp PGPORT=5433 psql -q -c 'create database $DB'" >/dev/null
rm -rf /tmp/prodrun; mkdir -p /tmp/prodrun; cp -r ${GRIFO:-$(cd "$(dirname "$0")/../.." && pwd)}/supabase /tmp/prodrun/grifo; cp -r ${SENPOS:-../sen-pos}/supabase /tmp/prodrun/pos; chmod -R a+rX /tmp/prodrun
run() { su postgres -c "PGHOST=/tmp PGPORT=5433 psql -d $DB -v ON_ERROR_STOP=1 -q -f '$1'" 2>&1; }
paso() { out=$(run "$1"); rc=$?; if [ $rc -ne 0 ]; then echo "❌ FALLO en $(basename $1)"; echo "$out" | grep -E "ERROR|LINE|CONTEXT|DETAIL" | head -8; exit 1; fi; echo "ok  $(basename $1) $(echo "$out" | grep -o '✅.*\|✔.*' | tail -1)"; }
paso /tmp/prodrun/grifo/_pruebas-locales/00-stub-auth.sql
paso /tmp/prodrun/grifo/_pruebas-locales/01-imitar-supabase.sql
for f in /tmp/prodrun/grifo/[0-2][0-9]-*.sql; do
  n=$(basename $f); num=${n%%-*}; [ "$num" -gt 28 ] && break
  case $n in *pruebas*|03-seed*) continue;; esac
  if [ "$num" = "09" ]; then
    su postgres -c "PGHOST=/tmp PGPORT=5433 psql -d $DB -q -c \"insert into auth.users (email) values ('admin@grifo.local') on conflict do nothing\"" >/dev/null
    sed -i "s/[A-Za-z0-9._%+-]*@[A-Za-z0-9.-]*\.[a-z]*/admin@grifo.local/" $f
  fi
  paso $f
done
for f in /tmp/prodrun/pos/migrations/2026*.sql; do
  case $f in *baseline*) continue;; esac
  paso $f
done
for f in "$@"; do c=/tmp/prodrun/extra-$(basename "$f"); cp "$f" "$c"; chmod a+r "$c"; paso "$c"; done
