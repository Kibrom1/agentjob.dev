# Data Architect Review — 2026-09-16

Scope: all 6 migrations in `supabase/migrations/` as applied to production
project `dboydqtzvsebuzpnlrsr`, plus `db/tests/*.test.sql` and the app-layer
query patterns in `src/lib/jobs.ts` and `src/app/api/jobs/recent/route.ts`.
Pure code review — no DB/browser access used.

Overall: this schema is unusually disciplined for a Phase 1 cut. RLS is
enabled everywhere it needs to be, grants are stripped and re-granted
explicitly per migration (defending against Postgres's default
grant-EXECUTE-to-PUBLIC-on-new-function behavior, which is the most common
way this class of app leaks an admin RPC), and the enum-add-value migration
is correctly isolated. The findings below are gaps, not fires.

## Findings (most important first)

1. **No CHECK constraint ties `featured_until` to `expires_at`.**
   `jobs_featured_has_window_chk` only requires `featured_until is not null`
   when `is_featured`; nothing stops a future write (a new admin action, a
   patched ingestion path, a manual `update`) from setting
   `featured_until > expires_at`. Today the only two writers
   (`activate_paid_job`, `admin_update_job`) both derive `featured_until`
   from the same duration as `expires_at`/`least(expires_at, ...)`, so the
   invariant holds in practice, but it's enforced by convention in two
   PL/pgSQL functions, not by the schema. Recommend adding
   `constraint jobs_featured_within_window_chk check (featured_until is null or expires_at is null or featured_until <= expires_at)`.
   (P1 — schema, not immediately exploitable but the next person to add a
   write path won't know to preserve the invariant.)

2. **`search_jobs`'s sort key (`is_featured expr` → rank → `published_at`)
   has no matching index.** `jobs_active_feed_idx` only covers
   `(published_at desc, id) where status='active'`; there's no index
   ordering on the featured expression first. At current/launch volume this
   is a non-issue (sort spills to a small in-memory sort), but it's worth
   flagging now because the natural fix — an expression index on
   `((is_featured and featured_until > now()))` — can't be built cleanly
   since `now()` isn't immutable, so the real fix is architectural
   (materialize an `is_currently_featured` boolean via trigger, then index
   `(is_currently_featured desc, published_at desc)`). Escalate to Software
   Architect if/when the `jobs` table grows past a few thousand active rows.

3. **`/api/jobs/recent` and `search_jobs()` have no "since published_at"
   parameter.** The route fetches the top 100 rows by `search_jobs()`'s
   default order (featured desc, then `published_at desc`) and *then*
   filters by a `days` cutoff in JS. Once more than 100 jobs are active,
   this route can silently under-report recent jobs whose rank happens to
   sort below the 100th row (e.g., during a launch-day ingestion burst).
   Not a schema bug, but worth a `search_jobs` parameter
   (`p_published_after timestamptz`) so the filter is pushed down and
   `LIMIT`-safe. Escalate to Software Architect / Full-Stack Engineer.

4. **`jobs.search_vector` and `jobs.tags` are exposed to anon via
   column-level SELECT with no partial-index alignment to `status`.**
   `jobs_search_vector_idx` and `jobs_tags_idx` are full-table GIN indexes,
   not partial on `status = 'active'`, so a search that matches many
   historical `expired`/`rejected`/ingested-closed rows pays index cost for
   rows RLS will discard anyway. Fine at current scale; revisit if the
   `jobs` table accumulates years of expired/ingested history (a partial
   GIN index `where status = 'active'` would be the fix, and would also
   need `jobs_category_published_idx` reconsidered the same way — it's
   deliberately non-partial today to also serve the category FK, so that
   trade-off should stay explicit if changed).

5. **No test previously verified `ingestion_runs` is actually inaccessible
   to anon/authenticated.** RLS is enabled with zero policies (correct —
   the intent, per the migration's own comment, is that only
   `service_role` bypassing RLS reads it), but `40_ops.test.sql` only
   checked the `log_ingestion_run()` grant, not the table itself. Added a
   regression test (`db/tests/50_data_architect.test.sql`).

6. **`digest_runs_completion_chk` was only exercised indirectly.** The
   constraint `(status = 'sending') = (completed_at is null)` is the only
   thing preventing a `completed`/`skipped` row from silently missing its
   `completed_at`, or a `sending` row from lying about being done — but
   every existing test only calls it through `finish_digest_run()`, which
   already guarantees the pairing. Nothing tested the constraint against a
   direct `insert`/`update`, so a future migration that adds a new digest
   writer wouldn't be caught if it violated the pairing — the CHECK would
   catch it, but only that CHECK, with no test proving it does. Added
   coverage.

7. **`categories` is publicly readable but was only tested against
   anon `INSERT`, not `UPDATE`/`DELETE`.** Both are correctly revoked (the
   blanket `revoke all ... from anon, authenticated` in the core migration
   covers it), but the contract test suite didn't assert it. Added
   coverage, plus a new assertion that the `category_slug` FK's
   `ON DELETE RESTRICT` actually blocks deleting a category that's in use
   (previously only the FK's *insert*-time behavior — reject with a
   nonexistent slug — was tested, not delete-time).

8. **PII surface is correctly minimal, confirmed by re-reading rather than
   found broken:** `employers.email` is reachable only via `service_role`
   (bypasses RLS) or `create_job_posting`'s `security invoker` path (which
   only `service_role` can execute); `subscribers.email` is reachable only
   via `service_role` or the two `security definer` RPCs
   (`subscribe_to_digest` never returns or branches on existing rows —
   enumeration-safe; `unsubscribe_from_digest` takes an unguessable token
   and returns only a boolean). No leak found. No action.

9. **RLS policy on `jobs` matches the intended visibility rule exactly**
   (`status = 'active' and expires_at > now()`), and — importantly —
   doesn't rely on the `expire_jobs()` sweep having run, so a job that has
   technically expired but hasn't been swept yet is still correctly hidden.
   Confirmed via `10_schema.test.sql`'s fixture `...a3` (active status,
   expired timestamp, asserted invisible to anon). No action.

10. **Every non-public RPC is `security invoker`, not `security definer`,
    and relies on the calling role's own grants.** This is correct *because*
    the only role that can call them is `service_role`, which has
    `bypassrls` and `grant all` on every table — so invoker semantics still
    give full access, and using invoker (rather than definer) here is
    actually the safer choice: it means a hypothetical future
    over-permissive grant to `authenticated` on one of these functions would
    still be caught by that role's own (much narrower) table grants/RLS,
    rather than silently running with elevated definer privileges. The two
    functions that *do* need `security definer` (`subscribe_to_digest`,
    `unsubscribe_from_digest`) are exactly the two anon-callable ones that
    write to a table anon has no grant on, and both are narrow single-
    purpose writes. No action — flagging as a design strength worth
    preserving in future migrations (new admin/service RPCs should stay
    `security invoker`; only reach for `security definer` when a specific
    anon-writable narrow action requires it).

11. **`upsert_ingested_jobs`'s `close_missing` guard against an empty feed
    is present and tested** (`raise exception` when `p_jobs` is empty and
    `p_close_missing` is true), preventing a source's feed going empty from
    mass-expiring that source's jobs. Confirmed working as designed via
    `20_operations.test.sql`. No action — noting this because it's the one
    invariant the project instructions explicitly call out by name.

12. **Minor: `employers.website_url`/`company_url`/`company_logo_url` allow
    `http://` for `website_url`/`company_url` but require `https://` for
    logo URLs.** Intentional-looking (logos get embedded as `<img src>` in
    the UI, links don't), but worth a one-line confirmation from whoever
    owns the frontend rendering that `company_url`/`website_url` are always
    rendered as `<a href>`, never fetched/embedded — otherwise the
    http-allowed columns are a smaller version of the same mixed-content
    concern the logo constraint exists to prevent. Advisory only.

## Test coverage added

New file: `db/tests/50_data_architect.test.sql` (runs in the existing
rolled-back-transaction style, via `scripts/test-db.sh`). Covers:

- `ingestion_runs` has RLS enabled and is unreadable by `anon`/`authenticated`.
- `digest_runs_completion_chk` rejects `completed`/`skipped` rows missing
  `completed_at` and `sending` rows that already have one.
- `categories` cannot be `UPDATE`d or `DELETE`d by `anon` (only `INSERT` was
  previously covered).
- `category_slug`'s `ON DELETE RESTRICT` blocks deleting a category that a
  live job still references.

## Not covered by this review (out of scope / escalate)

- Stripe webhook signature verification, `CRON_SECRET` handling — Security
  Reviewer's lens, not schema.
- Rate-limit key derivation (`sha256(ip)`) — application code, not DB.
- Whether $149/$99 pricing is visible before the multi-step form —
  Growth/Monetization Analyst.
