# AgentJobs.dev

A focused job board for **AI agent and multi-agent systems engineers**: orchestration, tool-use backends, local LLM infrastructure, retrieval and memory, evals.

Stack: **Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · Supabase (PostgreSQL) · TypeScript (strict)**.

This repository is at **Phase 1: core initialisation and database schema**. The public feed, search, filters, job pages and the digest signup all run against the real schema.

---

## Quick start

```bash
nvm use                      # Node 22 (see .nvmrc; Next 16 needs >= 20.9)
npm ci
cp .env.example .env.local   # fill in SUPABASE_URL and SUPABASE_ANON_KEY

# Apply the schema to your Supabase project
npx supabase link --project-ref <your-project-ref>
npx supabase db push

npm run dev                  # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and server. The build needs **no** database credentials. |
| `npm run typecheck` | Generates Next route types, then runs `tsc --noEmit` |
| `npm run lint` | ESLint (Next core-web-vitals + TypeScript rules; `TODO`/`FIXME` comments fail the lint) |
| `npm run check` | Typecheck, lint and build |
| `npm run test:db` | Applies every migration to a throwaway Postgres database and runs the schema contract tests (needs `psql` and `DATABASE_ADMIN_URL`) |

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | yes | Project URL. Read on the server only. |
| `SUPABASE_ANON_KEY` | yes | The anon JWT or an `sb_publishable_…` key. An `sb_secret_…` key is refused at startup. |
| `NEXT_PUBLIC_SITE_URL` | production | Canonical origin for metadata, the sitemap and JSON-LD. Falls back to `VERCEL_PROJECT_PRODUCTION_URL`, then `http://localhost:3000`. |

Environment variables are checked the first time a request needs the database. A missing or wrong value produces a clear `EnvConfigError` in the logs, a 503 from `/api/health` and the error page for visitors. The build and static routes are not affected.

---

## Project layout

```
supabase/
  config.toml
  migrations/
    20260915000000_core_schema.sql       enums, tables, indexes, RLS, grants, RPCs
    20260915000100_schedule_job_expiry.sql  pg_cron sweep (skipped where pg_cron is absent)
db/tests/
  00_supabase_bootstrap.sql              recreates Supabase roles on plain Postgres
  10_schema.test.sql                     contract tests (run in one transaction, then rolled back)
scripts/test-db.sh
src/
  app/
    (board)/page.tsx                     feed: search, category/workplace/tag filters, pagination
    (board)/loading.tsx                  loading skeleton, scoped to the feed only (see Decisions)
    jobs/[slug]/page.tsx                 job page: Markdown, JSON-LD JobPosting, ISR (5 min)
    api/health/route.ts                  checks the app and the database for uptime monitors
    actions.ts                           server action for the digest signup
    layout.tsx, error.tsx, global-error.tsx, not-found.tsx
    sitemap.ts, robots.ts, icon.svg, globals.css
  components/                            UI components (server by default; client only where needed)
  lib/
    database.types.ts                    Supabase-generated shape (can be regenerated in place)
    env.ts                               lazy, zod-validated server env
    supabase/server.ts                   server-only Supabase client (public key, 8 s timeout)
    jobs.ts                              data access layer; the only module that queries
    search-params.ts                     turns untrusted URL params into typed filters
    validation.ts                        zod schemas that match the database CHECK rules
    format.ts, site.ts, types.ts
```

---

## Architecture decisions

**Visibility is enforced in the database, not in the app.** A job is public when `status = 'active' and expires_at > now()`. The RLS policy applies this rule, and so does the `search_jobs` RPC. An expired listing disappears even if the expiry sweep has not run yet.

**The lifecycle is an enum, not an `is_active` boolean.** The statuses are `draft → pending_payment → active → expired | rejected`. This keeps "paid but not yet published" separate from "expired". CHECK constraints make invalid states impossible to store:

- an active job must have a valid publishing window
- a `pending_payment` job must have a Stripe session
- a featured job must have `featured_until`

**Categories live in a reference table.** Jobs point to them with a foreign key, so filters and stored data cannot drift apart. Seven categories are seeded by the migration.

**Anonymous users can only read public columns.** Supabase's default `GRANT ALL` is revoked. `anon` and `authenticated` get column-level `SELECT` on `jobs`, so these columns can never be read with the public key:

- `stripe_checkout_session_id`
- `employer_id`
- `source_name` and `external_id`

`employers` and `subscribers` have RLS enabled and no client policies at all.

**Writes go through narrow RPCs:**

- `subscribe_to_digest(email, source)` is a security-definer function that anyone can call. It normalises and validates the email. It returns the same response for new and existing addresses, so it cannot be used to check who is subscribed, and it never re-subscribes someone who opted out.
- `activate_paid_job(session_id, featured, days)` can only be called by `service_role`. Calling it again with the same session is safe, because Stripe can deliver a webhook more than once. The Phase 2 webhook only needs to call this function.
- `expire_jobs()` can only be called by `service_role`. pg_cron runs it every 15 minutes.

**Search uses Postgres full-text search.** A generated, weighted `tsvector` column ranks the title and tags (A), company (B), location (C) and description (D), with a GIN index. `websearch_to_tsquery` accepts user-style syntax. Queries that are blank or contain only stop words count as "no query". Partial indexes cover the feed, category, workplace and expiry lookups. GIN on `tags` covers tag filters. A partial unique index on `(source_name, external_id)` makes ingestion safe to re-run.

**No new extensions.** Emails are stored lower-cased and checked with a CHECK constraint, so `citext` is not needed. `array_to_string` is not immutable, so a small immutable wrapper feeds the generated column.

**Slugs are created in the database.** A trigger builds `title-at-company-<8 hex>` from the row id. Parts that produce an empty slug (for example non-Latin text) are dropped, with `job` as the final fallback.

**All data access is server-side.** The browser never talks to Supabase in Phase 1. The client uses the public key, has no session, and is shared within the server process. Each request has an 8-second timeout. The health probe turns off supabase-js retries so it reports the real current state.

**Rendering:**

- The feed is dynamic, because filters live in the URL.
- Job pages use ISR (`revalidate = 300`, rendered on first request), and the webhook can revalidate a page immediately.
- The loading skeleton is scoped to the `(board)` route group. At the root it would make every page stream, and then `notFound()` on a job page could only return a soft 404 (HTTP 200) instead of a real 404.

**UI principles:**

- Every filter is a link, so filtered views can be shared, crawled and used without JavaScript.
- Instant search updates `?q=` after a 300 ms pause and replaces the history entry. Its input is uncontrolled, so a late URL update never overwrites what the user is typing.
- Employer logos use a plain `<img>`, so the Next image optimizer is never an open proxy. If a logo is missing or fails to load, the company's initials are shown instead.
- In employer Markdown, raw HTML and images are dropped, `javascript:` links become plain text, and headings are moved down one level so each page keeps a single `<h1>`.

---

## QA and Critic review log

Issues found during Phase 1 and fixed before delivery:

1. **Default privileges leaked columns.** Supabase grants `ALL` to `anon`, which would have exposed billing columns. Fix: revoke, then grant column-level access. A regression test covers it.
2. **`array_to_string` is `STABLE`,** so Postgres rejects it in a generated column. Fix: an immutable wrapper.
3. **Tag validation missed `NULL` elements,** because `bool_and` ignores nulls. It also accepted trailing spaces and multi-dimensional arrays. Fix: explicit null, end-character and dimension checks.
4. **Fallback slugs such as `at-xxxx`.** Non-Latin titles produced these. Fix: drop empty parts.
5. **Stop-word-only search returned zero rows.** Fix: an empty `tsquery` now counts as no query.
6. **Unbounded paging arguments.** Fix: `search_jobs` limits `limit` to 1–100 and `offset` to 0–10,000.
7. **Soft 404s.** The root `loading.tsx` made job pages return HTTP 200 on `notFound()`. Fix: scope the loading skeleton to the feed route group.
8. **Search box race.** "Clear filters" left stale text in the search box, and a controlled input could lose keystrokes. Fix: an uncontrolled input that re-syncs from the URL when it is not focused.
9. **Slow health probe.** Automatic retries made it take about 7 s against a database that refused connections. Fix: a single attempt, which now takes about 70 ms.
10. **Unsafe Markdown output.** Raw HTML showed up as literal text, and blocked `javascript:` links still rendered as `href=""`. Fix: `skipHtml`, and links without a URL render as text.
11. **Impure render.** `Date.now()` was called during render (flagged by react-hooks/purity). Fix: the data layer now returns a `fetchedAt` timestamp.
12. **Mobile layout.** The email field collapsed in the stacked layout, and the header wrapped. Fix: responsive sizing adjustments.

Verification run:

- **Schema tests on PostgreSQL 16.** 88 assertions cover constraints, triggers, RLS, column grants, RPC permissions, webhook idempotency, the expiry sweep and search ranking and filters. Mutation checks confirmed the suite catches a removed revoke, a loosened RLS policy and a changed conflict rule.
- **Index usage on 50k rows.** `EXPLAIN` shows the GIN index is used for text search and the partial feed and category indexes for listing queries.
- **App checks.** `tsc` (strict, `noUncheckedIndexedAccess`), ESLint and `next build` all pass with no database credentials.
- **Browser tests (Playwright).** These ran against an HTTP stub that imitates Supabase's REST API (PostgREST), so they did not use a real Supabase instance. They covered:
  - instant search, Escape to clear, and combined filters
  - "Clear filters" resetting the search box
  - digest signup: invalid email, backend failure and success, with the email normalised
  - logo fallback
  - no horizontal overflow on mobile
  - dark mode
  - no XSS through the Markdown description or the JSON-LD block
- **Failure modes.**
  - Missing env: 503 from `/api/health`, the error page for visitors.
  - A service-role key used as the public key: refused.
  - Database unreachable: 503 in about 70 ms.
  - Unknown or malformed slug: a real 404.

---

## Next phases

- **Phase 2: employer self-serve posting.** A multi-step form, Stripe Checkout ($149 listing, $99 featured add-on), and a webhook that calls `activate_paid_job` and then `revalidatePath`.
- **Phase 3: ingestion.** A Python script that upserts on `(source_name, external_id)` using the service role.
- **Digest delivery.** A weekly send to `subscribers where unsubscribed_at is null`, with an unsubscribe link built from `unsubscribe_token`.
