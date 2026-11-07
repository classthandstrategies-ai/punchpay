#!/usr/bin/env bash
# Runs the real Supabase migration + seed + guard tests on a throwaway local Postgres.
# Data lives inside the project (gitignored) so it never touches the system disk.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/.tmp-pg"
PORT="${PUNCHPAY_TEST_PG_PORT:-54399}"
export TMPDIR="$ROOT/.tmp-pg-tmp"
rm -rf "$DIR" "$TMPDIR"; mkdir -p "$TMPDIR"
cleanup() { pg_ctl -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR" "$TMPDIR"; }
trap 'code=$?; [ $code -ne 0 ] && tail -5 "$DIR/log" 2>/dev/null; cleanup; exit $code' EXIT
export PGOPTIONS="-c client_min_messages=warning"
initdb -D "$DIR" -U postgres --auth=trust >/dev/null
pg_ctl -D "$DIR" -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=" -l "$DIR/log" -w start >/dev/null
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/tests/db/bootstrap.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"   # seed must be idempotent
"${PSQL[@]}" -o /dev/null -f "$ROOT/tests/db/guards.test.sql"
