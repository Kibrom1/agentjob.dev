#!/usr/bin/env bash
# Vercel "Ignored Build Step": exit 0 = SKIP the build, non-zero = BUILD.
# Skips only when the latest commit touched nothing the deployed app uses
# (docs, tests, ingestion, CI, DB files, scripts). Always builds on main, and
# builds whenever git cannot answer (e.g. shallow clone without a parent).
set -u

if [ "${VERCEL_GIT_COMMIT_REF:-}" = "main" ]; then
  echo "main branch: building"
  exit 1
fi

# --quiet exits 0 when there are no changes outside the excluded paths.
if git diff --quiet HEAD^ HEAD -- . \
  ':(exclude)docs' ':(exclude)tests' ':(exclude)ingestion' ':(exclude).github' \
  ':(exclude)db' ':(exclude)supabase' ':(exclude)scripts' ':(exclude)*.md' 2>/dev/null; then
  echo "only non-app files changed: skipping build"
  exit 0
fi

echo "app files changed (or diff unavailable): building"
exit 1
