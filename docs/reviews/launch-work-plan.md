# AgentJob.dev — Launch Work Plan (Cycle 2)

Author: Software Architect. Date: 2026-11-14. Inputs: `cycle-2-prelaunch-reviews.md` (PM / UX / Dev),
`agent-team-guidelines.md`, `architecture-synthesis.md`, plus direct verification against `main`.
Review refs below: PM-n / UX-n / DEV-n = the numbered blockers in each section of the cycle-2 file;
"PM-imp", "UX-imp", "DEV-imp" = the "Important" lists.

Rules for every package (from the guidelines): read every writer before adding a constraint; additive RPC
signatures; write DB tests even if you cannot run them and mark them unexecuted; do not self-close PM/UX
findings; Next.js here has breaking changes, so read the relevant page under `node_modules/next/dist/docs/01-app/`
before touching any Next API (file conventions, metadata, proxy, caching, headers). One PR per package.
Do not add or bump dependencies outside WP-1 (package.json / package-lock.json are WP-1's file).

---

## 1. Architectural summary and decisions

The product code is sound; launch risk is concentrated in (a) a vulnerable framework pin, (b) migrations that
cannot be applied by the Supabase CLI, (c) missing legal/attribution surface for a scraped-listing board, and
(d) a feed that does not match the hero promise. Nothing needs a new service or a schema redesign.

### Verification of review claims

| Claim | Result |
|---|---|
| `\set ON_ERROR_STOP on` in two migrations | CONFIRMED: `20260917000000_..._chk.sql:22`, `20260917000100_..._published_after.sql:11`. (Other `\set`/`\echo` hits are in `db/tests/*`, run only by psql: legitimate.) `scripts/test-db.sh` uses `psql -v ON_ERROR_STOP=1 -f`, so it masks the problem. |
| `/api/jobs/recent` 500 is a separate bug | CORRECTED: not separate. Route calls `search_jobs` with `p_published_after` (route.ts), which exists only in the unapplied migration. Fixed by WP-2 + human push; no route code change. Listed by PM-7 and DEV-2: deduplicated. |
| Migration `20260917000200` only in PR #7 | CONFIRMED (PR #7 "revoke client grants on ingestion_runs", branch `fix/db-test-search-jobs-signature`; not on `origin/main`). `db/tests/50` asserts the revoke, so CI on main is red/inconsistent until #7 merges. |
| Classifier "too loose" (PM-3, UX-1) | CONFIRMED with nuance. `classify.py` body path scores `2*distinct core terms + 0.5*support`, threshold 6, and the core list includes `llm(s)`, `large language model(s)` and `agents?`. Company boilerplate ("we build large language models ... agents") plus an AI-ish body clears 6 for ANY engineering title. Reproduced on all named titles (Application Security Engineer, Bioinformatics, Discovery Engineering, Consumer Forecasting, Partner Applied AI Engineer): all pass today with boilerplate-style bodies. "Growth Data Science" is NOT admitted by this code (no engineering word in title): that sitemap title most likely came from an earlier rule or a title like "Data Science Engineer"; check live data, do not assume. |
| "Hand-picked" copy | CONFIRMED `src/lib/site.ts:33`. Hero copy "no generic AI noise" (`(board)/page.tsx`) is also an overclaim until WP-5 is live. |
| Domain mismatch | CONFIRMED: `src/components/logo.tsx` renders "agentjobs.dev"; `siteConfig.domain` = "agentjob.dev"; canonical derives from `NEXT_PUBLIC_SITE_URL` / `VERCEL_PROJECT_PRODUCTION_URL` (vercel.app today). Admin sentinel `admin@agentjobs.invalid` is internal and harmless. |
| `error.tsx` hard-codes "503", digest `zinc-400` | CONFIRMED. |
| `animate-pulse` ignores reduced motion in `(board)/loading.tsx` | CONFIRMED (also `animate-spin` in `job-search-box.tsx` and `post-a-job/success/page.tsx`). |
| White text on `bg-accent-600` | CONFIRMED in 7 files. NOTE: `globals.css` defines no `accent-800` token and `hover:bg-accent-700` is used today, so the fix needs a new hover token (see WP-7). |
| No source attribution | CONFIRMED. NOTE: `source` / `source_name` are NOT in the anon column grant (`core_schema.sql:554`) nor in `JOB_DETAIL_COLUMNS` (`jobs.ts`). |
| "Ingestion revives expired jobs forever" (DEV-imp) | CORRECTED / mostly wrong: `upsert_ingested_jobs` with `close_missing` expires ingested jobs that disappear from a complete, non-empty feed. Only postings the ATS itself still lists stay live, which is correct. Not a work item (deferred, section 5). |
| Ops alert on "0 active jobs" | CONFIRMED MISSING: `src/lib/ops/report.ts` has no live-jobs flag (stats has `live_jobs`). Added in WP-10. |
| `not_activatable` / `amount_mismatch` not alerted | CONFIRMED: only returned as webhook outcomes in `fulfillment.ts`. WP-10. |
| `/admin` first unauthenticated request consumes failed-auth bucket | CONFIRMED by reading `src/proxy.ts` (any non-authorized request incl. missing header). Minor: WP-11. |
| No CSP | CONFIRMED (`next.config.ts`). |
| No OG image / `twitter:card: summary` | CONFIRMED in `layout.tsx` and `jobs/[slug]/page.tsx`. |
| No analytics | Not re-verified beyond a grep; accepted. |
| Exact patched versions (`next@16.4.6`, `zod@^4.6.7`) | NOT VERIFIED (no network). WP-1 must take versions from `npm audit` output, not from the review. |
| vitest could not run locally (rolldown binding) | Environment issue; CI is source of truth. |

### Decisions

1. **Dependencies first, alone.** WP-1 is the only package allowed to touch `package.json`, the lockfile and
   `eslint-config-next`. Everything else treats deps as frozen. Rationale: the upgrade can force Next API changes
   and big lockfile diffs; isolating it avoids unresolvable conflicts.
2. **Migration fix = edit the two unapplied files in place** (they have never been applied to prod; confirm with
   `supabase migration list`, HUMAN). Rationale: avoids a pair of no-op "repair" migrations and keeps history clean.
   Add a CI guard so this cannot recur: no `^\s*\\` lines in `supabase/migrations/*.sql`.
3. **Source attribution without a migration.** Derive the source label from `apply_url` host
   (`boards.greenhouse.io`/`job-boards.greenhouse.io` -> Greenhouse, `jobs.ashbyhq.com` -> Ashby, `jobs.lever.co` ->
   Lever) in a pure helper. No grant change, no prod SQL dependency, works for already-ingested rows. Employer-posted
   listings whose apply link points at an ATS will also show "Application hosted on ...": worded so that is accurate
   for both. An explicit `source` column exposure is deferred.
4. **Legal text is placeholder-only.** One config module (`src/lib/legal.ts`) holds company name, contact email,
   postal address and "last updated"; each unfilled value is a visible `[[PLACEHOLDER: ...]]` token. Pages describe
   only what the code actually does (data collected, Stripe, Resend, Supabase, cookies none, refund = placeholder
   policy). No invented legal claims, no GDPR/CCPA certification language. A launch gate script fails if any
   `[[PLACEHOLDER` remains (HUMAN runs it before go-live; it is deliberately NOT in CI so PRs stay green).
5. **Classifier: deterministic rule change, not an LLM.** Separate "agent-family" evidence from generic "LLM"
   evidence, require agent-family hits for the body path, add a domain-title denylist, add `partner` to excluded
   titles. Previously ingested non-matching jobs are expired automatically by the next complete run
   (`close_missing`), so no data migration. Strictness is a HUMAN call (WP-5 gives the dial).
6. **Contrast fix via a new `accent-800` token plus `accent-700` base** on white-text buttons, rather than
   redefining `accent-600` (which is also used as text colour and for the progress bar).
7. **CSP ships report-only, static, in `next.config.ts`** (no nonce, so no forced dynamic rendering; the board is
   already dynamic but job pages should stay cacheable-ish). Enforcement is deferred until reports are clean.
8. **No analytics code before launch.** Turn on Vercel's built-in Web Analytics in the dashboard (HUMAN, cookieless,
   no banner). Event plan documented in WP-13 for post-launch.
9. **Cache the board page: deferred.** Risky with `searchParams`-driven dynamic rendering and a Next version that
   just changed; benefit is nil at launch traffic.
10. **Merge PR #7 as-is** (HUMAN/maintainer click); WP-2 is written to work with or without it already merged.

---

## 2. Work packages

Priority: P0 = launch blocker, P1 = fix before launch if at all possible, P2 = post-launch.
"HUMAN" marks items a developer cannot decide or perform.

### WP-1 — Dependency security upgrade (next, zod)  [P0]

- Source: DEV-1 (verified via `npm audit --omit=dev`: 1 critical, 3 high).
- Files: `package.json`, `package-lock.json`; only if the upgrade requires it: files that use changed Next APIs
  (find via typecheck/build), `eslint.config.*`, `next.config.ts` (config keys only; NOT headers, WP-11 owns those).
- Steps:
  1. On a clean branch: `npm audit --omit=dev` and record the output in the PR description. Take the patched
     versions from the advisories (review suggests next 16.4.6, zod >=4.6.7; verify).
  2. Bump `next` and `eslint-config-next` together to the same exact version; bump `zod` exact. Keep exact pins
     (repo convention). `npm install`, commit the lockfile.
  3. Read `node_modules/next/dist/docs/01-app/02-guides/upgrading/` for the 3 -> 4 minor notes and the
     `file-conventions/proxy.md`, `metadata`, `headers` pages; fix every deprecation/typing break.
  4. Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` (needs Postgres + psql).
  5. Re-run `npm audit --omit=dev`: must be 0 critical/high. Anything left: document and justify in the PR.
- Acceptance: audit shows no critical/high in production deps; all CI jobs green; `src/proxy.ts` still protects
  `/admin` (unit test `tests/unit/proxy.test.ts` passes); webhook route test passes; pages render in e2e.
- Tests: no new tests expected; fix existing ones if API types changed. If vitest cannot run locally, rely on CI.
- Risks: breaking changes in typed routes/proxy/metadata; zod 4 minor schema behaviour changes (env tests).
  Mitigation: small PR, nothing else bundled.
- HUMAN: none for the code. After merge, HUMAN verifies the Vercel preview loads and promotes.

### WP-2 — Fix unappliable migrations + CI guard  [P0]

- Source: DEV-2 (and the `/api/jobs/recent` 500 in PM-7).
- Files: `supabase/migrations/20260917000000_jobs_featured_within_window_chk.sql`,
  `supabase/migrations/20260917000100_search_jobs_published_after.sql`, NEW `scripts/check-migrations.sh`,
  `.github/workflows/ci.yml` (add one step/job), NEW `db/tests/60_migration_hygiene.test.sql` is NOT needed.
- Steps:
  1. Delete the `\set ON_ERROR_STOP on` line from both files (keep surrounding comments). Do not change any SQL
     semantics. Confirm with `git diff` that only that line is removed.
  2. `scripts/check-migrations.sh`: `set -euo pipefail`; `grep -nE '^\s*\\[a-zA-Z]' supabase/migrations/*.sql` and exit 1
     with file:line if anything matches (psql meta-commands start with a backslash: `\set`, `\echo`, `\i`, `\c`,
     `\connect`). Allow `\\` only inside dollar-quoted bodies is NOT needed; keep it strict and simple. Also fail if
     filenames do not match `^[0-9]{14}_[a-z0-9_]+\.sql$` or timestamps are duplicated.
  3. Wire into `ci.yml` as a first step of the `database` job (before `test-db.sh`) and make it runnable locally.
  4. Run `./scripts/test-db.sh` if a Postgres is reachable (otherwise state "not executed" in the PR).
  5. Optional hardening (only if cheap): in `test-db.sh`, pipe each migration through `psql -f` is fine, but ALSO
     apply via stdin with `-1` (single transaction) mimicking the CLI: `psql ... -v ON_ERROR_STOP=1 -1 < file`; a
     meta-command in stdin still works in psql, so the grep guard remains the real protection.
- Acceptance: grep for `^\s*\\` in `supabase/migrations` returns nothing; the guard script fails when a `\set` line is
  re-added (verify by temporarily adding one locally); CI green; `20260917000200_*` (once PR #7 is merged) passes
  the guard and `db/tests/50` passes.
- Tests: the guard script is the test. Add a tiny `tests/unit/migration-hygiene.test.ts` (reads the migration dir,
  asserts no meta-commands, filename pattern) so `npm test` also enforces it.
- Risks: if prod already has partial application of these migrations (it should not), the edit changes history;
  HUMAN must check `supabase migration list` first.
- HUMAN: (a) merge PR #7 (migration `20260917000200`); (b) check which migrations prod has applied; (c) run
  `supabase db push --dry-run` then `supabase db push` (or paste SQL in dashboard in order) with the prod project
  linked; (d) verify `curl https://<prod>/api/jobs/recent` returns 200. Details in the Human-only checklist.

### WP-3 — Legal pages and footer  [P0]

- Source: PM-1, PM-6 (email compliance surfaces), PM quick wins.
- Files (new unless noted): `src/lib/legal.ts`, `src/components/legal-page.tsx`, `src/app/terms/page.tsx`,
  `src/app/privacy/page.tsx`, `src/app/refund/page.tsx`, `src/app/about/page.tsx`, `src/components/site-footer.tsx`
  (edit), `src/app/sitemap.ts` (edit: add the four paths), `src/app/post-a-job/page.tsx` (edit: consent line under
  the pricing sidebar/form: "By continuing you agree to the Terms and Refund policy"),
  `scripts/check-launch-placeholders.sh`, `tests/unit/legal-pages.test.ts`.
  Do NOT edit `post-job-form.tsx` (WP-7 owns it).
- Steps:
  1. `src/lib/legal.ts` exports `legalConfig = { companyName, contactEmail, privacyEmail, postalAddress,
     jurisdiction, lastUpdated }`, every value a `[[PLACEHOLDER: ...]]` string, plus `hasPlaceholders()`.
     Optionally prefer `process.env.POSTAL_ADDRESS` for the address (same value the digest already requires,
     `src/lib/env.ts:127`) so there is one source of truth; otherwise placeholder.
  2. `LegalPage` component: prose layout, `<h1>`, "Last updated" line, uses existing Tailwind tokens. Pages export
     `metadata` (title, description, canonical). Static rendering (no DB).
  3. Content, factual only, derived from the code: what is collected (employer: company, contact email, listing
     text, Stripe session id; subscriber: email, signup source, one-click unsubscribe per RFC 8058), processors
     (Stripe, Resend, Supabase, Vercel, GitHub Actions for ingestion), no advertising cookies, data retention and
     deletion route = contact email, prices ($149 / $99 featured, 30 days per listing: read
     `src/lib/posting/pricing.ts`, do not hardcode), what happens on payment failure/expiry, refund policy as
     placeholder text clearly flagged for legal review, takedown/removal process for aggregated listings (contact
     email), disclaimer that aggregated listings belong to the originating employer.
  4. About page: what AgentJob is (curated + aggregated), how listings are sourced (public ATS boards of listed
     companies, link to `ingestion/sources.yaml` company names is optional), contact, link to removal request.
  5. Footer: columns/links Terms, Privacy, Refund, About, Contact (`mailto:`), Post a job; keep domain/tagline line;
     show postal address only if not a placeholder? No: show it (placeholder visible) so the gate script catches it.
  6. `scripts/check-launch-placeholders.sh`: `grep -rn "\[\[PLACEHOLDER" src` -> exit 1 if any. Document it in the
     runbook (WP-6). Not wired into CI.
  7. Sitemap: add the four URLs (priority 0.3, monthly).
- Acceptance: `/terms`, `/privacy`, `/refund`, `/about` return 200 (not 404) with `<h1>`, canonical, in sitemap;
  footer on every page links to all four and a contact `mailto`; unfilled values are visibly marked; the
  `/post-a-job` page shows the consent line with working links; pages are statically rendered (build output shows
  them static); no new dependencies; a11y: landmark `footer` with `nav aria-label="Legal"`.
- Tests: `tests/unit/legal-pages.test.ts` (render or import each page module; assert metadata title and that
  `legalConfig` has the required keys; assert footer link list contains the four paths; assert sitemap includes
  them). e2e scenario (`tests/e2e/scenario.mjs`): add GET 200 for the four paths.
- Risks: text mistaken for finished legal copy. Mitigate with a banner comment at the top of each page file and
  the placeholder gate.
- HUMAN: legal entity name, contact + privacy email, postal address (CAN-SPAM requires a physical address for the
  digest, same value as the `POSTAL_ADDRESS` env var), governing law/jurisdiction, refund policy decision (e.g.
  "refund within N days if not yet live" etc.), lawyer review of all four pages, then fill `legal.ts`.

### WP-4 — Honest copy, source attribution, takedown link, job-detail order  [P0]

- Source: PM-4, PM-2, UX-imp (job detail order; salary label), PM quick wins. Depends on WP-3 (`legalConfig`
  for the removal email).
- Files: `src/lib/site.ts` (`description` only; NOT `domain`, WP-12), `src/app/(board)/page.tsx` (hero sub-copy only),
  `src/app/jobs/[slug]/page.tsx`, NEW `src/lib/source-attribution.ts`, NEW `src/components/source-attribution.tsx`,
  `tests/unit/source-attribution.test.ts`, `tests/unit/` copy test if desired.
  Do not touch contrast classes in `[slug]/page.tsx` (WP-7 does, after this).
- Steps:
  1. `siteConfig.description`: replace "Hand-picked roles ..." with an accurate line, e.g. "Roles for AI agent and
     multi-agent systems engineers, collected from company job boards and employer postings: orchestration,
     tool-use backends, local LLM infrastructure, evals and more." Must not contain "hand-picked" or "curated".
  2. Board hero: soften "no generic 'AI' noise" to a claim that is true after WP-5 (e.g. "one focused board for
     agent engineering roles"); drop "no noise" absolutes. Re-check after WP-5 lands: HUMAN/PM confirms.
  3. `getSourceInfo(applyUrl)`: parse with `new URL`, return `{ provider: "Greenhouse" | "Ashby" | "Lever", label }`
     or `null` for unknown/invalid hosts; hosts allow-listed exactly (match host or subdomain boundary, never
     `endsWith("lever.co")` without a dot check).
  4. Job page: below the description add a "Source" block: "Originally posted on {Provider}. Application is handled
     by {company} on {Provider}." plus "Listing wrong or want it removed? Request removal" -> `mailto:` from
     `legalConfig.contactEmail` with subject `Removal request: {slug}` (URL-encode; no PII). Show the block only
     when `getSourceInfo` returns non-null; always show a small "Report this listing" link on every job.
  5. Job detail order (UX-imp): description renders directly after the header; the "About {Company}" boilerplate
     (inside the ingested description) cannot be reordered safely at runtime: instead leave the markdown as is but
     move the details/aside card and the source block AFTER the description; no markdown surgery. (If the boilerplate
     preceding the role is the problem, record it as a follow-up for the normaliser.)
  6. Missing salary: no label (already omitted); do not add "not listed" noise. Close UX-imp as "no change".
- Acceptance: no occurrence of "Hand-picked"/"hand-picked" in `src` user-facing strings (admin copy in
  `admin/jobs/new/page.tsx` is internal and may stay); an ingested job page shows "Originally posted on Ashby/
  Greenhouse/Lever" and a removal link whose `mailto` includes the slug; unknown hosts show no source line but still
  the report link; `curl` of the page HTML contains the source line (server-rendered); JSON-LD unchanged.
- Tests: `source-attribution.test.ts`: positive hosts (`boards.greenhouse.io`, `job-boards.greenhouse.io`,
  `jobs.ashbyhq.com`, `jobs.lever.co`), negatives (`evil-lever.co`, `lever.co.evil.com`, `javascript:`, empty,
  malformed), mailto encoding. Add a snapshot-free assertion that `siteConfig.description` has no "hand-picked".
- Risks: employer-posted jobs linking to Greenhouse show "Originally posted on": wording above is accurate for both
  ("Application hosted on ..."); prefer that neutral wording if PM prefers zero ambiguity.
- HUMAN: confirm removal-contact email (same as WP-3), review each ATS's terms of use for redistribution (PM-2 is an
  inferred risk; a lawyer or the owner must decide whether to keep aggregating each source), approve final copy.

### WP-5 — Ingestion relevance classifier tightening  [P0]

- Source: PM-3, UX-1 (deduplicated), UX-imp (generic "Evals"/"MCP" tags are a symptom of the same cause).
- Files: `ingestion/agentjobs_ingest/classify.py`, `ingestion/tests/test_classify.py`. (No changes to
  `pipeline.py`; the relevance gate is already `select_jobs`.)
- Rule change (deterministic, all regex; computed in a prototype against typical boilerplate bodies):
  1. Split `CORE_TERMS` into two lists. `AGENT_TERMS`: `agents?`, `agentic`, `multi-agent`, `langgraph`, `langchain`,
     `llamaindex`, `autogen`, `crewai`, `semantic kernel`, `tool use/calling`, `function calling`, `mcp`,
     `model context protocol`. `LLM_TERMS`: `llms?`, `large language models?`, `vllm`, `llama.cpp`, `ollama`,
     `llm inference`. Title path unchanged (title hit on either list qualifies), so "Software Engineer, Agents" and
     "LLM Inference Engineer" keep passing.
  2. New `DOMAIN_TITLE_DENY` regex (title-only, case-insens.): `bioinformatics|biolog\w*|chemi\w*|drug|clinical|
     discovery|forecast\w*|data\s+scien\w*|security|fraud|actuar\w*|quant|hardware|mechanical|electrical|
     supply\s+chain|ads?|growth`. Applied only to the BODY path (a title that itself contains an agent term still
     qualifies, e.g. "Agent Security Engineer").
  3. Body path: `agent_hits = distinct AGENT_TERMS in body`, `llm_hits = distinct LLM_TERMS`.
     `score = 3*agent_hits + 1*llm_hits + 0.5*support_hits + 1.5 if AI_TITLE`. Qualifies only if
     `agent_hits >= 2 and score >= 8`.
  4. `EXCLUDED_TITLE`: add `partner(?!\s+engineer)`? NO, keep simple: add `partner` (word) to the excluded list so
     "Partner Applied AI Engineer, Oracle ISV" is dropped; document that legit "Partner Engineer" roles are
     intentionally lost (HUMAN can relax).
  5. Keep `Relevance(relevant, score, reason)`; add reasons `"domain title"` and `"insufficient agent evidence"`.
  Expected before/after (prototype, `boiler` = "Anthropic builds large language models like Claude and AI agents.
  Experience with LLM, evals, inference, openai." ; `real` = "Build agentic workflows: agents with tool use, MCP
  servers, LLM routing and evals."):

  | Title | Old (boiler) | New (boiler) | Old (real) | New (real) |
  |---|---|---|---|---|
  | Application Security Engineer | pass | DROP | pass | DROP (security) |
  | Senior Engineer, Bioinformatics | pass | DROP | pass | DROP |
  | Research Scientist, Discovery Engineering | pass | DROP | pass | DROP |
  | ML Data Scientist, Consumer Forecasting | pass | DROP | pass | DROP |
  | Partner Applied AI Engineer, Oracle ISV | pass | DROP | pass | pass in prototype; DROP after step 4 |
  | Software Engineer, Agents | pass | pass | pass | pass |
  | Applied AI Engineer | pass | DROP | pass | pass |
  | Senior Backend Engineer | pass | DROP | pass | pass |
  | Research Engineer, Inference | pass | DROP | pass | pass |

  (Prototype file, outside the repo: scratchpad `proto.py`; re-create from the rules above rather than copying.)
- Steps: implement; update the existing tests that assert the old threshold behaviour (`test_company_boilerplate...`
  keeps passing; `test_body_signals_qualify_an_ai_titled_role` body has `agents`, `LLM`, RAG, evals, fine-tuning
  -> only 1 agent hit: it will now FAIL by design: change the body to include 2 agent-family terms, and add the
  negative twin). Add parametrised tests for every title in the table, both bodies. Run
  `cd ingestion && python -m pytest` and `python -m agentjobs_ingest validate-config`.
- Acceptance: all table rows behave as "New"; no previously passing core-term-in-title case regresses
  (existing parametrised lists still pass); `pytest` green; dry run (`python -m agentjobs_ingest run --dry-run`,
  needs network, HUMAN or dev with network) prints per-source kept/dropped counts; kept share drops but each source
  retains > 0 (empty feeds are refused by the RPC, so a source with 0 relevant jobs is skipped for close_missing:
  check the pipeline log, do not assume).
- Tests: as above in `ingestion/tests/test_classify.py`; add a fixture-driven test if
  `ingestion/tests/fixtures` has realistic bodies (check before inventing).
- Risks: over-pruning (kept count may fall sharply from ~307); stale already-ingested irrelevant jobs are expired
  by the next complete run, only if the feed run is "clean" (read `pipeline.py` for the close_missing condition).
- HUMAN: decide strictness (the dial is `agent_hits >= 2`, `score >= 8`, and the deny list); review the dry-run
  kept list; trigger the Ingest workflow (`workflow_dispatch`) after merge and spot-check the board.

### WP-6 — Smoke-test script and launch runbook  [P0]

- Source: DEV-3, PM-6/7 (verification), DEV quick wins (uptime monitor).
- Files: NEW `scripts/smoke-test.sh`, NEW `docs/runbooks/launch-smoke-test.md`. No package.json edit (call the
  script directly).
- Steps: Bash + curl only, args `BASE_URL`, optional env `CRON_SECRET`, `ADMIN_USER`/`ADMIN_PASSWORD` (never echoed).
  Checks, each printing PASS/FAIL with a final non-zero exit on any FAIL:
  1. `GET /api/health` 200.
  2. `GET /` 200, contains `<link rel="canonical"` with the expected origin (parameter `EXPECT_ORIGIN`).
  3. `/terms /privacy /refund /about` 200 (after WP-3).
  4. `/api/jobs/recent?days=14` 200 and valid JSON with `jobs` array (catches the missing-migration 500).
  5. `/sitemap.xml` 200 and has >= 1 `/jobs/` entry; `/robots.txt` 200.
  6. `/admin` without credentials -> 401 (503 means ADMIN_PASSWORD unset: report that specifically).
  7. Cron: `/api/cron/maintenance` and `/api/ops/report` without secret -> 401; with `Authorization: Bearer
     $CRON_SECRET` -> 200 (skip with a notice if secret not supplied). Do NOT trigger `/api/cron/digest` unless
     `RUN_DIGEST=1` (it sends email).
  8. A random `/jobs/does-not-exist-xyz` returns 404 (real status).
  9. Response headers include the security headers present in `next.config.ts`.
  Runbook: manual steps the script cannot do (Stripe test-mode purchase on the Vercel preview with test card
  4242..., verify webhook delivery and job going `active`, verify the receipt email, first ingestion run, check
  GitHub Actions secrets, unsubscribe link, digest dry-run), plus rollback (promote previous Vercel deployment).
- Acceptance: running the script against production shows the current known failures (`/api/jobs/recent` 500, legal
  404s) before the other WPs land and all PASS after; script passes `shellcheck` if available; no secrets printed.
- Tests: the script is the test. Add `shellcheck` step only if already used in CI (do not add tooling).
- Risks: none to prod (read-only GETs; digest opt-in).
- HUMAN: supply `CRON_SECRET` and admin credentials locally when running it; run the Stripe test purchase.

### WP-7 — UX quick wins: contrast, error page, motion, tag cap  [P1]

- Source: UX-3, UX-imp (error.tsx, loading motion, tag overload), UX quick wins. Depends on WP-4 (shares
  `jobs/[slug]/page.tsx`).
- Files: `src/app/globals.css` (add `--color-accent-800`), `src/components/job-card.tsx`,
  `src/components/subscribe-form.tsx`, `src/components/post-job/post-job-form.tsx`,
  `src/app/post-a-job/success/page.tsx`, `src/components/admin/admin-job-form.tsx`,
  `src/app/jobs/[slug]/page.tsx`, `src/app/error.tsx`, `src/app/(board)/loading.tsx`,
  `src/components/job-search-box.tsx` (spinner motion-reduce only), `src/components/tag-list.tsx`.
- Steps:
  1. Add `--color-accent-800: oklch(0.42 0.1 165)` (verify contrast >= 4.5:1 for white 14px using an actual checker,
     do not trust the review's estimate of ~3.4:1). Replace `bg-accent-600 ... text-white` with
     `bg-accent-700 hover:bg-accent-800` everywhere white text sits on accent (Apply, Subscribe, Featured pill, post
     CTA, success CTA, admin submit). Do not change `text-accent-600` usages or the progress bar.
  2. `error.tsx`: remove the "503" line (or render only `error.digest`-based reference), change Reference colour to
     `text-zinc-500 dark:text-zinc-400`, keep copy generic since it handles any error.
  3. `loading.tsx` and spinners: add `motion-reduce:animate-none` to every `animate-pulse`/`animate-spin`.
  4. `TagList`: new optional `max` prop (default unlimited); show first `max` tags then a non-link `+N` chip;
     `job-card.tsx` passes `max={5}`; detail page keeps all tags. `aria-label` on the overflow chip.
  5. Retest post-a-job focus bug (UX-4) on a cold load in a real browser; if not reproducible, close as noise per
     the synthesis rule. No code change unless reproduced.
- Acceptance: computed contrast >= 4.5:1 for every white-on-accent button (state the measured value in the PR);
  `grep -rn "bg-accent-600" src` shows no white-text usage; error page shows no "503" and passes contrast; with
  `prefers-reduced-motion: reduce` nothing pulses/spins; job card shows <= 5 tags plus `+N`; detail page shows all.
- Tests: unit test for `TagList` overflow (or pure helper `splitTags(tags, max)`); extend an existing render test if
  present. Visual checks manual; attach before/after screenshots (light + dark, mobile + desktop).
- Risks: merge conflicts in `post-job-form.tsx` (WP-3 deliberately avoids it) and `[slug]/page.tsx` (sequence after WP-4).
- HUMAN: none (UX Designer re-verifies).

### WP-8 — Feed UX: locations, chips, search, nav  [P1]

- Source: UX-2, UX-imp (chips, search button, nav state, skip link, digest placement deferred).
- Files: `src/lib/format.ts` (new `formatLocationSummary`), `src/components/job-meta.tsx`,
  `src/components/filter-chips.tsx`, `src/components/job-search-box.tsx` (visible submit button; note WP-7 only
  touches its spinner class: sequence WP-8 after WP-7 or accept a trivial merge), `src/components/site-header.tsx`
  (`aria-current` for Jobs/Post a job via a small client component using `usePathname`, plus skip-to-content link and
  a `id="main"` target: check `layout.tsx` for `<main>` first; if `id` is needed there, coordinate: layout is
  WP-9's hotspot, so put `id="main"` via the header component's anchor and `tabIndex={-1}` on the main in layout ONLY
  if absent, in this PR, and rebase WP-9 after), `tests/unit/format-search.test.ts` (extend).
- Steps:
  1. `formatLocationSummary(raw)`: split on `|`, `;` and " / "; trim; dedupe case-insensitively; return
     `{ primary, extra }`; treat "Remote-Friendly (Travel-Required)" style prefixes as workplace hints, keep as
     primary only when no other location. Card shows `primary` + `+N more` (title attribute and detail page show the
     full string). Replace `|` separators with `·` in display only; never mutate stored data.
  2. Chips: wrap the scroll container in a relative div with right-edge gradient mask (`mask-image` or an
     absolutely positioned gradient using the page background tokens, both themes) and left edge when scrolled
     (optional); active chip gets an extra non-colour cue (e.g. `aria-current` + check/underline/weight), not black/
     white only.
  3. Search: visible magnifier submit button on small screens (keep Enter behaviour and the hidden button removal).
  4. Header: `aria-current="page"` and a visible state on the current nav item; skip link `href="#main"` that
     becomes visible on focus.
- Acceptance: the review's example string renders as "Remote-Friendly (Travel-Required) +3 more" or similar on one
  line at 375 px; chip row shows an edge fade and active/inactive differ by more than fill colour; search has a
  visible button at 375 px; keyboard Tab reveals the skip link and it moves focus to main content; current nav
  item announced by screen reader (`aria-current`).
- Tests: unit tests for `formatLocationSummary` (pipes, semicolons, duplicates, empty, single, 1000-char string);
  keep existing format tests green.
- Risks: layout shift on the chip row; locations that legitimately contain `/` ("San Francisco / Remote").
- HUMAN: none.

### WP-9 — Share cards (OG + Twitter)  [P1]

- Source: PM-imp, PM quick wins. Depends on WP-1 (Next version) and WP-8 only if `layout.tsx` conflicts.
- Files: NEW `src/app/opengraph-image.tsx`, NEW `src/app/jobs/[slug]/opengraph-image.tsx`,
  `src/app/layout.tsx` (twitter card `summary_large_image`), `src/app/jobs/[slug]/page.tsx` (twitter card only,
  after WP-4/WP-7).
- Steps: read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.md`;
  use `ImageResponse` from `next/og` (no new dependency), 1200x630, system font fallback (do not fetch remote
  fonts at runtime). Job image: title, company, location, small "agentjob" wordmark; truncate long titles. Fetch the
  job with the existing public client; return a generic card for unknown slugs rather than throwing.
- Acceptance: `GET /opengraph-image` and `/jobs/<slug>/opengraph-image` return 200 `image/png` 1200x630; page HTML
  contains `og:image` and `twitter:card` = `summary_large_image`; unknown slug does not 500.
- Tests: unit test for the title truncation helper; smoke script (WP-6) gains an `og:image` check.
- Risks: OG route runtime cost on Vercel (cache headers); the advisory fixed in WP-1 concerned image optimisation of
  SVG: do not add SVG `remotePatterns`.
- HUMAN: none (optionally approve the visual design).

### WP-10 — Payment edge cases and ops alerts  [P1]

- Source: DEV-imp (paid-but-unpublished), DEV quick wins (alert on non-2xx cron, 0 active jobs), architecture-
  synthesis #12.
- Files: NEW migration `supabase/migrations/2026111500xxxx_activate_paid_from_expired.sql` (use a timestamp after
  `20260917000200`), `db/tests/20_operations.test.sql` (add cases), `src/lib/stripe/fulfillment.ts` (log/alert
  surface), `src/lib/ops/report.ts` and `tests/unit/ops-report.test.ts` (new flags), `tests/unit/fulfillment.test.ts`.
- Steps:
  1. Read the CURRENT definition of `activate_paid_job` (originally `core_schema.sql:446`; check later migrations
     for replacements) and `fulfillment.ts` lines ~60-100 (outcomes `not_activatable`, `amount_mismatch`).
  2. New migration (additive, `create or replace` same signature is acceptable because arguments are unchanged:
     state this in the migration header): allow `status in ('pending_payment','payment_expired')` in the WHERE
     clause. Keep all other semantics. The fulfilment path already verifies the Stripe session is paid and the
     amount/currency match; confirm that precedes the RPC call so an expired-and-unpaid session can never activate.
  3. Ops report: add flags `no_live_jobs` (level `critical`/`warning` when `stats.live_jobs === 0`) and, if stats can
     carry it cheaply (check `admin_stats`/ops RPC; otherwise log with `console.error` structured line and rely on
     Vercel log alerts), `payment_not_activatable`.
  4. SQL test: job in `payment_expired` + `activate_paid_job` -> `active`; job `active` stays idempotent; `rejected`
     and `draft` cannot be activated.
- Acceptance: DB tests pass in CI; unit tests cover the new flags; webhook for an expired-then-paid session now
  returns 200 `activated`; `/api/ops/report` mentions `no_live_jobs` when live jobs = 0.
- Tests: as listed; mark any DB test "not executed locally" if no Postgres.
- Risks: reviving a session Stripe really expired (guarded by the paid check). Changing a function body needs
  human prod apply.
- HUMAN: apply the migration to prod; decide whether 100%-off promotion codes (`allow_promotion_codes: true`) are
  intended and create only controlled coupons in Stripe; configure alert delivery for the ops agent / Vercel log
  drains.

### WP-11 — Security hardening: CSP report-only, admin throttle nuance  [P1]

- Source: DEV-imp (CSP, admin bucket), architecture-synthesis #8/#9 follow-ups are NOT included (see deferred).
- Files: `next.config.ts`, NEW `src/app/api/csp-report/route.ts`, `src/proxy.ts`, `tests/unit/proxy.test.ts`,
  `tests/unit/security.test.ts`. Depends on WP-1 (next.config.ts after upgrade).
- Steps:
  1. Read `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`. Add
     `Content-Security-Policy-Report-Only` to `securityHeaders` with: `default-src 'self'`; `script-src 'self'
     'unsafe-inline'` (JSON-LD and Next inline bootstraps; report-only so it is safe); `style-src 'self'
     'unsafe-inline'`; `img-src 'self' data: https:`; `connect-src 'self'`; `frame-ancestors 'none'`;
     `form-action 'self' https://checkout.stripe.com`; `base-uri 'self'`; `report-uri /api/csp-report`. Verify every
     origin actually used (Stripe redirect is a navigation, not a script; no third-party scripts today).
  2. `csp-report` route: POST only, body size cap (e.g. 8 KB), log one structured line, return 204; rate-limited via
     the existing `consumeRateLimit` (add a bucket only if trivial; otherwise rely on size cap).
  3. `proxy.ts`: when there is no `Authorization` header at all, return 401 with `WWW-Authenticate` WITHOUT consuming
     the failed-auth bucket (browser's first prompt); keep consuming for requests that present wrong credentials.
- Acceptance: response headers contain the report-only CSP; no enforcement header; browsing home, a job, post-a-job
  and admin produces no uncontrolled console breakage; unauthenticated `/admin` x N never yields 429; wrong
  credentials x N does; existing proxy tests updated.
- Tests: update `proxy.test.ts` (no-header path does not call `consumeRateLimit`; bad creds does); header assertion
  in `security.test.ts`.
- Risks: header string typos silently disable CSP: assert exact directives in a test.
- HUMAN: review CSP reports after a week of traffic before enabling enforcement (follow-up).

### WP-12 — Domain and brand reconciliation  [P1]

- Source: PM (open item), architecture-synthesis #4.
- Files: `src/lib/site.ts` (`domain`, name), `src/components/logo.tsx`, `src/components/site-footer.tsx` (after
  WP-3), `README.md`/docs references; no env files in repo. Sequence last (touches `site.ts` after WP-4).
- Steps: after HUMAN picks the canonical domain/brand, make `siteConfig.domain`, the logo wordmark and the footer
  text agree ("agentjob.dev" vs "agentjobs.dev"); keep canonical driven by `NEXT_PUBLIC_SITE_URL` (do not hardcode);
  add a unit test asserting the logo text equals `siteConfig.domain` (render or constant).
- Acceptance: header, footer, hero eyebrow and canonical host all show the same domain; sitemap, robots and OG URLs
  use the same origin; Stripe return URLs (`deploymentOrigin()`) resolve to it in production.
- Tests: logo/domain consistency test; smoke script `EXPECT_ORIGIN` check.
- Risks: changing `NEXT_PUBLIC_SITE_URL` after launch changes canonicals and Stripe redirects: do it before indexing.
- HUMAN: choose the domain and brand spelling; own and configure DNS (`agentjobs.dev` currently points to an
  unrelated placeholder per the synthesis); add the domain in Vercel; set `NEXT_PUBLIC_SITE_URL`; redirect
  `*.vercel.app` to it if desired.

### WP-13 — Analytics event plan (post-launch)  [P2]

- Source: PM-imp, PM metrics.
- Files: new doc section only at first (`docs/runbooks/analytics-events.md`); implementation touches `package.json`
  (new dependency, so WP-1-style isolation), `src/app/layout.tsx`, `src/app/jobs/[slug]/page.tsx`,
  `src/components/subscribe-form.tsx`, `src/components/post-job/post-job-form.tsx`.
- Plan: events `apply_click`, `post_job_start`, `checkout_start`, `paid` (server-side from the webhook, not client),
  `digest_signup`; no PII in properties; cookieless tool (Vercel Web Analytics or Plausible: HUMAN decides).
  Pre-launch stopgap: enable Vercel Web Analytics in the dashboard.
- Acceptance/tests (when implemented): each event fires once per action; no event contains email/name.
- HUMAN: tool choice, privacy policy mention (WP-3 text must be updated if a tool is added).

---

## 3. Dependencies, order and parallelism

### Dependency graph

```
WP-1 (deps) ─────────────┬──────────────► WP-9 (OG)       needs new Next; after WP-4/7 on [slug]/page.tsx
                         └──────────────► WP-11 (CSP)     edits next.config.ts after upgrade
WP-2 (migrations/CI) ───────────────────► WP-10 (new migration, after hygiene guard exists)
WP-3 (legal) ───────────► WP-4 (needs legalConfig) ──► WP-7 (shares [slug]/page.tsx) ──► WP-9 ──► WP-12 (site.ts/footer)
WP-5 (classifier) ──────► (soft) WP-4 hero copy wording; re-verify copy after WP-5 is live
WP-6 (smoke) ── independent to write; its full pass needs WP-2, 3, 5 and the human steps
WP-7 ─► WP-8 (search box / minor); WP-8 independent otherwise
WP-13 after launch, after WP-1 and WP-4 and WP-7
```

### Recommended execution order

Wave A (parallel, all disjoint): **WP-1, WP-2, WP-3, WP-5, WP-6**
Wave B (after WP-3 merged; parallel with each other): **WP-4**, and WP-10, WP-11 (WP-11 after WP-1; WP-10 after WP-2)
Wave C: **WP-7** (after WP-4), then **WP-8**, **WP-9**
Wave D: **WP-12** (after human domain decision), then WP-13.
P0 critical path to launch: WP-1 / WP-2 / WP-3 / WP-5 / WP-6 in parallel, then WP-4, then human checklist.

### Disjoint file sets for Wave A (proof)

| WP | Files |
|---|---|
| WP-1 | `package.json`, `package-lock.json`, (conditional: Next-API breakage fixes, `eslint.config.*`) |
| WP-2 | `supabase/migrations/20260917000000_*`, `supabase/migrations/20260917000100_*`, `scripts/check-migrations.sh`, `.github/workflows/ci.yml`, `tests/unit/migration-hygiene.test.ts` |
| WP-3 | `src/lib/legal.ts`, `src/components/legal-page.tsx`, `src/app/{terms,privacy,refund,about}/page.tsx`, `src/components/site-footer.tsx`, `src/app/sitemap.ts`, `src/app/post-a-job/page.tsx`, `scripts/check-launch-placeholders.sh`, `tests/unit/legal-pages.test.ts`, `tests/e2e/scenario.mjs` |
| WP-5 | `ingestion/agentjobs_ingest/classify.py`, `ingestion/tests/test_classify.py` |
| WP-6 | `scripts/smoke-test.sh`, `docs/runbooks/launch-smoke-test.md` |

No file appears twice. Caveat: if WP-1 has to fix Next API breakage inside a file that another WP owns (e.g.
`src/app/sitemap.ts`, `src/app/post-a-job/page.tsx`), WP-1 makes the smallest possible edit and the other WP rebases.

### Other parallel pairs

- WP-4 || WP-10 || WP-11: WP-4 = `site.ts`, `(board)/page.tsx`, `jobs/[slug]/page.tsx`, `source-attribution.*`;
  WP-10 = new migration, `db/tests/20_*`, `fulfillment.ts`, `ops/report.ts`; WP-11 = `next.config.ts`,
  `api/csp-report/`, `proxy.ts`. Disjoint.
- WP-8 || WP-9 after WP-7: WP-8 = `format.ts`, `job-meta.tsx`, `filter-chips.tsx`, `job-search-box.tsx`,
  `site-header.tsx`; WP-9 = `opengraph-image.tsx` files + one-line metadata edits. Disjoint except `layout.tsx`
  (see hotspots).

### Merge-conflict hotspots

| File | Touched by | Rule |
|---|---|---|
| `package.json`, `package-lock.json` | WP-1 (only), WP-13 later | nobody else adds deps; rebase WP-13 on WP-1 |
| `src/app/jobs/[slug]/page.tsx` | WP-4, WP-7, WP-9 | strict order WP-4 -> WP-7 -> WP-9 |
| `src/lib/site.ts` | WP-4 (`description`), WP-12 (`domain`) | WP-4 first; WP-12 last |
| `src/app/layout.tsx` | WP-9 (twitter), maybe WP-8 (`id="main"`) | WP-8 first if it touches it |
| `src/components/job-search-box.tsx` | WP-7 (spinner class), WP-8 | WP-7 first |
| `src/components/site-footer.tsx` | WP-3, WP-12 | WP-3 first |
| `next.config.ts` | WP-1 (config keys only), WP-11 | WP-1 first |
| `src/components/post-job/post-job-form.tsx` | WP-7, WP-13 | WP-3 deliberately avoids it |
| `.github/workflows/ci.yml` | WP-2 only | keep it that way |
| `tests/e2e/scenario.mjs` | WP-3, WP-9 | small additive edits; rebase |

---

## 4. Human-only checklist

Nothing here can be done by a developer or agent. Order matters.

1. Merge PR #7 (`20260917000200_revoke_ingestion_runs_client_grants.sql`) after review.
2. Confirm which migrations prod has applied: `supabase migration list` against the prod project.
3. After WP-2 merges: `supabase db push --dry-run`, then `supabase db push` (or paste each migration, in order, into
   the Supabase SQL editor). Then `curl -s -o /dev/null -w "%{http_code}" <prod>/api/jobs/recent` must be 200.
   Apply WP-10's migration the same way when it merges.
4. Vercel production env vars (verify, do not assume): `CRON_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`,
   `SUPABASE_URL`/anon + service-role keys as the app requires, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `RESEND_API_KEY`, `EMAIL_FROM`, `POSTAL_ADDRESS` (digest and CAN-SPAM), `NEXT_PUBLIC_SITE_URL` (final domain).
   See `src/lib/env.ts` for the exact list. Redeploy after changing.
5. GitHub Actions secrets for ingestion (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`); run the "Ingest" workflow
   manually once after WP-5 merges and check the summary artifact. Confirm the scheduled workflow is enabled.
6. Stripe: webhook endpoint registered to the production URL with `checkout.session.completed` and
   `checkout.session.expired`; run one full test-mode purchase (card 4242 4242 4242 4242) from a Vercel preview or
   production in test mode: job goes `active`, success page renders, receipt email arrives; then switch to live keys
   and make (and refund) one real purchase if desired. Review coupons: only controlled promotion codes may exist
   (`allow_promotion_codes: true`).
7. Domain: decide brand spelling (agentjob.dev vs agentjobs.dev); DNS, Vercel domain assignment, SSL; update
   `NEXT_PUBLIC_SITE_URL`.
8. Legal: company entity name, contact and privacy emails, postal address, governing law, refund policy, lawyer
   review of Terms/Privacy/Refund/About; fill `src/lib/legal.ts`; run `scripts/check-launch-placeholders.sh` to
   confirm none remain. Review each source ATS's terms for redistribution; keep or drop sources accordingly.
9. Resend: verify the sending domain (SPF/DKIM) and that unsubscribe works end to end from a real mailbox.
10. Product decisions: classifier strictness (WP-5 dial); whether to keep the "Partner" exclusion; hero copy
    approval; whether to hold the first HN/X post until the relevance rate is acceptable.
11. Monitoring: uptime monitor on `/api/health`; Vercel Web Analytics toggle; alert routing for the ops agent
    report; Vercel cron visibility check (both crons in `vercel.json`).
12. Run `scripts/smoke-test.sh https://<prod>` with `CRON_SECRET` and admin credentials; all PASS before announcing.
13. Do not run `db/seed/sample_jobs.sql` in production.

---

## 5. Deliberately deferred

| Item | Reason |
|---|---|
| Board page caching / `unstable_cache` / `use cache` (DEV-imp) | Next API surface changed in 16.4 (read `01-app/02-guides/caching-without-cache-components.md` and cache-components pages first); `searchParams` makes it fiddly; no traffic at launch. Revisit with real load numbers. |
| "Ingestion revives expired jobs" (DEV-imp) | Review is mostly incorrect (close_missing expires vanished postings). Only revisit if stale-URL rate appears in metrics. |
| Rate-limiter fail-open circuit breaker; rate limit on `/api/jobs/recent` | Already tracked as P2 in architecture-synthesis (#8, #9); the recent route is cached 5 min at the edge and read-only. |
| Salary-less gating, "$ listed" filter/sort, verified-agent badge | Needs product decision and data; the badge needs a persisted classifier result (schema change). Post-launch. |
| Company pages, saved jobs, company logos at ingestion | Feature work, not launch blockers. Letter tiles are acceptable. |
| Digest prompt after the 10th card, sticky mobile apply bar | UX nice-to-haves; measure first. |
| Sitemap `lastmod`/priority refinement, 300-URL cap | Low impact at 300 jobs; revisit at several thousand (sitemap index). |
| Explicit `source`/`source_name` exposure to anon | Needs a grant migration; host-derived attribution (WP-4) is sufficient. |
| Pinning GitHub Actions by SHA | Hygiene; do in a separate low-risk PR once CI is stable. |
| `activate_paid_job` coupon handling beyond amount check | Policy decision (HUMAN item 6), no code until decided. |
| Employer-value proof ("Why post here", social proof, pricing tiers) | Business, not engineering; needs traffic data. |
| Moving `db/seed/sample_jobs.sql` to a dev-only path | Low risk because nothing runs it automatically; add a "do not run in prod" header in a later hygiene PR. |
| Refreshing stale `docs/reviews/ux.md` (describes an empty board) | Docs; the next UX cycle will regenerate it. |
| CSP enforcement and nonces | Only after report-only data (WP-11 follow-up). |
