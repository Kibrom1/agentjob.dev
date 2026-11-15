#!/usr/bin/env bash
# Fails while any unfilled [[PLACEHOLDER ...]] token remains in src/.
# Wired into CI as a warning on branches/PRs and a failure on v* release tags
# (.github/workflows/ci.yml, job launch-placeholders).
set -u
cd "$(dirname "$0")/.."
if grep -rn "\[\[PLACEHOLDER" src; then
  echo "ERROR: unfilled placeholders above. Fill src/lib/legal.ts and the legal pages." >&2
  exit 1
fi
echo "OK: no placeholders left."
