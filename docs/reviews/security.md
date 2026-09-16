# Security & Compliance Review — AgentJobs.dev

Scope: `src/app/api/**`, `src/lib/**` (auth/stripe/supabase/rate-limit), `supabase/migrations/*`,
plus a read-only pass on the live site (`https://agentjob-dev.vercel.app`). Static/adversarial
review only — no live exploitation attempted.

Overall: the codebase is in noticeably good shape for a security review — signature
verification, idempotency, RLS/grants, markdown sanitization, and rate limiting are all
actually implemented, not just planned. Findings below are ranked by severity; several are
config/ops issues rather than code defects.

---

1. **[High] Production `CRON_SECRET` appears unset — all `/api/cron/*` and `/api/ops/report`
   endpoints are currently hard-down (503), not merely unauthenticated.**
   Hitting `https://agentjob-dev.vercel.app/api/cron/maintenance` live returns
   `{"error":"Invalid cron configuration — CRON_SECRET: is required to authenticate
   scheduled jobs. See .env.example."}`. `getCronEnv()` (`src/lib/env.ts`) throws before
   `isAuthorizedCron` can even compare a header, so Vercel Cron's own scheduled calls are
   presumably failing too (maintenance/expiry and the digest never run in prod).
   *Remediation:* set `CRON_SECRET` in the Vercel production environment and confirm the
   Vercel Cron config sends the matching `Authorization: Bearer` header; add an ops alert
   on non-2xx cron responses so this doesn't go unnoticed again.

2. **[Medium] `/api/cron/*` and `/api/ops/report` error responses leak internal
   configuration detail to an unauthenticated caller.** The env-validation error message
   above (env var name, hint text, "See .env.example") is returned directly in the JSON
   body to anyone, authenticated or not, who hits the route — this happens *before* the
   auth check has a chance to run in a normal (secret-present) deployment too, since
   `getCronEnv()`/`getEmailEnv()` are called inside the same try block. It's not a stack
   trace, but it does confirm which env vars exist and their validation rules, useful
   recon for an attacker probing the surface.
   *Remediation:* call `isAuthorizedCron(request)` before touching any env-dependent
   business logic (it already reads `CRON_SECRET` internally but should special-case a
   missing secret as a generic 401/503 with no schema detail); return a fixed generic
   message for unauthenticated/misconfigured requests, log the detail server-side only.

3. **[Medium] `consumeRateLimit` fails open, and does so on every "unavailable" path
   through `/api/ops/report`-adjacent infra (rate-limit RPC failure, missing service
   key).** This is a deliberate, documented tradeoff (`src/lib/rate-limit.ts`) — losing a
   paying employer is judged worse than an unthrottled request — but it means an attacker
   who can degrade or exhaust the Supabase connection (e.g. via the 10s
   `fetchWithTimeout` in `src/lib/supabase/admin.ts` under load) gets unlimited
   `post-job`/`subscribe`/`unsubscribe` attempts precisely when the system is stressed,
   which is the scenario rate limiting exists for.
   *Remediation:* keep fail-open as the default, but add a circuit breaker / alert when
   the RPC has failed N times in a window, and consider a coarser IP-based edge rate
   limit (Vercel WAF / Cloudflare) as defense-in-depth so app-layer failure isn't the only
   backstop.

4. **[Medium] Basic-auth timing-safe comparison hashes with SHA-256 first, but the
   underlying `ADMIN_PASSWORD` has no attempt/lockout limiting.** `src/lib/admin/auth.ts`
   correctly does constant-time digest comparison for both username and password, which
   is good, but `assertAdmin()`/the proxy have no rate limit on failed Basic-auth
   attempts, so a 12+ character password is the only defense against online brute force
   (no lockout, no backoff, no WAF mentioned in code).
   *Remediation:* rate-limit failed `/admin` auth attempts (reuse `consumeRateLimit`
   keyed by IP+"admin-auth"), or front `/admin` with a platform-level IP allowlist /
   Vercel deployment protection.

5. **[Low] `admin_stats` / `listAdminJobs` exposes `employers.email` (PII) to any
   holder of the shared admin Basic-auth credential** (`src/lib/admin/jobs.ts` line
   104 selects `employer:employers ( email )`). This is intended admin functionality, not
   a bug, but the roster (`docs/agent-team-guidelines.md`) calls out employer PII as
   something that should "never be exposed to anon" — worth confirming the single shared
   admin credential is treated as equivalent to a service-role secret (rotated, not
   shared broadly, not committed) since it's the only gate in front of that PII.
   *Remediation:* document/rotate `ADMIN_PASSWORD` like a secret credential; consider
   scoping a read-only admin view vs. one with PII for anyone beyond the owner.

6. **[Low] `/api/jobs/recent` is intentionally public/anon and returns up to 100 jobs
   with no auth, `days` param bounded 1–14 — no injection risk found** (parameterized RPC
   call, numeric coercion via `Number()` clamped with `Math.min/Math.max`), but there is
   no rate limiting on this route at all (unlike `subscribe`/`post-job`/`unsubscribe`).
   It's read-only and backed by `search_jobs` (already anon-grantable), so impact is low,
   but it is an unthrottled DB round-trip reachable by anyone.
   *Remediation:* add a light `consumeRateLimit`-style throttle if this becomes a target
   for scraping/DoS; not urgent given the data is already public.

7. **[Informational — verified sound] Stripe webhook signature verification is present
   and correct.** `src/app/api/stripe/webhook/route.ts` calls
   `getStripe().webhooks.constructEvent(payload, signature, webhookSecret)` against the
   raw text body before any payload field is trusted, and rejects with 400 on failure.
   No action needed.

8. **[Informational — verified sound] Webhook/fulfillment idempotency is real, not just
   claimed.** `fulfillCheckoutSession` (`src/lib/stripe/fulfillment.ts`) re-fetches the
   job by session id, checks `existing.status === "active"` and returns `already_active`
   before calling `activateJob` again, and cross-checks `session.currency` /
   `amount_subtotal` against the plan's expected price before ever publishing — this
   blocks the classic "pay for standard, tamper client-side to claim featured" attack and
   duplicate-delivery double-publish. No action needed.

9. **[Informational — verified sound] No RPC/`.rpc()`/`.from()` call in the app layer
   builds a filter or SQL string via concatenation of user input.** `toIlikePattern`
   (`src/lib/admin/jobs.ts`) strips PostgREST metacharacters (`%_\",()*`) from admin
   search input rather than trying to escape them, which is a stronger guarantee than
   escaping. All `plpgsql` functions reviewed in the migrations use parameterized
   `where col = $1`-style access, not `execute format(...)` with unsanitized input — the
   only `execute` usages found are trigger-function calls (`execute function ...`), which
   take no user data. No action needed.

10. **[Informational — verified sound] Markdown XSS surface is closed.** Job
    descriptions render through `react-markdown` with `skipHtml` (raw HTML dropped
    entirely, no `rehype-raw`), no `dangerouslySetInnerHTML` found anywhere in `src/`,
    images disallowed, and link `href`s that fail react-markdown's protocol allow-list
    (e.g. `javascript:`) degrade to plain text rather than being rendered as a broken/live
    link. No action needed.

11. **[Informational — verified sound] Secrets stay server-side.** No hardcoded
    `sk_live_`/`sk_test_`/`whsec_`/service-role values found in the repo outside test
    fixtures (`tests/unit/*.test.ts`, which use obviously-fake placeholder values like
    `sk_test_unit`). `SUPABASE_SERVICE_ROLE_KEY` is only read inside `src/lib/env.ts` +
    `src/lib/supabase/admin.ts`, both guarded by `import "server-only"`; no `'use client'`
    file references `SERVICE_ROLE`, `STRIPE_SECRET`, or `CRON_SECRET`. `env.ts` also
    actively rejects a service-role key that equals the anon key or looks like a
    publishable key — a nice defense against misconfiguration. No action needed.

12. **[Informational — verified sound] No SSRF/open-redirect surface via employer input.**
    `apply_url`/company/logo fields are stored and rendered as plain `<a href>` links
    (client-side navigation only); no code path was found where the server fetches an
    employer-supplied URL. If a future feature (e.g. logo proxying/thumbnailing, URL
    preview) is added, revisit this — it would need an allowlist and no redirect-following
    to internal/metadata IPs.

13. **[Informational — verified sound] `consume_rate_limit` RPC is actually wired up
    from the app layer**, not just present in the schema: `src/app/post-a-job/actions.ts`
    and `src/app/actions.ts` both call `consumeRateLimit(RATE_LIMITS.postJob /
    .subscribe)` before doing privileged work, and the unsubscribe route path uses its own
    policy. The only gap is item 6 above (`/api/jobs/recent` unthrottled).

---

## Summary of scope not independently re-verified
- RLS policies at the Postgres level were read from migration SQL (grants/revokes look
  correct: `revoke all` + targeted `grant select`/`grant execute` per role, PII columns on
  `employers`/`subscribers` excluded from anon `select`), but this review did not run
  `db/tests/*.sql` against a live instance — that's the Data Architect / QA Engineer's
  lane per the team roster.
- Live-site check was limited to unauthenticated GETs on `/api/cron/maintenance` and a
  bad path; broader header/CSP inspection wasn't performed given proxy network
  restrictions in this session.
