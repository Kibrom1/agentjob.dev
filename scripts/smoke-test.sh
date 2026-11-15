#!/usr/bin/env bash
# Read-only production smoke test for agenticroles.dev.
#
# Usage:
#   SITE_URL=https://agentjob-dev.vercel.app ./scripts/smoke-test.sh
#   SITE_URL=https://example.com CRON_SECRET=... ./scripts/smoke-test.sh
#
# Environment (nothing is accepted as an argument, nothing is printed or written to disk):
#   SITE_URL         required. Site origin, e.g. https://agentjob-dev.vercel.app
#   EXPECT_ORIGIN    optional. Origin expected in <link rel="canonical"> (default: SITE_URL)
#   CRON_SECRET      optional. Enables the authorised GET of /api/ops/report (read-only).
#                    It is passed to curl through stdin, so it never appears in `ps`.
#   RUN_MAINTENANCE  set to 1 (with CRON_SECRET) to also call /api/cron/maintenance with the
#                    secret. That route runs run_maintenance (writes: expires jobs). Off by default.
#   RUN_DIGEST       set to 1 (with CRON_SECRET) to also call /api/cron/digest with the secret.
#                    That route SENDS EMAIL. Off by default.
#
# Only GET requests are made. Unauthenticated cron/admin probes carry no credentials.
# Exit status: 0 if every check passed (skips do not fail), 1 otherwise, 2 on usage errors.
set -uo pipefail

SITE_URL="${SITE_URL:-}"
if [ -z "$SITE_URL" ]; then
  echo "SITE_URL is required (e.g. SITE_URL=https://agentjob-dev.vercel.app $0)" >&2
  exit 2
fi
SITE_URL="${SITE_URL%/}"
case "$SITE_URL" in
  http://* | https://*) ;;
  *)
    echo "SITE_URL must start with http:// or https://" >&2
    exit 2
    ;;
esac
EXPECT_ORIGIN="${EXPECT_ORIGIN:-$SITE_URL}"
EXPECT_ORIGIN="${EXPECT_ORIGIN%/}"

command -v curl >/dev/null 2>&1 || {
  echo "curl is required" >&2
  exit 2
}

BODY="$(mktemp)"
HDRS="$(mktemp)"
trap 'rm -f "$BODY" "$HDRS"' EXIT

PASSES=0
FAILS=0
SKIPS=0
ROWS=()
STATUS=""

record() { # status name detail
  ROWS+=("$1|$2|$3")
  case "$1" in
    PASS) PASSES=$((PASSES + 1)) ;;
    FAIL) FAILS=$((FAILS + 1)) ;;
    *) SKIPS=$((SKIPS + 1)) ;;
  esac
}

# fetch PATH [auth]  -> sets STATUS; body in $BODY, headers in $HDRS. GET only.
# With "auth" the Authorization header is fed to curl on stdin (-K -), not argv.
fetch() {
  local path="$1" auth="${2:-}"
  : >"$BODY"
  : >"$HDRS"
  if [ "$auth" = "auth" ]; then
    STATUS="$(printf 'header = "Authorization: Bearer %s"\n' "$CRON_SECRET" |
      curl -sS -K - -X GET --max-time 30 -o "$BODY" -D "$HDRS" -w '%{http_code}' "$SITE_URL$path" 2>/dev/null)" || STATUS="000"
  else
    STATUS="$(curl -sS -X GET --max-time 30 -o "$BODY" -D "$HDRS" -w '%{http_code}' "$SITE_URL$path" 2>/dev/null)" || STATUS="000"
  fi
}

expect_status() { # name path expected
  fetch "$2"
  if [ "$STATUS" = "$3" ]; then
    record PASS "$1" "GET $2 -> $STATUS"
  else
    record FAIL "$1" "GET $2 -> $STATUS (expected $3)"
  fi
}

# 1. Health
expect_status "health" "/api/health" 200

# 2. Home page and canonical origin
fetch "/"
origin_re="${EXPECT_ORIGIN//./\\.}"
if [ "$STATUS" != "200" ]; then
  record FAIL "home" "GET / -> $STATUS (expected 200)"
elif grep -Eiq "<link[^>]+rel=\"canonical\"[^>]*href=\"$origin_re" "$BODY" ||
  grep -Eiq "<link[^>]+href=\"$origin_re[^\"]*\"[^>]*rel=\"canonical\"" "$BODY"; then
  record PASS "home + canonical" "GET / -> 200, canonical under $EXPECT_ORIGIN"
else
  found="$(grep -Eio '<link[^>]+rel="canonical"[^>]*>' "$BODY" | head -n1)"
  record FAIL "home + canonical" "GET / -> 200 but canonical not under $EXPECT_ORIGIN (${found:-no canonical link})"
fi

# 2b. Share card metadata (only meaningful when the home page loaded)
if [ "$STATUS" = "200" ]; then
  if grep -Eiq 'property="og:image"' "$BODY" && grep -Eiq 'name="twitter:card"[^>]*content="summary_large_image"' "$BODY"; then
    record PASS "share card meta" "home has og:image and twitter:card=summary_large_image"
  else
    record FAIL "share card meta" "home is missing og:image or twitter:card=summary_large_image"
  fi
fi

# 3. Legal pages
for p in /terms /privacy /refund /about; do
  expect_status "page $p" "$p" 200
done

# 4. Recent jobs API: 200, JSON, "jobs" array
fetch "/api/jobs/recent?days=14"
if [ "$STATUS" != "200" ]; then
  record FAIL "jobs/recent" "GET /api/jobs/recent?days=14 -> $STATUS (expected 200)"
elif command -v python3 >/dev/null 2>&1; then
  if python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); sys.exit(0 if isinstance(d,dict) and isinstance(d.get("jobs"),list) else 1)' "$BODY" 2>/dev/null; then
    record PASS "jobs/recent" "200, JSON with jobs array"
  else
    record FAIL "jobs/recent" "200 but body is not JSON with a jobs array"
  fi
elif grep -q '"jobs"[[:space:]]*:[[:space:]]*\[' "$BODY"; then
  record PASS "jobs/recent" "200, body has a jobs array (python3 unavailable, loose check)"
else
  record FAIL "jobs/recent" "200 but no jobs array found"
fi

# 5. Sitemap and robots
fetch "/sitemap.xml"
if [ "$STATUS" != "200" ]; then
  record FAIL "sitemap.xml" "GET /sitemap.xml -> $STATUS (expected 200)"
elif grep -q '/jobs/' "$BODY"; then
  record PASS "sitemap.xml" "200, has $(grep -o '/jobs/' "$BODY" | wc -l | tr -d ' ') /jobs/ entries"
else
  record FAIL "sitemap.xml" "200 but no /jobs/ entry"
fi
expect_status "robots.txt" "/robots.txt" 200

# 6. Admin must demand credentials
fetch "/admin"
case "$STATUS" in
  401) record PASS "admin unauthenticated" "GET /admin -> 401" ;;
  503) record FAIL "admin unauthenticated" "GET /admin -> 503: ADMIN_PASSWORD is not set in this environment" ;;
  *) record FAIL "admin unauthenticated" "GET /admin -> $STATUS (expected 401)" ;;
esac

# 7. Cron / ops routes without credentials must be 401
for p in /api/cron/maintenance /api/cron/digest /api/ops/report; do
  expect_status "no-auth $p" "$p" 401
done

# 7b. Cron / ops routes with the secret (only read-only /api/ops/report by default)
if [ -z "${CRON_SECRET:-}" ]; then
  record SKIP "auth /api/ops/report" "CRON_SECRET not supplied"
else
  fetch "/api/ops/report" auth
  if [ "$STATUS" = "200" ]; then
    record PASS "auth /api/ops/report" "GET with Bearer -> 200"
  else
    record FAIL "auth /api/ops/report" "GET with Bearer -> $STATUS (expected 200)"
  fi
  if [ "${RUN_MAINTENANCE:-}" = "1" ]; then
    fetch "/api/cron/maintenance" auth
    if [ "$STATUS" = "200" ]; then
      record PASS "auth /api/cron/maintenance" "GET with Bearer -> 200 (ran maintenance)"
    else
      record FAIL "auth /api/cron/maintenance" "GET with Bearer -> $STATUS (expected 200)"
    fi
  else
    record SKIP "auth /api/cron/maintenance" "writes (expires jobs); set RUN_MAINTENANCE=1 to run"
  fi
  if [ "${RUN_DIGEST:-}" = "1" ]; then
    fetch "/api/cron/digest" auth
    if [ "$STATUS" = "200" ]; then
      record PASS "auth /api/cron/digest" "GET with Bearer -> 200 (SENT EMAIL)"
    else
      record FAIL "auth /api/cron/digest" "GET with Bearer -> $STATUS (expected 200)"
    fi
  else
    record SKIP "auth /api/cron/digest" "sends email; set RUN_DIGEST=1 to run"
  fi
fi

# 8. Unknown job slug must be a real 404
expect_status "unknown job 404" "/jobs/does-not-exist-xyz" 404

# 9. Security headers (from next.config.ts)
fetch "/"
missing=""
for h in x-content-type-options referrer-policy x-frame-options permissions-policy strict-transport-security; do
  grep -qi "^$h:" "$HDRS" || missing="$missing $h"
done
if [ -z "$missing" ]; then
  record PASS "security headers" "all 5 present on /"
else
  record FAIL "security headers" "missing:$missing"
fi

# Report
echo
echo "Agentic Roles smoke test: $SITE_URL (read-only, GET only)"
printf '%-6s  %-30s  %s\n' STATUS CHECK DETAIL
printf '%-6s  %-30s  %s\n' ------ ------------------------------ ------
for row in "${ROWS[@]}"; do
  IFS='|' read -r s n d <<<"$row"
  printf '%-6s  %-30s  %s\n' "$s" "$n" "$d"
done
echo
echo "Summary: $PASSES passed, $FAILS failed, $SKIPS skipped"
if [ "$FAILS" -gt 0 ]; then
  echo "RESULT: FAIL"
  exit 1
fi
echo "RESULT: PASS"
