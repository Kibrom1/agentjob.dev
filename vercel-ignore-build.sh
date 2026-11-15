#!/usr/bin/env bash
# Vercel "Ignored Build Step": exit 0 = SKIP the build, non-zero = BUILD.
# Skips only when EVERY commit in the push touched nothing the deployed app
# uses (docs, tests, ingestion, CI, DB files, scripts). Always builds on main,
# and builds whenever git cannot answer (shallow clone, unknown base commit).
#
# Range: a multi-commit push is compared from VERCEL_GIT_PREVIOUS_SHA (the last
# commit Vercel built for this branch) to HEAD, not just HEAD^..HEAD, so an app
# change in an earlier commit of the push cannot be skipped by a docs-only tip.
# With no usable previous SHA we fall back to HEAD^..HEAD, and if that fails
# too we build.
set -u

if [ "${VERCEL_GIT_COMMIT_REF:-}" = "main" ]; then
  echo "main branch: building"
  exit 1
fi

base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -n "$base" ] && git cat-file -e "${base}^{commit}" 2>/dev/null; then
  range="$base HEAD"
else
  range="HEAD^ HEAD"
fi

# `git diff --quiet` exits 0 for "no differences", 1 for differences and >1 on
# error (unknown revision, shallow clone). Only an explicit 0 may skip the build.
# shellcheck disable=SC2086
git diff --quiet $range -- . \
  ':(exclude)docs' ':(exclude)tests' ':(exclude)ingestion' ':(exclude).github' \
  ':(exclude)db' ':(exclude)supabase' ':(exclude)scripts' ':(exclude)*.md' 2>/dev/null
status=$?

if [ "$status" -eq 0 ]; then
  echo "only non-app files changed in $range: skipping build"
  exit 0
fi

echo "app files changed (or diff unavailable, status $status) in $range: building"
exit 1
