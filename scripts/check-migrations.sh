#!/usr/bin/env bash
# Guard: Supabase CLI migrations must be plain SQL. psql meta-commands
# (\set, \echo, \i, \c, \connect, ...) fail under `supabase db push`.
# Also enforces filename pattern and unique timestamps.
set -euo pipefail

cd "$(dirname "$0")/.."
dir="supabase/migrations"
fail=0

if grep -nE '^[[:space:]]*\\[a-zA-Z]' "$dir"/*.sql; then
  echo "ERROR: psql meta-command found in $dir (see file:line above)." >&2
  fail=1
fi

for f in "$dir"/*.sql; do
  if ! [[ "$(basename "$f")" =~ ^[0-9]{14}_[a-z0-9_]+\.sql$ ]]; then
    echo "ERROR: bad migration filename: $f" >&2
    fail=1
  fi
done

dups=$(for f in "$dir"/*.sql; do basename "$f" | cut -c1-14; done | sort | uniq -d)
if [ -n "$dups" ]; then
  echo "ERROR: duplicate migration timestamps: $dups" >&2
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "migrations OK"
fi
exit "$fail"
