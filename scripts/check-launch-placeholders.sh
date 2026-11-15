#!/usr/bin/env bash
# Fails while any unfilled [[PLACEHOLDER ...]] token remains in src/.
# Run before launch; not wired into CI.
set -u
cd "$(dirname "$0")/.."
if grep -rn "\[\[PLACEHOLDER" src; then
  echo "ERROR: unfilled placeholders above. Fill src/lib/legal.ts and the legal pages." >&2
  exit 1
fi
echo "OK: no placeholders left."
