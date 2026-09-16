-- Data Architect P1 (docs/reviews/data.md, architecture-synthesis.md #6):
-- featured_until <= expires_at was only held by convention across
-- activate_paid_job() and admin_update_job() — nothing at the schema level
-- prevented a future writer from pinning a job past its own expiry. Add the
-- constraint the schema should have had from the start.
--
-- Checked against every current writer of both columns before adding this:
--   - activate_paid_job(): featured_until := now() + duration when featured,
--     same duration used for expires_at => equal, satisfies "<=".
--   - admin_create_job(): same pattern (featured_until := expires_at when
--     featured via the jsonb payload's own duration).
--   - admin_update_job() 'feature': featured_until := least(expires_at, ...)
--     => always <= expires_at by construction.
--   - admin_update_job() 'extend': both featured_until and expires_at are
--     bumped by the same make_interval(days => p_days) off of
--     greatest(<col>, now()); since featured_until <= expires_at held before
--     the update, and greatest() is monotonic, it still holds after.
--   - admin_update_job() 'reject'/'unfeature'/'restore' only clear/lower
--     is_featured or extend expires_at, never raise featured_until above it.
-- No currently-applied migration or seed data sets featured_until without
-- going through one of the above, so no backfill is required.
\set ON_ERROR_STOP on

alter table public.jobs
  add constraint jobs_featured_within_window_chk
  check (featured_until is null or expires_at is null or featured_until <= expires_at);
