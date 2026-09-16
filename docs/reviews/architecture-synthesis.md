# Software Architect Synthesis — Review Cycle 1 (2026-09-16)

Synthesizes: `product-lead.md`, `ux.md`, `data.md`, `security.md`, and the
QA reproduction pass in `qa-report.md`. Dedupes overlapping findings, assigns
an owner, and sets the priority order engineering should actually work in.

## Confirmed, owned, ready for engineering

| # | Finding | Confirmed by | Owner | Priority |
|---|---|---|---|---|
| 1 | `ADMIN_PASSWORD`/`ADMIN_USERNAME` unset in Vercel prod — admin curation console fully disabled | Product Lead + QA repro | DevOps/SRE (env var set) | **P0** |
| 2 | Repo has no git remote configured — `.github/workflows/ingest.yml` has never run anywhere; ingestion has never executed for real | Product Lead + QA repro | DevOps/SRE (push repo, wire secrets) | **P0** |
| 3 | `CRON_SECRET` unset in Vercel prod — `/api/cron/maintenance`, `/api/cron/digest`, `/api/ops/report` are hard-down (503), so expiry/maintenance/digest are not running in production at all right now | Security + QA repro | DevOps/SRE (env var set) | **P0** |
| 4 | `agentjobs.dev` custom domain points to an unrelated placeholder site, not this app | Product Lead (flagged as known) | DevOps/SRE | **P1** |
| 5 | Cron/ops error responses leak internal env-var/config detail to unauthenticated callers before the auth check fully gates the route | Security | Full-Stack Engineer | **P1** |
| 6 | No CHECK constraint ties `featured_until <= expires_at` — currently held only by convention across two PL/pgSQL functions | Data Architect | Data Architect (write migration) | **P1** |
| 7 | Admin Basic-auth has no attempt/lockout throttling behind a single shared credential that also gates employer PII (`admin_stats`/`listAdminJobs` expose `employers.email`) | Security | Full-Stack Engineer | **P1** |
| 8 | `consumeRateLimit`'s deliberate fail-open design has no circuit breaker/alert for sustained RPC failure | Security | Full-Stack Engineer / DevOps (alerting) | P2 |
| 9 | `/api/jobs/recent` has no rate limit (unlike post-job/subscribe/unsubscribe) | Security | Full-Stack Engineer | P2 |
| 10 | `search_jobs`/`  /api/jobs/recent` filters "recent" client-side after a hard `LIMIT 100` — can silently under-report during an ingestion burst | Data Architect | Full-Stack Engineer (push `p_published_after` into the RPC) | P2 |
| 11 | No index backs the featured-first sort in `search_jobs` (architecturally deferred — needs a materialized boolean, not just an index) | Data Architect | Data Architect + Software Architect, revisit at scale | P2 (backlog) |
| 12 | No automated "0 active jobs" / "admin disabled" alert — the exact failure mode causing #1–3 above could recur silently | Product Lead | DevOps/SRE (extend Ops Agent report rules) | P1 |

## Downgraded to unconfirmed (do not route to engineering yet)

- **UX finding #4** (misdirected focus, "Your email" field on `/post-a-job`
  step 1): QA could not reproduce across 3 independent attempts. Per team
  rule, an unreproduced finding is not sent to engineering as a bug. UX's own
  hypothesis (a hydration-timing race, most likely to appear on a cold/first
  load rather than a warm session) is worth one more targeted attempt —
  re-test immediately after a hard navigation/reload rather than mid-session,
  before this is either closed as noise or escalated.
- **Data Architect's test suite claim**: QA had no reachable Postgres
  instance in its sandbox to actually execute `scripts/test-db.sh`, so
  "all tests pass including the new file" is unverified, not disproven.
  Whoever has real DB access (the user, or an agent with the Supabase
  connection string) should run it once before relying on the new
  `50_data_architect.test.sql` coverage.

## Not routed to engineering (advisory / no action needed)

Everything in Data Architect's and Security's "informational — verified
sound" sections, and Product Lead's P2 items #6–10 (pricing visibility,
category taxonomy, digest signup, funnel structure, ingestion classifier) —
all confirmed already working as intended. No further action; re-verify only
if a future change touches those paths.

## Why #1–3 dominate this cycle

All three P0/P0/P0 items are the *same underlying failure class*: production
environment configuration was never fully completed after the schema push.
None are code defects — Product Lead, Security, and QA independently
converged on this from three different angles (product funnel, security
posture, and direct reproduction), which is a strong signal it's real and not
reviewer noise. Recommend DevOps/SRE closes all three in one pass (they're
all "set env vars in Vercel + push repo to GitHub + wire ingestion secrets +
run ingestion once"), since they block each other's verification — you can't
confirm digest/maintenance cron actually runs, or that admin-curated seed
jobs appear, until the env vars are set.

## Go/no-go (recorded, per Product Lead + this synthesis)

**No-go.** Product code (UI, pricing, funnel, taxonomy, RLS, webhook
security) is launch-ready. Three P0 operational gaps block launch, all
owned by DevOps/SRE, all independent of any further engineering work:
1. Set `ADMIN_PASSWORD`/`ADMIN_USERNAME` in Vercel production.
2. Set `CRON_SECRET` in Vercel production (and confirm Vercel Cron's
   configured schedule sends the matching header).
3. Push the repo to GitHub, wire `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
   as Actions secrets, and run ingestion for real (or hand-curate a starter
   set via `/admin/jobs/new` once unlocked) so the board isn't empty at
   launch.
