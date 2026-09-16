# The Ops Agent

AgentJob.dev runs itself day to day — jobs publish on payment, expiry and
digests run on their own schedule. Nobody was watching whether any of that
was actually still working, whether the board looked healthy to a visitor,
or whether new listings were worth telling anyone about. This is the design
for the piece that watches: a small **observability layer in the app** plus
a **scheduled agent** that reads it and reports back in plain language.

Same three reviewers as the rest of the build.

---

## Opening proposal

**Architect.** Split this into two halves, because they have very different
trust levels and failure modes:

1. **In-repo observability.** A durable log of every ingestion run
   (`ingestion_runs` table + `log_ingestion_run()`), folded into the existing
   `admin_stats()` RPC, exposed read-only at `/api/ops/report` behind the
   same `CRON_SECRET` the other cron routes already use. No new secret, no
   new attack surface — it reuses a boundary that exists.
2. **The agent itself** is a Claude scheduled task, not new application
   code. It calls the report endpoint, drafts marketing copy from
   `/api/jobs/recent` (a new *public* read-only endpoint — the same data
   the board already shows, just as JSON), and messages the founder a daily
   digest. It never writes to the database and never posts anywhere on its
   own.

**Risk Assessor.** Two things to guard against immediately:

1. **"Admin agent" must not mean "an LLM with the service-role key."**
   Handing a scheduled, occasionally-unsupervised process direct
   `admin_update_job` / `admin_create_job` access means one bad tool call
   can reject real listings or publish spam at 3am with nobody watching.
   The agent gets **read-only** access (the ops report, the public recent-
   jobs feed) and **drafts** for anything else. A human approves every
   moderation action and every social post before it goes out.
2. **Marketing drafts are not auto-posted.** There's no Twitter/LinkedIn API
   credential in this project (and adding one is a real decision — rate
   limits, brand voice, what happens if a draft is wrong). Until that's
   explicitly wanted, drafts are v1 output, not v1 output plus a publish
   step.

**Engineer.** Constraints this has to work inside:

- The board isn't deployed yet, so a scheduled task that hard-depends on
  hitting a live URL would just fail every run until then. The agent checks
  `/api/health` first and reports "not live yet" as a normal, quiet outcome
  rather than an error.
- No new secret. The report route reuses `CRON_SECRET`; the recent-jobs
  route needs no secret at all because it returns nothing RLS wouldn't
  already show a visitor.

---

## What got built

**`ingestion_runs` (migration `20260916000300`).** One row per source per
ingestion invocation: status, counts, error text, start/finish time. Written
by `log_ingestion_run()` (service-role only) from `pipeline.run_source()` —
every run is logged, including failures, and a logging failure itself is
caught and never fails the ingestion run (observability must not become a
new way for ingestion to break).

**`admin_stats()`** now also returns `ingestion_last_runs`: the latest row
per source, so a source that has gone quiet or started erroring is visible
in one call instead of a manual query.

**`run_maintenance()`** purges `ingestion_runs` older than 90 days as part
of its existing daily sweep.

**`GET /api/ops/report`** (Bearer `CRON_SECRET`, same as `/api/cron/*`):
returns the full stats payload, a flat array of `flags` (each `{ level:
"warning" | "info", code, message }`), and a rendered plain-text `summary`.
The flag rules live in `src/lib/ops/report.ts` as a pure, unit-tested
function (`computeOpsFlags`) — no I/O, so every rule is tested directly
against a stats fixture rather than through a live database:

- board has zero live listings
- a source's last run failed, or hasn't run in 48+ hours
- the digest is stuck "sending" for 6+ hours (safe to re-run — deliveries
  are deduplicated) or hasn't started in 9+ days
- zero active subscribers / zero paid listings in 30 days (informational
  nudges, not warnings)

**`GET /api/jobs/recent?days=N`** (public, no secret): the same
`search_jobs` data the board itself renders, filtered to the last N days
(default 2, capped at 14) and shaped for drafting a post — title, company,
tags, absolute URL. This is what the agent reads to know what's new.

**The scheduled task ("AgentJob.dev Ops Agent").** Runs daily. Each run:

1. Checks `/api/health`. Not reachable yet → reports that plainly and stops;
   this is expected until the site is deployed, not a failure.
2. If reachable and `CRON_SECRET` has been wired into the task, pulls
   `/api/ops/report` and leads with anything flagged.
3. Pulls `/api/jobs/recent` and drafts two or three short social posts
   (X/LinkedIn-length) for the newest or most interesting listings —
   presented for the founder to copy and post, never sent anywhere itself.
4. Sends one concise message: health → flags → drafts. Nothing to report
   two days running is a short "all quiet" note, not a wall of text.

---

## What still needs a human

- **Deploying the site** — until `NEXT_PUBLIC_SITE_URL` resolves to a real
  deployment, the agent can only report "not live yet."
- **Telling the agent the site URL and `CRON_SECRET`** once deployed, so it
  can move from "public health only" to the full report. (Same secret
  already in Vercel for the other cron routes — nothing new to generate.)
- **Any move from "draft" to "auto-post"** on social — that's a product
  decision (which platforms, what voice, what happens on a bad draft) and
  needs its own credentials, not something to back into via a scheduled
  task's system prompt.
- **Admin actions themselves** (reject/restore/feature) stay a human
  clicking a button in `/admin`, on purpose — see the Risk Assessor note
  above.

---

## Operating the scheduled task

The task is named **"AgentJob.dev Ops Agent"** (id `trig_012kQ7rrduKhjgZa5ret4cCa`),
runs daily at 13:00 UTC, and notifies in-app only (no push/email) — ask
Claude to change either. It assumes the production URL is `https://agentjob.dev`;
once deployed, ask Claude to update the task's prompt with the real URL (if
different) and the `CRON_SECRET` value from Vercel so it can pull the full
report instead of just the public health/recent-jobs endpoints. Marketing
drafts it writes land in the project doc `claude/marketing-drafts.md`.
