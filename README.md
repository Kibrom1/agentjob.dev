# AgentJob.dev

A job board for **AI agent and multi-agent systems engineers**: orchestration, tool-use backends, local LLM infrastructure, retrieval and memory, evals.

| Layer | Technology |
| --- | --- |
| Web app | Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · TypeScript (strict) |
| Data | Supabase Postgres (RLS, column grants, SQL RPCs) |
| Payments | Stripe Checkout and webhooks |
| Email | Resend: weekly digest and posting confirmations |
| Ingestion | Python 3.11+ reading public Greenhouse, Lever and Ashby job boards |
| Hosting | Vercel (the app and its scheduled jobs) and GitHub Actions (ingestion) |

The review behind each design decision is in [`docs/design-debate.md`](docs/design-debate.md).

---

## 1. Architecture and data flow

```
Browser ── /, /jobs/[slug] ─────────▶ Next.js (anon key, RLS) ──────────────┐
Employer ─ /post-a-job ─▶ server action ─▶ create_job_posting (draft)       │
                              └─▶ Stripe Checkout (price set on server) ─▶ Stripe
Stripe ─── webhook ──▶ /api/stripe/webhook ─ verify signature + amount ─▶   │
                         activate_paid_job ─▶ revalidate ─▶ confirmation email (Resend)
Vercel Cron (daily) ─▶ /api/cron/digest   ─ Mondays; resumes unfinished runs ─▶ Resend
Vercel Cron (daily) ─▶ /api/cron/maintenance ─▶ run_maintenance()           │
Admin ── Basic auth ─▶ /admin (proxy.ts + per-action check, service role)   │
Mail client ─ POST ──▶ /api/unsubscribe/[token] (RFC 8058 one-click)        │
GitHub Actions (6h) ─▶ python -m agentjobs_ingest ─▶ upsert_ingested_jobs ──┤
Ops agent (daily) ──▶ /api/ops/report (read-only, CRON_SECRET),            │
                       /api/jobs/recent (public) ─▶ drafts + a digest to you
                                                                            ▼
                                     Supabase Postgres (+ pg_cron every 15 min)
```

**Job lifecycle.**

- **Paid posting:** `draft` → `pending_payment` → `active` → `expired`
- **Abandoned or failed checkout:** `pending_payment` → `payment_expired`
- **Admin moderation:** a job can move to `rejected`, and back to `active` when restored.

**What a visitor sees.**

- **Public visibility:** only jobs with `status = 'active'` and `expires_at > now()` are shown. This is enforced in the database.
- **Featured jobs:** pinned to the top while `featured_until > now()`.

**Guarantees.**

- **Publishing only follows real payment.** A job goes live only after a signature-verified Stripe event whose pre-discount subtotal matches the price set on the server. If the webhook is late, the success page asks Stripe directly and publishes through the same code path, which is safe to run twice.
- **Ingestion never loses listings to a bad fetch.** It updates rows keyed on `(source_name, external_id)`. It closes jobs missing from a feed only when that feed was fetched completely and cleanly. It never brings back a job an admin rejected.
- **The weekly digest cannot double-send.** There is one run row per ISO week and one delivery row per subscriber. Each batch carries a deterministic idempotency key, so the daily cron can safely resume after a timeout.
- **Clients never write to tables directly.** Browser-side writes go only through RPCs. Service-role code runs only on the server (enforced by `server-only`).

---

## 2. Repository layout

```
src/
  app/
    (board)/page.tsx, loading.tsx        feed: instant search, filters, pagination
    jobs/[slug]/page.tsx                 job page (Markdown, JobPosting JSON-LD, ISR)
    post-a-job/page.tsx, actions.ts      multi-step posting flow → Stripe Checkout
    post-a-job/success/page.tsx          payment confirmation (with direct Stripe check)
    admin/…                              stats, moderation, curated listings
    unsubscribe/[token]/…                confirm-to-unsubscribe page
    api/stripe/webhook                   Stripe events
    api/cron/digest, api/cron/maintenance
    api/unsubscribe/[token]              one-click unsubscribe
    api/health                           checks the app and the database for uptime monitors
    api/ops/report                       observability + flags for the ops agent (CRON_SECRET)
    api/jobs/recent                      public feed of recent listings, for marketing drafts
    actions.ts                           digest signup
  components/                            UI (post-job/, admin/, feed components)
  lib/
    posting/  stripe/  email/  digest/  admin/  supabase/  ops/
    env.ts (config checks per feature) · rate-limit.ts · jobs.ts · validation.ts
  proxy.ts                               Basic-auth gate for /admin
supabase/migrations/                     6 migrations (schema → posting/ingestion/digest → admin → ops observability)
db/tests/                                SQL contract tests (schema, operations, admin, ops observability)
ingestion/                               Python package, sources.yaml, pytest suite
tests/unit/                              Vitest unit and integration tests
tests/e2e/                               PostgREST shim, Stripe/Resend doubles, Playwright scenario
scripts/test-db.sh, scripts/test-e2e.sh
vercel.json                              scheduled jobs (Vercel Cron)
.github/workflows/ci.yml, ingest.yml     CI and scheduled ingestion
```

---

## 3. Local setup

**Requirements:** Node 22 (`.nvmrc`), Python 3.11 or newer, the PostgreSQL 15+ client (`psql`), and a Supabase project.

```bash
nvm use
npm ci
cp .env.example .env.local
```

> 🔐 **Needs your credentials.** Fill in `.env.local` with your own keys. The table below says where each one comes from. Nothing in this repository contains real secrets.

| Variable | Where to get it | Needed for |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Supabase → Project Settings → API | everything |
| 🔐 `SUPABASE_SERVICE_ROLE_KEY` | same page (service_role / `sb_secret_…`) | posting, admin, digest, rate limits, ingestion |
| 🔐 `STRIPE_SECRET_KEY` | Stripe → Developers → API keys | posting |
| 🔐 `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks (or `stripe listen`) | posting |
| 🔐 `RESEND_API_KEY` | Resend → API Keys | digest and confirmation emails |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | an address on a domain you verified in Resend | email |
| `POSTAL_ADDRESS` | your business mailing address (required by CAN-SPAM) | digest |
| 🔐 `CRON_SECRET` | `openssl rand -hex 32` | scheduled jobs |
| 🔐 `ADMIN_USERNAME`, `ADMIN_PASSWORD` | choose them (password: 12+ characters) | `/admin` |
| `NEXT_PUBLIC_SITE_URL` | your public origin | canonical links and emails |

When a variable is missing, only the feature that needs it is turned off, and the error message names the variable. The public board runs with just the Supabase URL and anon key.

### 3.1 Database

> 🔐 **Needs access to your Supabase project.** Run these yourself:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push          # applies all migrations in supabase/migrations
```

The migrations enable `pg_cron` and schedule `run_maintenance()` every 15 minutes wherever the extension is available, which includes Supabase. If `pg_cron` was unavailable when you ran the migrations, enable it under Database → Extensions and re-run the `do $migration$ … $migration$` block from `20260916000100_posting_ingestion_digest.sql` in the SQL editor. The daily Vercel cron job also runs the same maintenance as a backstop.

### 3.2 Run the app

```bash
npm run dev                    # http://localhost:3000
```

To test payments locally:

> 🔐 **Needs your Stripe account.**

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook   # prints whsec_… → STRIPE_WEBHOOK_SECRET
```

Pay with card `4242 4242 4242 4242`.

### 3.3 Run ingestion

```bash
cd ingestion
python -m venv .venv && source .venv/bin/activate
pip install -e ".[test]"
python -m agentjobs_ingest validate-config
python -m agentjobs_ingest run --dry-run                       # no writes, prints a JSON summary
```

For a live run:

> 🔐 **Needs your service-role key.**

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… python -m agentjobs_ingest run
```

**Editing the source list.** Boards are listed in `ingestion/sources.yaml`.

- **Adding a board:** add the provider and the board token from the company's careers URL.
- **Checking one board:** `--dry-run --source ashby:<board>`.
- **If a token is wrong:** the board is reported as `not_found`, and the run still succeeds unless you pass `--strict`.

**Which roles get published.** Only roles that pass two checks:

- the title is an engineering title
- the posting shows enough agent/LLM signal (see `ingestion/agentjobs_ingest/classify.py`)

A generic role at an AI company doesn't qualify on company boilerplate alone.

---

## 4. Tests

| Command | What it covers |
| --- | --- |
| `npm test` | Vitest (104 tests): posting schema, pricing, Checkout parameters, Stripe fulfillment and webhook route (real signatures), digest batching and resume, email templates, Resend retries, admin/cron authentication, ops report flags, env checks, search and formatting |
| `npm run test:ingest` | pytest (98 tests): Greenhouse/Lever/Ashby parsers (recorded-shape fixtures), pagination, retries, classifier, normalizer, pipeline safety rules (including ingestion-run logging), CLI, config, RPC client |
| `npm run test:db` | SQL contract tests on real Postgres: schema, RLS, grants, every RPC and lifecycle transition, ingestion observability. Set `RUN_INGEST_CONTRACT=1` to also check that Python payloads are accepted by the real RPC. |
| `npm run test:e2e` | 18-step Playwright scenario (details below) |
| `npm run check` | typecheck, lint, unit tests and build |

The two database suites need `DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres`. They create and drop their own throwaway databases.

**What the end-to-end suite runs against.** A production build, all migrations on real Postgres (through a small PostgREST-compatible shim that enforces RLS), and local Stripe and Resend test doubles. It covers:

- the posting form, webhook forgery and underpaid-amount checks, and publishing
- the late-webhook fallback, cancel and restore of a draft, and expired checkouts
- featured pinning and search
- digest signup, sending, one-click unsubscribe and the confirmation page
- cron authentication, admin moderation, curated listings, the ops report and recent-jobs feed, health checks and the sitemap

It needs Chromium: run `npx playwright install chromium` once.

---

## 5. Deploying to Vercel

1. **Import the repository.** Import the whole repo; Vercel detects Next.js at the root. The `ingestion/`, `supabase/`, `db/`, `tests/` and `docs/` folders are never bundled.
2. **Add environment variables.**
   > 🔐 **Needs your secrets.** Add every variable from section 3 under Project → Settings → Environment Variables.

   Set `NEXT_PUBLIC_SITE_URL` for Production only. Preview deployments then use their own URL for Stripe redirects.
3. **Set up the Stripe webhook.**
   > 🔐 **Needs your Stripe account.** In Stripe → Webhooks, add `https://<domain>/api/stripe/webhook` with these events:
   > - `checkout.session.completed`
   > - `checkout.session.async_payment_succeeded`
   > - `checkout.session.async_payment_failed`
   > - `checkout.session.expired`

   Copy its signing secret into `STRIPE_WEBHOOK_SECRET`. Use a separate endpoint and secret for test mode.
4. **Verify the sending domain.**
   > 🔐 **Needs access to your DNS.** Verify it in Resend (SPF/DKIM) before the first digest goes out.
5. **Scheduled jobs.** `vercel.json` sets up two daily jobs:
   - digest at 14:00 UTC; it starts on Mondays and resumes any unfinished run
   - maintenance at 03:30 UTC

   Vercel sends `Authorization: Bearer $CRON_SECRET` automatically once `CRON_SECRET` is set. To send the digest immediately:

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" "https://<domain>/api/cron/digest?force=1"
   ```
6. **After deploying.**
   - `GET /api/health` should return `{"status":"ok"}`.
   - `/admin` should ask for credentials.

### GitHub Actions

> 🔐 **Needs write access to the repository settings.**

- **Workflow files:** `.github/workflows/ci.yml` (lint, tests, build, database and end-to-end suites) and `ingest.yml` (every 6 hours). If they are not in the repository yet, copy them into `.github/workflows/`.
- **Secrets:** add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` under Settings → Secrets and variables → Actions. Ingestion needs them.
- **First run:** run **Ingest jobs** manually with `dry_run: true`, check the summary, then run it for real so the board isn't empty at launch.

---

## 6. Operations

**Admin console (`/admin`).** Shows live, featured, paid and subscriber counts, and the status of the last digest. You can filter jobs by status, search them, and:

- reject, restore, feature, unfeature, or extend a listing by 30 days
- publish a curated listing without payment

**Rate limits.** Stored in Postgres with hashed IP addresses:

| Action | Limit per IP |
| --- | --- |
| Job postings | 10 per hour |
| Digest signups | 5 per hour |
| Unsubscribe confirmations | 30 per hour |

If the rate limiter itself fails, requests are allowed through rather than blocked.

**Refunds and disputes.** Handle them in Stripe, then reject the listing in `/admin`.

**Changing prices.** Edit `src/lib/posting/pricing.ts`. The webhook checks payments against these same values.

**Ops agent.** A daily scheduled task reads `GET /api/ops/report` (Bearer `CRON_SECRET` — same secret as the other cron routes, nothing new to generate) and `GET /api/jobs/recent`, then sends you a short digest: anything that needs attention (a stalled ingestion source, a stuck digest run, an empty board) plus draft social posts for newly published listings. It is read-only — no admin action or social post happens without you. See [`docs/ops-agent.md`](docs/ops-agent.md) for the design, and point it at your deployed URL once the site is live.

---

## 7. Review & QA agent team

Separate from the build team above, a second team exists to interrogate the
finished product rather than build it: Product Lead, UX Designer, Software
Architect, Data Architect, Testing/QA Engineer, Full-Stack Engineer, plus
Security & Compliance, DevOps/SRE, and Growth/Monetization seats. Each has a
narrow mandate, a required output artifact, and a defined place in a review
cycle (parallel first pass → Architect synthesis → QA reproduction → fix pass
→ QA re-verification → Product Lead go/no-go).

See [`docs/agent-team-guidelines.md`](docs/agent-team-guidelines.md) for the
full roster and interaction rules, and [`docs/reviews/`](docs/reviews/) for
past cycles' findings and the running changelog of what's been closed.
