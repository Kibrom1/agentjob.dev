# Launch smoke test and human-only runbook

Source: `docs/reviews/launch-work-plan.md` (WP-6 and section 4, "Human-only checklist"). This page adds no
values of its own: anything not stated in the plan or the code is marked as something to decide or look up.

## 1. Run the smoke test

`scripts/smoke-test.sh` is read-only: GET requests only, no writes, no mutating POSTs. Configuration is by
environment variable only (never arguments); secrets are never printed or written to disk. `CRON_SECRET` is
handed to curl via stdin so it does not appear in the process list.

```bash
# No secrets: public checks only
SITE_URL=https://<prod> ./scripts/smoke-test.sh

# With the cron secret: also checks the authorised GET of /api/ops/report (read-only)
SITE_URL=https://<prod> CRON_SECRET=... ./scripts/smoke-test.sh
```

| Variable | Purpose |
|---|---|
| `SITE_URL` | Required. Site origin. |
| `EXPECT_ORIGIN` | Origin expected in `<link rel="canonical">`; defaults to `SITE_URL`. Set it to the final domain if you test a preview URL. |
| `CRON_SECRET` | Optional. Enables the authorised `/api/ops/report` check. |
| `RUN_MAINTENANCE=1` | Also calls `/api/cron/maintenance` with the secret. This runs `run_maintenance` (writes: expires jobs). Off by default. |
| `RUN_DIGEST=1` | Also calls `/api/cron/digest` with the secret. This sends email. Off by default. |

Checks: `/api/health` 200; `/` 200 with the expected canonical origin; `/terms`, `/privacy`, `/refund`,
`/about` 200; `/api/jobs/recent?days=14` 200 with a `jobs` array; `/sitemap.xml` 200 with `/jobs/` entries;
`/robots.txt` 200; `/admin` without credentials 401 (503 means `ADMIN_PASSWORD` is unset); cron and ops routes
without a secret 401; unknown job slug 404; the five security headers from `next.config.ts`.
Exit code is non-zero if any check fails. Skips (no secret supplied, opt-in checks) do not fail the run.

Known state before the other work packages land: `/api/jobs/recent` returns 500 (migration with
`p_published_after` not applied) and the four legal pages return 404. Admin credentials are not used by the
script; it only verifies that `/admin` refuses unauthenticated access.

Do not announce the launch until the run shows all PASS (plan item 12).

## 2. Human-only launch checklist (order matters)

From the plan; none of this can be done by a developer or agent.

1. Review and merge PR #7 (`20260917000200_revoke_ingestion_runs_client_grants.sql`).
2. Confirm which migrations prod has applied: `supabase migration list` against the prod project.
3. After WP-2 merges: `supabase db push --dry-run`, then `supabase db push` (or paste each migration, in order,
   into the Supabase SQL editor). Then `curl -s -o /dev/null -w "%{http_code}" https://<prod>/api/jobs/recent`
   must print 200. Apply WP-10's migration the same way when it merges.
4. Vercel production environment variables (verify, do not assume): `CRON_SECRET`, `ADMIN_USERNAME`,
   `ADMIN_PASSWORD`, Supabase URL/anon and service-role keys as the app requires, `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `POSTAL_ADDRESS`, `NEXT_PUBLIC_SITE_URL` (final
   domain). `src/lib/env.ts` is the authoritative list. Redeploy after changing.
5. GitHub Actions secrets for ingestion (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). After WP-5 merges, run
   the "Ingest" workflow manually once and check the summary artifact. Confirm the scheduled workflow is enabled.
6. Stripe: register the webhook endpoint at the production URL for `checkout.session.completed` and
   `checkout.session.expired`. Run one full test-mode purchase (Stripe's published test card 4242 4242 4242 4242)
   from a Vercel preview or production in test mode: the job goes `active`, the success page renders, the
   receipt email arrives. Then switch to live keys, and optionally make and refund one real purchase. Review
   coupons: only controlled promotion codes may exist (`allow_promotion_codes: true`).
7. Domain: decide the brand spelling (agenticroles.dev vs agenticroles.dev); DNS, Vercel domain assignment, SSL;
   update `NEXT_PUBLIC_SITE_URL`.
8. Legal: company entity name, contact and privacy emails, postal address, governing law, refund policy, lawyer
   review of Terms, Privacy, Refund and About; fill `src/lib/legal.ts`; run
   `scripts/check-launch-placeholders.sh` (added by WP-3) to confirm none remain. Review each source ATS's terms
   for redistribution; keep or drop sources accordingly.
9. Resend: verify the sending domain (SPF/DKIM) and test unsubscribe end to end from a real mailbox.
10. Product decisions: classifier strictness (WP-5 dial); whether to keep the "Partner" exclusion; hero copy
    approval; whether to hold the first HN/X post until the relevance rate is acceptable.
11. Monitoring: uptime monitor on `/api/health`; Vercel Web Analytics toggle; alert routing for the ops agent
    report; confirm both crons from `vercel.json` appear in Vercel cron visibility.
12. Run the smoke test (section 1) with `CRON_SECRET` supplied locally; all PASS before announcing.
13. Do not run `db/seed/sample_jobs.sql` in production.

## 3. Manual verification the script cannot do

- Stripe test-mode purchase: confirm webhook delivery in the Stripe dashboard, the job turning `active`, and
  the receipt email (item 6).
- First ingestion run and spot-check of the board (item 5).
- Unsubscribe link from a received email works (item 9).
- Digest dry-run: the digest cron sends email, so review the plan and code for how to dry-run it before
  setting `RUN_DIGEST=1`; do not run it against real subscribers casually.

## 4. Rollback

If a deploy misbehaves, promote the previous known-good deployment in Vercel (Deployments, select the previous
production deployment, Promote to Production / Instant Rollback). Rolling back does not undo database
migrations; assess migrations separately before rolling back across one. Re-run the smoke test afterwards.
