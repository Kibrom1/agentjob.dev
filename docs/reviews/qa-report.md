# QA Reproduction Pass — AgentJobs.dev

Scope: independent reproduction of the 5 highest-priority claims from the four
first-pass reports (`product-lead.md`, `ux.md`, `data.md`, `security.md`),
per `docs/agent-team-guidelines.md` §5 (Testing/QA Engineer) — a finding
without a QA reproduction stays "unconfirmed." Date: 2026-09-16.

---

## 1. Product Lead P0 — `/admin` disabled (no ADMIN_PASSWORD)

**Verdict: CONFIRMED**

Repro steps:
- Navigated Chrome to `https://agentjob-dev.vercel.app/admin`.
- `get_page_text` on the loaded page returned exactly:
  `Set ADMIN_PASSWORD (12+ characters) to enable the admin console.`

Matches the Product Lead's claim verbatim. The admin curation fallback is
confirmed disabled in production right now.

---

## 2. Product Lead P0 — no git remote configured

**Verdict: CONFIRMED**

Repro steps:
- Ran `cd /home/claude/agentjobs && git remote -v` — output was empty (no
  remotes listed).
- Ran `git status` — confirmed branch `main`, with only local modified/
  untracked files; nothing indicating any push/pull history to a hosted
  remote.

This confirms the repo genuinely has no remote configured in this
environment, so `.github/workflows/ingest.yml` cannot possibly be executing
via GitHub Actions from this checkout — there's no GitHub repo for Actions
to run against.

Caveat: this only proves *this local checkout* has no remote. It cannot
rule out a separately-pushed copy of the repo existing elsewhere that this
sandbox has no visibility into — but combined with the `/admin` finding
(no working manual fallback either), the Product Lead's "no working path to
populate the board exists" conclusion holds.

---

## 3. Security High — `/api/cron/maintenance` returns CRON_SECRET-missing error

**Verdict: CONFIRMED**

Repro steps:
- Navigated Chrome to `https://agentjob-dev.vercel.app/api/cron/maintenance`.
- `get_page_text` returned exactly:
  `{"error":"Invalid cron configuration — CRON_SECRET: is required to
  authenticate scheduled jobs. See .env.example."}`

Matches the Security reviewer's claim verbatim, including the exact error
string. Confirms this endpoint is hard-down (misconfigured), not merely
unauthenticated, in production right now.

---

## 4. UX confirmed bug — misdirected focus on "Your email" field, post-a-job step 1

**Verdict: COULD NOT REPRODUCE (3/3 attempts landed correctly)**

Repro steps (all on `https://agentjob-dev.vercel.app/post-a-job`, step 1,
viewport ~1017×1176, page scrolled so the "Your email" input's box occupied
roughly y=528–583, x=27–988):

- **Attempt 1:** clicked at `(507, 555)` — the visual center of the "Your
  email" input — then typed `test1@example.com`. Screenshot after typing
  shows `test1@example.com` correctly inside the "Your email" field (green
  focus ring on that field), "Company name" field above it empty. Correct.
- **Attempt 2:** triple-clicked `(507, 555)` to select any existing content,
  pressed Delete, clicked `(507, 555)` again, typed `test2@example.com`.
  Screenshot shows `test2@example.com` correctly in the "Your email" field.
  Correct.
- **Attempt 3:** same clear/click/type sequence as attempt 2, typed
  `test3@example.com`, then scrolled up to inspect the "Company name" field
  at the top of the form. Screenshot confirms "Company name" is empty (no
  bleed-over of any test string into it).

Across 3 independent click-and-type passes at the same coordinates, focus
went to the "Your email" field every time; no keystrokes landed in "Company
name" or any other field, and no "TestCotest@example.com"-style
concatenation was observed.

Assessment: this does not mean the UX finding is false — the UX report
itself says the misdirected-focus event happened once, in one pass, and
flagged it as possibly intermittent (layout/focus-management race or a
hit-target overlap that depends on timing/render state rather than a
deterministic bug). Given 0/3 reproductions here, this should be downgraded
from "confirmed bug" to **unconfirmed / not reliably reproducible** per the
team guidelines' rule that only a QA-reproduced finding may carry
"confirmed" status. Recommend UX or Engineering add a lightweight automated
E2E check (rapid click+type into `#email` immediately after step-1 mount,
before/during any client-side hydration or animation) to catch a
race-condition version of this that manual clicking after the page has
settled won't surface. Do not close this finding outright — re-flag as
"attempted repro, could not trigger; needs a race-condition-oriented repro
attempt (e.g. click during initial hydration) before it can be marked
fixed or invalid."

---

## 5. Data Architect — full SQL contract test suite (including
   `db/tests/50_data_architect.test.sql`) actually passes

**Verdict: COULD NOT CONFIRM — no reachable database in this environment**

Repro steps attempted:
- Located the correct invocation: `scripts/test-db.sh`, which requires
  `DATABASE_ADMIN_URL` (default
  `postgres://postgres:postgres@localhost:5432/postgres`), applies all
  `supabase/migrations/*.sql` to a throwaway DB, then runs every
  `db/tests/*.test.sql` file (including the new
  `50_data_architect.test.sql`) via `psql`.
- Confirmed `psql` binary is present (`/usr/bin/psql`).
- Ran `DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres
  bash scripts/test-db.sh` — failed immediately:
  `psql: error: connection to server at "localhost" (127.0.0.1), port 5432
  failed: Connection refused`.
- Checked environment for any pre-configured Supabase/Postgres connection
  string (`env | grep -i supabase`) — none found in this sandbox.

There is no local Postgres server, no `DATABASE_ADMIN_URL` pointing to a
reachable instance, and no credentials in this environment for the live
Supabase project (`dboydqtzvsebuzpnlrsr`) that would let this be run safely
against it (running the throwaway-DB script against a *live* project isn't
appropriate anyway — it creates/drops a database). Saying plainly: **this
sandbox cannot execute the SQL contract test suite**, so the Data
Architect's claim that the full suite (including the new test file) passes
is neither confirmed nor refuted here. This needs to be run in an
environment with a disposable Postgres instance (or CI) before it can be
marked confirmed — flagging back per the escalation rule rather than
guessing.

---

## Summary table

| # | Claim | Verdict |
|---|-------|---------|
| 1 | `/admin` shows ADMIN_PASSWORD-disabled message | CONFIRMED |
| 2 | No git remote configured | CONFIRMED |
| 3 | `/api/cron/maintenance` returns CRON_SECRET error | CONFIRMED |
| 4 | Misdirected focus on "Your email" field | COULD NOT REPRODUCE (3/3 attempts correct) — downgrade to unconfirmed, needs race-condition-style repro |
| 5 | Full SQL contract suite (incl. 50_data_architect.test.sql) passes | COULD NOT CONFIRM — no reachable Postgres/credentials in this sandbox |
