# UX Designer Review — AgentJob.dev

Reviewed live site at https://agentjob-dev.vercel.app (desktop ~1440px). Note:
this session's browser-resize tool did not actually shrink the rendered
viewport (screenshots kept coming back at desktop resolution despite
`resize_window` reporting success), so mobile-breakpoint findings below are
inferred from the page's responsive markup/behavior rather than a captured
mobile screenshot — flag this limitation if a future review needs confirmed
mobile screenshots.

Board currently has 0 live jobs — evaluated as an empty-state design per
instructions, not as a bug.

## Findings

1. **[usability]** Homepage empty state is well done: dashed-border card,
   `{ }` glyph, "No open roles right now" heading, and a direct nudge to
   subscribe to the digest — it gives the visitor a next action instead of
   a dead end. (Homepage, mid-page, below filter chips.)

2. **[visual polish]** Hero, search bar, category chips, and digest box read
   as clean and purpose-built rather than a generic template — strong first
   impression for a niche board. (Homepage, top of page.)

3. **[usability]** Pricing ($149 listing / $99 featured) is shown in a
   persistent right-hand sidebar from step 1 of the "Post a job" flow, before
   the employer has invested any typing — good, avoids bait-and-switch friction
   at checkout. (Post a job, step 1, right sidebar.)

4. **[accessibility] — confirmed bug.** On the "Post a job" step 1 form,
   clicking directly into the "Your email" input did not always move focus
   there; in one pass, keystrokes intended for the email field landed in the
   "Company name" field instead, concatenating into "Test Cotest@example.com".
   This points to either a layout/focus-management bug or hit-target overlap
   between fields. This is a serious usability/accessibility problem for a
   paid conversion flow — a misdirected email would break the "receipt and
   listing confirmation" promise the label makes right below the field.
   (Post a job, step 1, "Your email" field.)

5. **[usability]** Step 1 validation is good in isolation (red border +
   inline "Enter your email address" message appears only on the empty/invalid
   field) but only triggers after Continue is clicked — no live/inline
   validation as the user types or blurs the field, so a malformed email
   could pass silently until submission. (Post a job, step 1.)

6. **[usability]** The 5-step progress indicator ("1. Company → 2. Role →
   3. Description → 4. Pay & apply → 5. Review") is a clear, low-anxiety way
   to show an employer how much is left — good information hierarchy for a
   multi-step paid form. (Post a job, all steps.)

7. **[usability]** Step 2 ("Describe the role") uses native `<select>`
   dropdowns for Category, Employment type, and Workplace with no visible
   custom styling cue (e.g. chevron affordance is subtle) — on some
   OS/browser combos these can look like plain text rather than an
   interactive control. Low severity, but worth a visual affordance pass
   (custom chevron/border treatment) given how central "Category" is to the
   board's whole value prop (hyper-niche taxonomy). (Post a job, step 2.)

8. **[usability]** Field-level help text is used well throughout ("For your
   receipt and listing confirmation. Never shown publicly.", "City, region or
   remote scope, e.g. 'Remote (US)'", "Comma-separated, up to 12") — reduces
   ambiguity without cluttering the form. (Post a job, steps 1–2.)

9. **[visual polish]** The 404 page ("This role isn't available" / "The
   listing may have been filled or expired, or the link is mistyped.") is a
   thoughtfully-worded, on-brand empty/error state with a clear "Browse open
   roles" recovery action — better than a generic 404. (`/jobs` route,
   full page.)

10. **[usability]** There is no distinct "Browse jobs" page — the nav link
    goes to the same homepage feed/filter UI. That's a reasonable choice for
    a single-feed board, but worth confirming intentional: a first-time
    visitor clicking "Browse jobs" from a job detail page gets no visual
    change/scroll cue that they've "arrived" anywhere new.

11. **[accessibility]** Search input and filter chips have no visible focus
    ring distinct from hover state in the default screenshots — worth
    verifying with keyboard-only navigation (Tab through chips) that focus is
    visually obvious, since chip active/inactive states already rely on
    similar dark-pill styling ("All roles" and "Anywhere" pills are solid
    black whether focused or just selected).

12. **[usability]** No job detail page could be reached — the board has zero
    live listings, so this page type is entirely unverified. Flagging as a
    gap in this review's coverage, not a bug: Product/QA should re-run this
    check once ingestion populates at least one listing.

13. **[visual polish]** Footer is minimal and consistent ("agentjob.dev —
    Jobs for engineers who build AI agents." / "© 2026 AgentJob") and appears
    identically on both the homepage and the post-a-job page — good baseline
    consistency, nothing to fix.

## Coverage gaps for next cycle
- Mobile breakpoint screenshots could not be captured in this session
  (tooling limitation, see note above) — re-run with a device that reliably
  reports a narrow viewport.
- No job detail page exists yet to review (zero live listings).
- Did not reach the Stripe Checkout step (stopped at step 2 of "Post a job"
  per instructions to avoid paying).
