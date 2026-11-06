#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-local}"
run_sql() {
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"
}

if [ "$mode" = "local" ]; then
  bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  dir="$(mktemp -d)"
  as=()
  if [ "$(id -u)" = 0 ]; then
    chown postgres "$dir"
    as=(runuser -u postgres --)
  fi
  trap '"${as[@]}" "$bin/pg_ctl" -D "$dir/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$dir"' EXIT
  "${as[@]}" "$bin/initdb" -D "$dir/data" -U postgres -A trust >/dev/null
  "${as[@]}" "$bin/pg_ctl" -D "$dir/data" -o "-k $dir -c listen_addresses=''" -l "$dir/log" -w start >/dev/null
  export DATABASE_URL="postgresql://postgres@/postgres?host=$dir"
  run_sql -f tests/support/supabase_stub.sql
  for m in supabase/migrations/*.sql; do
    PGOPTIONS="-c client_min_messages=warning" run_sql -f "$m"
  done
elif [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set" >&2
  exit 2
fi

run_sql -f tests/support/helpers.sql

failed=0
for t in tests/sql/*.sql; do
  if out="$(run_sql -f "$t" 2>&1)"; then
    echo "pass $(basename "$t") ($(grep -c 'ok:' <<<"$out") checks)"
  else
    echo "FAIL $(basename "$t")"
    grep -E 'not ok|ERROR' <<<"$out" | head -5 | sed 's/^/  /'
    failed=1
  fi
done
exit $failed
