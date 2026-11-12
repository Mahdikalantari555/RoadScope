#!/bin/sh
# Applies the relational-spatial schema (idempotent) then starts the runtime.
set -e

echo "[uai] waiting for postgres at ${DATABASE_URL%%@*}@…"
for i in $(seq 1 60); do
  if node -e "const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query('select 1').then(()=>process.exit(0)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    echo "[uai] postgres is ready"
    break
  fi
  sleep 2
done

echo "[uai] applying schema (drizzle-kit push)"
npx drizzle-kit push --force || echo "[uai] schema push reported errors (continuing — schema may already exist)"

echo "[uai] starting Next.js production server"
exec npx next start -H 0.0.0.0 -p "${PORT:-3000}"
