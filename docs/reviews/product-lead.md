# Product Lead Review — AgentJobs.dev Phase 1

Reviewed against: `docs/phase-1-architecture.md`/README spec, live site
(https://agentjob-dev.vercel.app), and source under `src/`, `ingestion/`,
`.github/workflows/`. Date: 2026-09-16.

## Summary

Phase 1 is architecturally solid — pricing, category taxonomy, the posting
funnel's UI, and the digest signup all match spec and don't dead-end. The
real gap is not "0 roles" itself (expected right now) but that **every path
which is supposed to populate the board is currently non-functional in
production**, which directly violates the spec's "never launch an empty
board" rule. That's the P0.

---

## P0 — blocks launch

1. **No working path to populate the board exists in production right now.**
   Two independent failures compound:
   - `/admin` returns "Set ADMIN_PASSWORD (12+ characters) to enable the
     admin console" — the admin curation fallback (`/admin/jobs/new`,
     "Publish a curated listing... without payment") is disabled because
     `ADMIN_PASSWORD` isn't set in the Vercel production env.
   - The repo has **no git remote configured** (`git remote -v` returns
     nothing), so `.github/workflows/ingest.yml` (the scheduled
     Greenhouse/Lever/Ashby scraper, every 6h) cannot be running anywhere —
     it only exists locally, never pushed to GitHub Actions.
   Net effect: an employer or candidate visiting today sees "0 roles" with
   no automated or manual mechanism actively working to change that. Fix:
   set `ADMIN_PASSWORD`/`ADMIN_USERNAME` in Vercel prod env immediately as a
   stopgap, and push the repo to GitHub + add
   `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` secrets so ingestion runs.
   Found at: `https://agentjob-dev.vercel.app/admin`, `src/lib/admin/auth.ts:19`,
   local repo (no remote), `.github/workflows/ingest.yml`.

2. **Ingestion has never been run for real.** Even once secrets/remote exist,
   README section 5 (GitHub Actions) explicitly calls for a manual dry-run
   then a real run "so the board isn't empty at launch" — there's no
   evidence (and no way, given finding #1) that this has happened. This is
   the direct, current cause of the empty board, not just a config gap.
   Found at: `README.md` §5 ("First run"), `ingestion/sources.yaml` (7
   sources configured — Anthropic, Scale AI, Databricks, Vercel, OpenAI,
   LangChain, Cohere — good initial seed list, just never executed).

---

## P1 — blocks a good first impression

3. **Custom domain `agentjobs.dev` points to an unrelated placeholder site**,
   not this app (per task context — confirmed separate DevOps issue, not
   re-flagged in detail here, but it directly undermines "how a real user
   finds and uses this": anyone typing the obvious domain lands on the wrong
   site entirely, with zero path back to `agentjob-dev.vercel.app`).

4. **No stray-Vercel-project cleanup visible** (`agentjob-dev-43lw`,
   `ingestion` per team guidelines) — cosmetic to a user but signals an
   unfinished deploy story if a prospective employer looks at
   vercel.com/kibmit-4784s-projects.

5. **Admin console has no bootstrap/runbook check** — nothing in `/admin`
   or `/api/health` surfaces "admin is disabled" to anyone except whoever
   directly loads `/admin`; the Ops report (`/api/ops/report`) should
   probably flag "admin disabled" and "0 active jobs" as its own alert
   condition so this doesn't silently persist. Found at:
   `src/lib/admin/auth.ts`, `docs/ops-agent.md`.

---

## P2 — backlog / working as intended, worth noting

6. **Pricing is shown before commitment** — good. Sidebar on `/post-a-job`
   shows "$149 / +$99" before the employer enters any company info, and the
   5-step progress bar (Company → Role → Description → Pay & apply →
   Review) is visible from step 1. No finding here, confirming spec
   compliance (`src/app/post-a-job/page.tsx`).

7. **Category taxonomy matches spec exactly** — all 7 categories (Agent
   Orchestration, Multi-Agent Systems, Tool-Use Backends, Local LLM
   Infrastructure, Retrieval & Memory, Evals & Observability, Agent Platform
   & DevTools) are seeded in `supabase/migrations/20260915000000_core_schema.sql`
   and rendered as filter chips on the homepage exactly as named. No fix
   needed.

8. **Digest signup calls a real RPC** (`subscribe_to_digest`), is
   enumeration-safe, honeypot-protected, and rate-limited
   (`src/app/actions.ts`, `src/lib/rate-limit.ts`) — no dead end, no fake
   "success" theater. No fix needed, noted for completeness per the
   escalation checklist.

9. **Employer funnel has no visible dead end in the UI**: posting form →
   Stripe Checkout → webhook (`activate_paid_job`) → success page with a
   late-webhook fallback that "asks Stripe directly." Structurally this
   closes the loop; wasn't payment-tested per instructions (no real charge),
   so full webhook correctness under real Stripe traffic is Software
   Architect / QA territory, not re-litigated here.

10. **Ingestion classifier gates on title + agent/LLM signal**
    (`ingestion/agentjobs_ingest/classify.py`), which is the right guard
    against generic "AI company" boilerplate roles diluting the niche
    positioning — matches the spec's hyper-niche intent. No fix needed.

11. **"Never launch empty" guidance exists only in the README/team docs,
    not enforced anywhere in code or ops alerting** — worth a lightweight
    automated check (e.g., ops report flags `active_jobs = 0` as
    attention-needed, not just descriptive) so this can't silently recur
    after an ingestion outage. Advisory, routes to DevOps/Ops Agent per
    team guidelines.

---

## Go/no-go

**No-go** on P0 items. The product itself (UI, pricing, funnel, taxonomy)
is launch-ready; what's missing is entirely operational: set
`ADMIN_PASSWORD` in Vercel prod, push the repo to GitHub with ingestion
secrets configured, and run ingestion for real (or hand-curate a starter
set via `/admin/jobs/new` once unlocked) before calling this launched.
