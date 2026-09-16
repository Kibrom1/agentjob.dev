#!/usr/bin/env bash
# Full-stack end-to-end test:
#   PostgreSQL (all migrations) ← PostgREST shim ← production Next.js build
#   + local Stripe/Resend doubles + Playwright (Chromium).
#
# Usage:
#   DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres ./scripts/test-e2e.sh
# Set SKIP_BUILD=1 to reuse an existing .next build.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADMIN_URL="${DATABASE_ADMIN_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
TEST_DB="agentjobs_e2e"
APP_PORT="${E2E_APP_PORT:-3200}"
SHIM_PORT="${E2E_SHIM_PORT:-54329}"
STRIPE_PORT="${E2E_STRIPE_PORT:-12111}"
RESEND_PORT="${E2E_RESEND_PORT:-12112}"
LOG_DIR="$(mktemp -d)"
PIDS=()

TEST_URL="$(python3 - "$ADMIN_URL" "$TEST_DB" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit
parts = urlsplit(sys.argv[1])
print(urlunsplit(parts._replace(path="/" + sys.argv[2])))
PY
)"

cleanup() {
  local status=$?
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  psql "$ADMIN_URL" -q -c "drop database if exists ${TEST_DB} with (force)" >/dev/null 2>&1 || true
  if [[ $status -ne 0 ]]; then
    echo "--- logs (${LOG_DIR}) ---"
    tail -n 40 "$LOG_DIR"/*.log || true
  fi
  exit $status
}
trap cleanup EXIT

wait_for() {
  local url="$1" name="$2"
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null "$url"; then return 0; fi
    sleep 0.5
  done
  echo "timed out waiting for $name ($url)" >&2
  return 1
}

echo "→ preparing database"
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "drop database if exists ${TEST_DB} with (force)" >/dev/null
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "create database ${TEST_DB}" >/dev/null
psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$ROOT_DIR/db/tests/00_supabase_bootstrap.sql" >/dev/null
for migration in "$ROOT_DIR"/supabase/migrations/*.sql; do
  psql "$TEST_URL" -q -v ON_ERROR_STOP=1 -f "$migration" >/dev/null 2>&1
done

export ANON_KEY="e2e-anon-key-0123456789abcdef"
export SERVICE_KEY="e2e-service-key-0123456789abcdef"

echo "→ starting PostgREST shim and service doubles"
SHIM_DATABASE_URL="$TEST_URL" SHIM_PORT="$SHIM_PORT" SHIM_ANON_KEY="$ANON_KEY" SHIM_SERVICE_KEY="$SERVICE_KEY" \
  node "$ROOT_DIR/tests/e2e/postgrest-shim.mjs" >"$LOG_DIR/shim.log" 2>&1 &
PIDS+=($!)
STUB_STRIPE_PORT="$STRIPE_PORT" STUB_RESEND_PORT="$RESEND_PORT" \
  node "$ROOT_DIR/tests/e2e/service-stubs.mjs" >"$LOG_DIR/stubs.log" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:${SHIM_PORT}/" shim
wait_for "http://127.0.0.1:${RESEND_PORT}/__test/emails" stubs

export NEXT_TELEMETRY_DISABLED=1
export NEXT_PUBLIC_SITE_URL="http://127.0.0.1:${APP_PORT}"
export SUPABASE_URL="http://127.0.0.1:${SHIM_PORT}"
export SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY"
export STRIPE_SECRET_KEY="sk_test_e2e"
export STRIPE_WEBHOOK_SECRET="whsec_e2etestsecret"
export STRIPE_API_BASE_URL="http://127.0.0.1:${STRIPE_PORT}"
export RESEND_API_KEY="re_e2e_key"
export RESEND_API_BASE_URL="http://127.0.0.1:${RESEND_PORT}"
export EMAIL_FROM="AgentJob <digest@agentjob.test>"
export POSTAL_ADDRESS="AgentJob, 1 Test Street, Springfield, USA"
export CRON_SECRET="e2e-cron-secret-0123456789"
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="e2e-admin-password"

cd "$ROOT_DIR"
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "→ building app"
  npx next build >"$LOG_DIR/build.log" 2>&1
fi

echo "→ starting app"
node "$ROOT_DIR/node_modules/next/dist/bin/next" start -p "$APP_PORT" >"$LOG_DIR/app.log" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:${APP_PORT}/robots.txt" app

E2E_APP_URL="http://127.0.0.1:${APP_PORT}" \
E2E_STRIPE_URL="http://127.0.0.1:${STRIPE_PORT}" \
E2E_RESEND_URL="http://127.0.0.1:${RESEND_PORT}" \
E2E_DATABASE_URL="$TEST_URL" \
E2E_ARTIFACTS_DIR="${E2E_ARTIFACTS_DIR:-$LOG_DIR}" \
PLAYWRIGHT_MODULE="${PLAYWRIGHT_MODULE:-playwright}" \
  node "$ROOT_DIR/tests/e2e/scenario.mjs"
