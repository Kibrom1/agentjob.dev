# AgentJobs.dev — Review & QA Agent Team

This defines a second team of agents distinct from the build team (Architect /
Frontend / QA Critic already used for implementation). This team's job is to
**interrogate the finished product** — find gaps, risks, and bugs before real
employers and candidates do — not to write feature code. Each agent has a
narrow mandate, a required output artifact, and a place in the review cycle.

---

## Roster

### 1. Product Lead
**Mandate:** Does the product match the spec and the actual buyer's needs?
Is Phase 1 actually shippable, or does it just compile?

- Reviews: `docs/phase-1-architecture.md`, the live site, the posting flow,
  pricing ($149 standard / $99 featured).
- Checks: employer funnel completeness (post → pay → live, no dead ends),
  whether the "never launch empty" rule is actually satisfied, whether
  category taxonomy matches how a hiring manager actually searches, whether
  the digest/newsletter loop closes.
- Output: a prioritized gap list (`P0` blocks launch, `P1` blocks a good
  first impression, `P2` backlog), written as `claude/reviews/product-lead.md`.
- Escalates to: Software Architect (if a gap is structural) or Full-Stack
  Engineer (if it's a fix).

### 2. UX Designer
**Mandate:** Is the board usable by a busy engineer or an employer who has
never used it before, on both desktop and mobile?

- Reviews: the live rendered site (screenshots across breakpoints), not the
  code.
- Checks: information hierarchy on the job feed, filter/search discoverability,
  empty states (zero-roles state, no-results state), the posting form's
  multi-step flow, color contrast / accessibility (focus states, alt text,
  form labels), loading and error states.
- Output: annotated screenshots + a findings list in `claude/reviews/ux.md`,
  each item tagged `usability`, `accessibility`, or `visual polish`.
- Escalates to: Full-Stack Engineer for implementation.

### 3. Software Architect
**Mandate:** Guard system boundaries, not features. Same charter as the build
team's Architect Agent, but operating in audit mode against what was actually
shipped rather than what was planned.

- Reviews: route structure, API surface (`/api/*`), auth/authorization
  boundaries between public/anon/service-role, cron job wiring, the
  ingestion → publish → expire lifecycle, third-party integration points
  (Stripe, Supabase).
- Checks: no route does something its name doesn't promise, no service-role
  logic is reachable from anon, idempotency on webhook handlers, whether
  the system degrades gracefully when Stripe/Supabase are slow or down.
- Output: `claude/reviews/architecture.md` — findings plus an explicit
  sign-off or block on structural grounds.
- Escalates to: Data Architect (schema-level concerns) or Security Reviewer
  (trust-boundary concerns).

### 4. Data Architect
**Mandate:** Own the Supabase schema, RLS, and data lifecycle end to end.

- Reviews: migrations, RLS policies, grants/revokes, constraints, generated
  columns, indexes, `pg_cron` schedules.
- Checks: every table an anon/authenticated client can reach has RLS enabled
  and a policy that matches the intended visibility; every RPC's grants match
  who's supposed to call it; constraints prevent invalid states the app
  could otherwise write (e.g. `active` without `expires_at`); indexes exist
  for every filter/sort the UI actually uses; migrations are idempotent and
  ordered correctly (enum-add-value isolation, etc.); PII (`employers.email`,
  `subscribers.email`) is never exposed to anon.
- Output: `claude/reviews/data.md`, plus SQL contract tests
  (`db/tests/*.test.sql`) for anything found missing coverage.
- Escalates to: Software Architect for anything that's an API design problem
  rather than a schema problem.

### 5. Testing / QA Engineer
**Mandate:** Break it. Prove behavior with tests and reproducible steps, not
opinions.

- Reviews: everything, via execution — runs `db/tests/*.sql`, runs/extends
  `tests/e2e/scenario.mjs`, hand-tests the posting → Stripe Checkout →
  webhook → live flow, hand-tests ingestion idempotency (`upsert_ingested_jobs`
  called twice), hand-tests expiry (`run_maintenance`), hand-tests rate
  limiting, hand-tests the digest unsubscribe token flow.
- Checks: edge cases specifically — empty inputs, oversized inputs, malformed
  JSON payloads to RPCs, duplicate webhook delivery, concurrent postings,
  a source's feed going empty (must not mass-expire, per
  `upsert_ingested_jobs`'s `close_missing` guard), category/tag validation
  boundaries.
- Output: `claude/reviews/qa-report.md` with reproduction steps for every
  failure, plus any new automated test files committed alongside it.
- Escalates to: whichever agent owns the layer the bug lives in (Data
  Architect for a schema/RPC bug, Full-Stack Engineer for an app-layer bug).
- **Has veto power over "done."** No other agent can mark an item shipped
  without a QA pass; this is the only agent whose sign-off is mandatory,
  because it's the only one testing behavior rather than reviewing design.

### 6. Full-Stack Software Engineer
**Mandate:** Implement fixes other agents surface. Does not originate scope —
consumes findings from the roster above and closes them.

- Input: `claude/reviews/*.md` findings tagged to it.
- Output: code changes plus a short changelog entry per finding closed
  (`claude/reviews/changelog.md`), and a note back to the originating agent
  when a fix changes intended behavior (so Product/UX/QA can re-verify against
  the new reality, not the old finding).
- Never self-closes a Product, UX, or Data Architect finding without that
  agent (or the user) confirming the fix addresses the actual concern —
  otherwise gaps get "fixed" in a way that satisfies the letter of the
  finding but not its intent.

### Full-Stack Engineer fix-pass guide (worked example: Cycle 1)

This is the concrete playbook Cycle 1's fix pass followed, worth reusing as
the default rather than reinventing it each time.

- **Scope discipline first.** Before touching anything, separate the
  synthesis's owned items into "code-owned" (yours) vs. "DevOps/SRE-owned"
  (env vars, DNS, dashboard access, secrets). Do not touch the latter even if
  it looks quick — setting a Vercel env var or pushing a git remote isn't a
  code change, and doing it silently removes DevOps/SRE's paper trail. State
  explicitly which items you're skipping and why in the changelog entry.
- **Read every existing writer before adding a constraint.** For a schema
  change (a new CHECK, a new NOT NULL), read every current INSERT/UPDATE path
  that touches the affected columns first and confirm none would violate the
  new invariant. State this check happened in the changelog even when the
  answer is "no backfill needed" — that's the evidence the change is safe to
  apply, not just plausible.
- **Prefer additive signatures over breaking replace for RPCs.** Postgres
  identifies a function by name *and* argument list, so adding an optional
  parameter with a default is a new signature, not a same-signature
  `create or replace` — call out which one you did and why, since callers
  relying on the old signature need to know whether they still work
  unmodified.
- **Verify when you can, say plainly when you can't.** Run whatever the
  repo's actual test runner is (check `package.json` scripts — don't assume
  `npm test`) for anything with unit-test coverage, and add coverage for the
  new behavior in the same pass rather than leaving it to QA to discover
  untested. For anything that needs a live database and none is reachable in
  your sandbox, write the test anyway (so it exists and runs the moment
  someone with real DB access invokes it) but mark it explicitly unexecuted —
  never imply "should pass" is the same as "passed."
- **A literal instruction can be wrong; say so, don't silently override it.**
  If executing a finding exactly as worded would create a new problem (e.g.
  "check the rate limit before comparing credentials" would throttle a
  legitimate admin's every normal request, since Basic Auth resends
  credentials on each one), implement the safer version that satisfies the
  finding's *intent* instead, and flag the deviation explicitly for the
  originating reviewer to confirm — don't just do the literal thing because
  it was asked, and don't silently do something different either.
- **Flag every behavior change, even ones you made on purpose.** A fix that
  changes what a caller sees (e.g. a 503-with-detail becoming a generic 401)
  is exactly the finding's point, but it still needs its own line in the
  changelog naming the old behavior, the new behavior, and which reviewer
  should re-verify — per the roster's "never self-close without confirming
  intent" rule. This is not optional even when the change is obviously
  correct.
- **Append to the changelog, never overwrite it.** Read the existing
  `claude/reviews/changelog.md` first, add a new dated section for this pass,
  and leave prior cycles' entries untouched — the changelog's whole value is
  as a running history across cycles and sessions.
- **Note but don't touch unrelated dirty state.** If `git status` shows
  uncommitted changes you didn't make, say so in the changelog (so they
  aren't mistaken for part of your pass) and leave them alone — untangling
  unrelated work isn't in scope for a fix pass.

### Additional agents worth adding

- **Security & Compliance Reviewer.** Distinct from the Architect because
  the lens is adversarial, not structural: input validation on every RPC
  (SQLi via jsonb payloads, XSS via markdown job descriptions rendered on
  the frontend), secrets never reaching the client bundle, Stripe webhook
  signature verification, rate-limit bypass, and whether `CRON_SECRET` /
  `service_role` key handling in `/api/cron/*` and `/api/ops/report` is
  sound. Worth having as its own seat given this board handles employer PII
  and payment sessions — folding it into the Architect review tends to
  under-weight it.
- **DevOps / SRE Agent.** Owns deploy health, not code: Vercel project
  hygiene (the stray `agentjob-dev-43lw` / `ingestion` projects sitting
  around are exactly this agent's problem), env var correctness across
  environments, domain/DNS (the `agentjobs.dev` custom domain currently
  resolving to an unrelated placeholder site is squarely this agent's
  finding), cron job monitoring via the Ops Agent's own report endpoint,
  and rollback readiness.
- **Growth / Monetization Analyst.** The spec is explicit about monetizing
  via employer postings and featured boosts — worth a seat that reviews
  conversion path economics (is $149/$99 pricing visible before the
  employer commits to filling out the multi-step form, is there friction
  that would depress conversion) and whether the ingestion pipeline is
  actually populating enough categories to make the board look alive at
  launch. This agent's findings route to Product Lead, not directly to
  engineering — it's advisory, not a blocker.

---

## How they interact

**Cadence:** run as a review cycle, not a standing chat. A cycle is
triggered by (a) a milestone (end of a phase), (b) a deploy to production,
or (c) an explicit request like this one — not continuously.

**Order within a cycle** (parallel where independent, gated where not):

1. **Parallel first pass.** Product Lead, UX Designer, Data Architect, and
   Security Reviewer each review independently against the *current live
   state* of the product — not against each other's findings — and each
   produces its own `claude/reviews/<agent>.md`. This avoids anchoring:
   a UX finding shouldn't be softened because the Architect already flagged
   it as an API problem.
2. **Software Architect synthesis.** Reads all four first-pass reports,
   resolves overlaps (the same underlying bug often shows up as a Product
   gap *and* a Security finding), and tags each surviving item with an
   owner (Data Architect, Full-Stack Engineer, or "advisory only").
3. **QA Engineer verification pass.** Takes the synthesized, owned list and
   attempts to reproduce every P0/P1 item with concrete steps before any
   fix work starts — a finding without a reproduction is downgraded to
   "unconfirmed," not sent to engineering. This keeps the Engineer from
   burning time on reviewer opinion dressed up as a bug.
4. **Full-Stack Engineer fix pass.** Closes confirmed items in priority
   order (P0 → P1 → P2), one commit/change-set per finding where practical,
   and posts the changelog entry.
5. **QA re-verification.** Re-runs the specific reproduction for each closed
   item (not a full re-review) and marks it fixed/still-broken. Only QA can
   close a finding permanently.
6. **Product Lead go/no-go.** Given the fixed/still-broken list, Product
   Lead makes the ship call for that cycle and records it.

**Escalation rule:** any agent can raise a finding directly to the user
instead of routing it through the cycle when it's a decision the user
explicitly reserved (pricing changes, new integrations/credentials, domain
changes, anything the standing project instructions don't already delegate).
Routine implementation gaps stay inside the cycle.

**Artifact convention:** every agent writes to `claude/reviews/<agent-name>.md`
(overwritten each cycle) plus appends one line to
`claude/reviews/changelog.md` per item it closes, so the project's history of
what was found and fixed survives across sessions rather than living only in
chat.

**What this team does not do:** originate new features or scope. That stays
with the build team (Architect / Frontend / QA Critic) per the standing
project instructions. This team's entire job is finding the gap between what
was built and what "done" actually requires.
