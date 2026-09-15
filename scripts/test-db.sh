#!/usr/bin/env bash
# Applies every migration to a throwaway PostgreSQL database and runs the
# schema contract tests against it.
#
# Usage:
#   DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres ./scripts/test-db.sh
#
# The script creates (and afterwards drops) a database named agentjobs_schema_test.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADMIN_URL="${DATABASE_ADMIN_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
TEST_DB="agentjobs_schema_test"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required (install the PostgreSQL client)." >&2
  exit 1
fi

# Swap only the database name in the admin URL, keeping any query string.
TEST_URL="$(python3 - "$ADMIN_URL" "$TEST_DB" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit
parts = urlsplit(sys.argv[1])
print(urlunsplit(parts._replace(path="/" + sys.argv[2])))
PY
)"

cleanup() {
  psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "drop database if exists ${TEST_DB} with (force)" >/dev/null
}
trap cleanup EXIT

psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "drop database if exists ${TEST_DB} with (force)" >/dev/null
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "create database ${TEST_DB}" >/dev/null

echo "→ bootstrapping Supabase roles"
psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$ROOT_DIR/db/tests/00_supabase_bootstrap.sql"

for migration in "$ROOT_DIR"/supabase/migrations/*.sql; do
  echo "→ applying $(basename "$migration")"
  psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$migration"
done

for test_file in "$ROOT_DIR"/db/tests/*.test.sql; do
  echo "→ running $(basename "$test_file")"
  psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$test_file"
done

# Optional: verify the Python ingestion payloads against the real RPC.
if [[ "${RUN_INGEST_CONTRACT:-0}" == "1" ]]; then
  echo "→ running ingestion ↔ database contract test"
  (cd "$ROOT_DIR/ingestion" && AGENTJOBS_TEST_DATABASE_URL="$TEST_URL" python3 -m pytest tests/test_db_contract.py)
fi
