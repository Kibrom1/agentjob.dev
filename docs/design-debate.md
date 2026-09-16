# AgentJob.dev: design debate and final blueprint

This records how three reviewer personas debated the design of the full build: employer posting, payments, admin, ingestion and the weekly digest. Every decision below is in the code.

- **Architect:** owns the overall system design and data flow.
- **Risk Assessor:** looks for failure modes, security gaps and wrong assumptions.
- **Engineer:** owns the code, configuration and scripts.

---

## Opening proposals

**Architect.**

- **Web app:** keep one Next.js app on Vercel. Postgres (Supabase) is the single place where state lives.
- **Posting flow:** the employer fills in a form, a server action saves the job, and Stripe Checkout takes payment. A Stripe webhook then publishes the job.
- **Ingestion:** a separate Python job pulls public ATS feeds (Greenhouse, Lever, Ashby) and writes them to the database through a stored procedure.
- **Weekly digest:** a Vercel cron job sends it through Resend.
- **Admin:** a small console behind authentication.

**Risk Assessor.** Five threats to design for:

1. **Fake webhooks.** Anyone can post a fake "payment succeeded" event to our webhook.
2. **Metadata tampering.** Checkout metadata could be altered to mark a job as featured without paying for it.
3. **Spam before payment.** Anyone can flood the posting form before paying, filling the database with drafts.
4. **Mass expiry.** If an ATS feed fails partway through, ingestion could wrongly expire every job from that source.
5. **Duplicate digests.** A retried cron run could email every subscriber twice.

**Engineer.** A few constraints to plan around:

- **No live feeds.** The build sandbox cannot reach the ATS APIs, so the parsers must be written from the documented formats and tested against recorded sample payloads.
- **Protected folder.** Nothing can be written into `.github/`, so any GitHub Actions workflows ship as files for you to copy in.
- **Timeouts.** Vercel functions have time limits, so the digest must be able to resume where it stopped.

---

## Round 1: critique

**Risk Assessor on the posting flow.** Publishing on the redirect to the success page is not safe, because anyone can visit that URL.

- **Decision:** only the webhook publishes a job.
  - The webhook verifies Stripe's signature against the raw request body.
  - It publishes only if `payment_status === 'paid'`, or on an `async_payment_succeeded` event.
  - The success page only reads the job's current state.

**Risk Assessor on pricing.** Whether a job is featured must come from what was actually paid, not from anything the browser sent.

- **Decision:** the server fixes the prices in code (`lib/posting/pricing.ts`) and puts them in the Checkout session itself.
  - The webhook re-checks that the pre-discount `amount_subtotal` (and currency) matches the expected amount for that session's plan before publishing, so promotion codes still work.
  - If the amount doesn't match, the webhook logs it and refuses to publish.

**Architect on writes.** The server should not scatter writes across several tables with the privileged key.

- **Decision:** one stored procedure, `create_job_posting(employer, job)`, does all posting writes.
  - It creates or updates the employer and inserts the draft job in a single transaction.
  - The server (service role) is the only caller allowed to run it.

**Engineer on abandoned checkouts.** Stripe checkout sessions expire after 24 hours.

- **Decision:** the database gets a new `payment_expired` status, set when Stripe sends `checkout.session.expired`.
  - This needs its own migration file, because Postgres cannot use a new enum value in the same transaction that adds it.
  - Drafts that never reached Checkout are purged after 48 hours by `run_maintenance()`.

**Risk Assessor on spam.** Honeypot fields alone won't stop spam.

- **Decision:** add rate limiting inside Postgres, using the `rate_limits` table and `consume_rate_limit()`.
  - Callers are identified by a SHA-256 hash of their IP address.
  - This needs no Redis or other paid service.
  - If the rate-limit check itself fails, the request is allowed through. Losing a paying employer costs more than letting some spam through.

---

## Round 2: resolving the bottlenecks

**Ingestion idempotency.**

- `upsert_ingested_jobs(source_name, jobs jsonb, close_missing)` matches incoming jobs on `(source_name, external_id)`. It uses the existing partial unique index by passing the index's own `WHERE` condition in `ON CONFLICT … WHERE external_id IS NOT NULL`.
- It never brings back a job an admin has removed (`rejected`).
- Jobs that are still listed at the source have their `expires_at` extended.
- Jobs that disappear from the source are marked expired only when both of these hold:
  - the caller passes `close_missing`, which the Python client does only after a complete, successful fetch
  - the incoming list is not empty
- Each row is handled in its own sub-transaction, so one bad row is reported and skipped instead of failing the whole batch.

**Classifying ingested jobs.** Two signals must both be present, which keeps out generic "AI" and sales roles:

- the job title must name an engineering role
- the posting must match enough agent-related keywords (orchestration, tool use, LLM infrastructure and similar)

The category comes from rules that fire in priority order. Tags are picked from a curated list, so they always satisfy the database's tag rule.

**Digest reliability.**

- Each week is one row in `digest_runs`, keyed by the week's start date.
- Each email sent is recorded in `digest_deliveries`, keyed by `(run, subscriber)`.
- A retried or timed-out cron run picks up from the recipients not yet sent. Nobody is emailed twice by our side.
- Emails go out in Resend batches of 100.
- Every email carries a one-click unsubscribe (RFC 8058: the `List-Unsubscribe` and `List-Unsubscribe-Post` headers) and a postal address, as CAN-SPAM requires.

**Unsubscribe links.** Opening the link never unsubscribes on its own, because email security scanners open links automatically.

- The page asks for a confirmation click, which is a POST.
- Mail clients use a separate one-click POST endpoint.

**Admin authentication.** Adding Supabase Auth only for a single-founder console is too much.

- **Decision:** HTTP Basic auth on `/admin`, checked in Next's `proxy.ts`.
  - The password comparison takes the same time whether it's right or wrong, so attackers learn nothing from timing.
  - HTTPS is required.
  - Every admin server action checks the credentials again, in case the proxy is bypassed.

---

## Round 3: final blueprint

```
                         ┌─────────────── Vercel (Next.js 16) ────────────────┐
Browser ── GET / ───────▶│ feed (anon key, RLS)                                │
        ── /post-a-job ─▶│ server action → consume_rate_limit → create_job_    │
                         │   posting → Stripe Checkout (price fixed in code)  │──▶ Stripe
Stripe ─ webhook ───────▶│ /api/stripe/webhook: verify sig → check amount →    │
                         │   activate_paid_job → revalidatePath → email        │──▶ Resend
Vercel Cron (Mon) ──────▶│ /api/cron/digest: begin_digest_run → batches → record│──▶ Resend
Vercel Cron (daily) ────▶│ /api/cron/maintenance: run_maintenance()            │
Admin ─ Basic auth ─────▶│ /admin (proxy.ts + per-action check, service role)  │
Mail client ─ POST ─────▶│ /api/unsubscribe/[token] → unsubscribe_from_digest  │
                         └────────────────────────┬───────────────────────────┘
                                                  │ PostgREST (anon / service role)
GitHub Actions (cron) ── Python ingest ──────────▶│ upsert_ingested_jobs (service role)
                                                  ▼
                                        Supabase Postgres (+ pg_cron sweep)
```

**Where each secret lives.**

| Secret | Where it is used | Who has it |
| --- | --- | --- |
| anon key | public reads | the web app |
| service role key | web app server only; ingestion runner | web app server, ingestion runner |
| Stripe secret key and webhook secret | web app | web app |
| Resend key | web app | web app |
| `CRON_SECRET` | sent by Vercel Cron, checked by the app | Vercel and the app |
| `ADMIN_PASSWORD` | admin console | the app |

None of these are ever sent to the browser.

**How it's tested.**

- **Database (SQL):** contract tests cover every stored procedure, access grant and state transition.
- **Web app (Vitest):** unit tests cover the input schemas, pricing, webhook handling (with real Stripe signatures), digest batching and resume, admin authentication and email templates.
- **Ingestion (pytest):** tests use recorded payloads from each ATS, cover the classifier, and replay HTTP responses so the client runs against realistic data.
- **Browser (Playwright):** smoke tests run against a stub of Supabase's REST API.

**Needs your permission or credentials.** The README marks each of these with 🔐:

- Supabase project keys
- Stripe keys and the webhook endpoint
- Resend key and a verified sending domain
- the postal address shown in emails
- the admin password
- Vercel `CRON_SECRET`
- GitHub Actions secrets for ingestion
- copying the two workflow files into `.github/workflows/`

---

## Problems the Risk Assessor caught during the build

Each of these was found by a test, fixed, and is now covered by a regression test.

1. **The form skipped the review step.**
   - **Problem:** Clicking "Continue" on step 4 went straight to payment, with no chance to review or add the featured option. React reused the same `<button>` element and changed it to `type="submit"` while the click was still being handled, so the browser submitted the form.
   - **Fix:** the Continue and Pay buttons now get separate keys. The end-to-end test caught this.
2. **Cancelled checkouts lost the employer's draft.**
   - **Problem:** A save effect wrote the empty starting values over the saved draft before the restore could read it.
   - **Fix:** saving now waits until the restore has run.
3. **Stripe customer IDs failed a database check.**
   - **Problem:** `cus_test_e2e` failed the `^cus_[A-Za-z0-9]+$` rule. The fulfillment step correctly logged this without failing, but the test data now uses real-format IDs.
4. **Ingestion errors listed the wrong rows.**
   - **Problem:** The test expected rows without an `external_id` to be listed first. They are actually reported in the order they appear in the batch.
   - **Fix:** the test assertions were corrected.
5. **The ingestion SQL could be quietly weakened.** Mutation tests confirmed the SQL tests fail when any of these protections is removed:
   - the guard that keeps admin-rejected rows from coming back
   - the revoke of anonymous function access
   - the "subscribed before this run" digest filter
   - the refusal to close every job from an empty feed
6. **Generic roles at AI companies were published.**
   - **Problem:** A payments role at an AI lab passed the relevance filter on company boilerplate alone.
   - **Fix:** the threshold was raised to 6. A test pins this case.
7. **Stale test servers skewed the end-to-end results.**
   - **Problem:** An `npx`-wrapped `next start` left the real server running after cleanup, so later runs tested an old build.
   - **Fix:** the script now starts the Next.js binary directly, so cleanup stops the right process.
