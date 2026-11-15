# Cycle 2 — pre-launch reviews (2026-11-14)

Three independent read-only reviews of the live site (https://agentjob-dev.vercel.app) and `main`.
Verified items were checked directly; "inferred" items were read from code or absence of evidence.
Verified by the lead afterwards: the two `\set` lines exist; `npm audit --omit=dev` reports 4 vulns
(1 critical, 3 high) in `next` and `zod`; `/api/jobs/recent` still returns HTTP 500 in production.

---

## 1. Principal Product Manager — READY-WITH-CONDITIONS

Prior cycle: the empty board is closed (≈307 ingested jobs live; OpenAI 72, Anthropic 72, Databricks 66,
LangChain 38, Scale 32, Cohere 16, Vercel 10, LlamaIndex 1). No seed jobs are live.
Still open/unverified: custom-domain mismatch (header renders "agentjobs.dev", `siteConfig.domain` is
"agentjob.dev", canonical is the vercel.app URL); ops report alert on "0 active jobs" unchecked; /admin not tested.

### Blockers (ranked)
1. No Terms, Privacy or Refund pages. `/terms`, `/privacy`, `/refund`, `/about` all 404; footer is only "© AgentJob".
   $149 Stripe charges + email collection → chargeback and GDPR/CCPA exposure.
2. Scraped-listing attribution/legal posture. Ingested job pages show only "Apply for this role" and the full
   company-authored description: no "via Greenhouse/Ashby/Lever" source line, no takedown/contact route.
   Add a visible source line, a removal-request email and a terms clause; verify each ATS's terms (inferred risk).
3. Niche dilution. Sitemap titles include "Application Security Engineer" (LangChain), "Senior Engineer
   Bioinformatics", "Research Scientist, Discovery Engineering" (Anthropic), "ML Data Scientist, Consumer
   Forecasting" (OpenAI), "Growth Data Science", "Partner Applied AI Engineer, Oracle ISV".
   `ingestion/agentjobs_ingest/classify.py` is too loose. Tighten before the first HN/X post.
4. Copy contradicts reality: `siteConfig.description` says "Hand-picked roles" but ~99% are auto-scraped.
5. Employer-side value unproven: 0 paid/curated listings; supply dominated by 7 large companies that do not need
   to pay $149; no traffic/candidate count/social proof for $149 (+$99 featured). "Google for Jobs" claim is
   inferred from JSON-LD (indexing unverified).
6. Email compliance unconfirmed in prod: digest needs `POSTAL_ADDRESS` (gated in `src/lib/env.ts:127`); could not
   verify it is set. One-click unsubscribe (RFC 8058) exists; double opt-in not checked.
7. `/api/jobs/recent` returns 500 in production (ops/marketing agent depends on it).

### Important, not blocking
- No share cards: `/opengraph-image` 404, no `og:image`, `twitter:card` is "summary".
- No analytics found (grep of `src`/`package.json`) — cannot measure apply clicks.
- No salary-less/low-quality gating, no "report a job" link, no saved jobs/company pages (inferred).
- Sitemap `lastmod`/`priority` static; ~300 cap may omit jobs; expired URLs not checked.
- Pricing: no tiers/discount/refund guarantee; invoice/receipt flow untested; no real checkout run.
- ~25% of the board depends on a few ATS slugs; a slug change silently removes them.
- `db/seed/sample_jobs.sql` would publish fictional "Cascade Systems"/"Meridian AI Labs" jobs with example.com
  apply links. Do not run in production; move to a dev-only path.

### Quick wins (<1 day each)
- Static `/terms`, `/privacy`, `/refund`, `/about` + footer with contact email, unsubscribe note, postal address.
- "Source: Ashby/Greenhouse/Lever, original posting" line + "Request removal" link on every ingested job.
- `opengraph-image.tsx` for site and per job; `twitter:card` = `summary_large_image`.
- Plausible or PostHog with events: apply_click, post_job_start, checkout_start, paid, digest_signup.
- Fix "Hand-picked" copy; add "Verified agent role" badge only where a strict classifier check passed.
- Fix `/api/jobs/recent` 500.
- Reconcile brand/domain ("agentjobs.dev" vs "agentjob.dev"); point canonical at final domain.
- "Why post here" block on `/post-a-job` once there is traffic.

### Suggested success metrics
Supply: share of listings passing agent-relevance (≥80%), share from beyond top 7 companies.
Demand: weekly uniques, search→apply-click rate (>15%), digest signups, week-4 open rate (>35%), unsubscribe (<1%).
Employer funnel: /post-a-job visits, 5-step completion, checkout started, paid conversion, refund requests;
first 3 paid listings in 30 days. SEO: indexed pages, Google for Jobs impressions. Quality: takedown requests,
404/expired rate of apply URLs.

---

## 2. Principal UX Designer — CONDITIONAL SHIP

Limits: built-in browser was stuck at ~500px in dark mode; no true desktop/tablet/light screenshots. Seen: home feed
and one job detail. NOT seen (code-read only): post-a-job, Stripe handoff, success/unsubscribe, 503 error page.
`docs/reviews/ux.md` is stale (describes an empty board; board now has 307 roles over 11 pages).

Overall: strong foundation, polished dark mode, credible dev-tool feel (Geist, mono accents, green accent), clear
card hierarchy (company → title → meta → tags), each card one big click target. The feed content works against the
design: it reads as scraped/unfiltered, off-topic roles tagged "Evals"/"MCP", heavy concentration in 3–4 companies,
undermining the hero's "no generic AI noise" promise.

### Blockers (ranked)
1. Feed relevance/trust: non-agent roles (bioinformatics, application security) under agent categories; generic
   "Evals" tag. Tighten ingestion/categorisation or soften hero copy.
2. Card density/locations: raw strings like "Remote-Friendly (Travel-Required) | San Francisco, CA | Seattle, WA |
   New York City, NY" wrap over several lines; most cards have no salary. Truncate/normalise to first location +
   "+2 more" in `src/components/job-meta.tsx` or in the data; consider "$ listed" filter/sort.
3. Contrast (estimated ~3.4:1, not measured): white 14px text on `bg-accent-600` (oklch(0.6 0.13 165)) — Apply button,
   Subscribe button, Featured pill. Use `accent-700`.
4. Post-a-job focus bug from old review (typing meant for email went into company field) — unverified, retest with
   real keyboard/mouse; this is the paid funnel.

### Important
- `src/app/error.tsx` hard-codes "503" for every error; "Reference: digest" is low-contrast `zinc-400`. Drop "503",
  use `zinc-500`.
- Filter chips scroll horizontally on mobile with hidden scrollbar; "Tool-Use…" chip cut off. Add fade/edge mask.
  Active vs inactive chips differ only by black/white fill.
- Job card stretched link: `focus-visible:outline-none` relies on `group-focus-within` ring (also triggers on inner
  tags). Minor.
- Job detail: "About <Company>" boilerplate precedes the role text; move role description above or collapse blurb.
  No salary label when missing; consider sticky apply bar on mobile.
- Digest card has sr-only label only; on mobile it sits below the feed. Consider inline prompt after 10th card.
- Search submits via hidden button; add visible search button on mobile.
- Reduced motion: only `post-job-form.tsx` handles it; `src/app/(board)/loading.tsx` `animate-pulse` ignores it →
  add `motion-reduce:animate-none`.

### Quick wins
- `bg-accent-600` → `bg-accent-700` for white-text buttons in `src/app/jobs/[slug]/page.tsx`,
  `src/components/subscribe-form.tsx`, `src/components/job-card.tsx`.
- Cap card tags at 5–6 with "+N" overflow (`src/components/tag-list.tsx`).
- Normalise multi-location strings, replace "|" separators (`src/components/job-meta.tsx`).
- Hide "503", raise reference contrast in `src/app/error.tsx`.
- All 307 cards use letter tiles; fetch real logos at ingestion or add company context.
- `aria-current` + visible "Jobs" nav state; skip-to-content link if absent (`src/app/layout.tsx`; unconfirmed).

### Already good
Empty/filtered-empty/end-of-results/404 states with recovery actions; filters are links (shareable, crawlable,
no-JS) in `src/components/filter-chips.tsx` + `src/lib/search-params.ts`; semantic HTML (`article`, `time dateTime`,
`nav aria-label`, ol results, `aria-live` count, labelled search); subscribe form honeypot, `role="alert"`,
`aria-invalid` + `aria-describedby`; pricing sidebar + 5-step progress in post-a-job; loading skeleton scoped to the
board group so job pages return real 404s; distinct Featured treatment; mono relative freshness.

---

## 3. Full-stack Developer — NO-GO today, GO after ~3 small fixes

[V] = verified, [I] = inferred. tsc and eslint clean [V]; security design is real.

### Blockers (ranked)
1. `next@16.3.5` has known critical/high advisories [V `npm audit --omit=dev`]: unauthenticated RCE in image
   optimization with SVG and in `use cache` with typed arrays (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr); high: DoS via
   Server Actions (GHSA-p3m5-59mp-jv5r) — used by this app; ISR/SSG cache poisoning (GHSA-mcj8-r9mp-w47p,
   GHSA-4jqv-mc3x-m676). `zod@4.6.5` high memory-exhaustion advisory (GHSA-mrhx-c7xc-m3w5), fixed in 4.6.6+.
   Fix: `next@16.4.6` and `zod@^4.6.7`, keep exact pins, update eslint-config-next, rerun full suite, read 16.4
   notes in `node_modules/next/dist/docs`.
2. Migrations `20260917000000_jobs_featured_within_window_chk.sql:22` and
   `20260917000100_search_jobs_published_after.sql:11` contain `\set ON_ERROR_STOP on` [V grep]. Supabase CLI
   `db push` / SQL editor send plain SQL → very likely syntax error [I]; this likely explains prod missing them and
   `/api/jobs/recent` 500 (route.ts calls `search_jobs` with `p_published_after` [V]). `scripts/test-db.sh` uses
   psql so it hides the problem. Fix: delete both `\set` lines; run `supabase db push --dry-run`; push.
   `20260917000200` (revoke client grants on `ingestion_runs`) only exists in PR #7 — merge it.
3. Prod env/config state unverified (P0 in `architecture-synthesis.md` #1-3, #12): `CRON_SECRET`, `ADMIN_PASSWORD`,
   ingestion secrets/workflows [I]. Run a launch smoke test: `/api/health`; cron routes with bearer secret; `/admin`
   returns 401; Stripe test-mode purchase to a live listing; first ingestion run; domain points at the app.

### Important, non-blocking
- No Content-Security-Policy header in `next.config.ts` (other headers present) [V]. Add report-only CSP first;
  inline JSON-LD and Next scripts need a nonce via `proxy.ts`.
- Paid-but-unpublished edge case: `activate_paid_job` (core_schema.sql:446) only transitions from `pending_payment`.
  If a delayed payment succeeds after `checkout.session.expired` set `payment_expired`, webhook returns 200
  `not_activatable`: customer charged, no listing. Fix: allow `payment_expired` → `active` when Stripe says paid
  (verified), or alert on `not_activatable`/`amount_mismatch` in ops report.
- `allow_promotion_codes: true` (checkout.ts): amount check uses pre-discount subtotal, so a 100%-off code publishes a
  free listing. Fine if intended; ensure only controlled coupons exist.
- Board `(board)/page.tsx` fully dynamic (reads `searchParams`): two Supabase round-trips per visit, no cache; Supabase
  down → generic 503 boundary with no stale fallback. Consider `unstable_cache`/`use cache` short TTL for
  `listCategories` and unfiltered page 1 (check 16.4 docs for exact API).
- Rate limiter fails open (rate-limit.ts) and trusts first `x-forwarded-for` (OK on Vercel); circuit-breaker/alert
  recommendation from earlier review (#8) not done.
- Ingestion revives expired jobs each run: `upsert_ingested_jobs` extends `expires_at = greatest(old, now+30d)` every
  6h for jobs still in a feed; stale ATS postings live forever. Rejected jobs protected (`status in
  ('active','expired')`).
- Unauthenticated `/admin` requests consume the failed-auth rate-limit bucket (first browser request before the
  credential prompt counts as failure; shared-NAT admins may see 429).
- CI: Actions pinned by tag, not SHA; e2e job needs app + db jobs; confirm db job green after #6.
- `.vercelignore` excludes `tests/` and `db/` — fine if build never needs them (Vercel builds succeed).

### Quick wins
Remove `\set` lines and merge #7; `npm audit fix` for next + zod; uptime monitor on `/api/health`; alert on non-2xx
from cron routes and on ops "0 active jobs"; canonical-link check on home; CI step running `supabase db push
--dry-run` or `supabase start` to catch CLI-incompatible migrations.

### Solid
Stripe webhook (raw-body `constructEvent`, 400 on bad signature, idempotent fulfilment across webhook + success page,
currency/subtotal checked vs server-side pricing, job id in metadata cross-checked, checkout idempotency key); admin
auth (constant-time digest comparison, failed-attempt rate limit, every action re-checks `assertAdmin()`, `returnTo`
regex-locked to `/admin…`); cron/ops `requireCronAuth` first with `timingSafeEqual` and generic 401; DB: `set
search_path = ''` on every function, `SECURITY DEFINER` only on subscribe/unsubscribe, execute revoked and re-granted
per function, RLS on, column-level anon grants on `jobs`, CHECK constraints on URL schemes; XSS: react-markdown with
`skipHtml`, no images, `rel="nofollow ugc"`, `dangerouslySetInnerHTML` only in JSON-LD with `<` escaped; no SSRF
surface [I for `http.py`]; ingestion safety (close only on complete clean feed, empty feed refused, per-row
subtransactions); digest (one run per ISO week, per-subscriber delivery rows, resumable) [I]; per-feature zod env
validation; health route and error/not-found boundaries.

Not verified: vitest could not run locally (missing rolldown native binding) → CI is source of truth; pytest, SQL
tests, e2e not run; live production untouched; `typecheck` runs `next typegen` first (plain `tsc` fails on typed routes).
