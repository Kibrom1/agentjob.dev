-- =============================================================================
-- Data retention, enforced by the daily run_maintenance() sweep.
-- (Draft for counsel review: periods below are the engineering default and are
-- disclosed on /privacy; change both together.)
--
--   rate_limits            1 day          (already purged; hashed-IP keys only)
--   ingestion_runs         90 days        (already purged)
--   stale employer drafts  48 hours       (already purged)
--   subscribers            unsubscribed rows are deleted 90 days after
--                          unsubscribed_at. The 90 days keeps a short window to
--                          honour a re-subscribe/complaint; active subscribers
--                          are kept until they unsubscribe or ask for erasure.
--                          digest_deliveries cascade with the subscriber.
--   digest_deliveries      12 months after sent_at (delivery bookkeeping is only
--                          needed to dedupe a run and debug recent sends).
--   employer jobs          non-live employer-submitted jobs (expired, rejected,
--                          payment_expired, abandoned draft/pending_payment)
--                          are deleted 24 months after they expired / were
--                          created. Live jobs are never touched here.
--   employers              employer contact rows (email, Stripe customer id)
--                          with no remaining jobs and created over 24 months
--                          ago are deleted. Stripe keeps its own payment
--                          records under its own retention obligations.
--
-- CREATE OR REPLACE keeps the existing grants (same signature).
-- =============================================================================

create or replace function public.run_maintenance()
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_expiry           record;
  v_purged_drafts    integer;
  v_purged_limits    integer;
  v_purged_ingestion integer;
  v_purged_subs      integer;
  v_purged_deliv     integer;
  v_purged_emp_jobs  integer;
  v_purged_employers integer;
begin
  select * into v_expiry from public.expire_jobs();

  -- Drafts that never reached Stripe Checkout (e.g. Stripe API error).
  delete from public.jobs
   where status = 'draft'
     and source = 'employer'
     and stripe_checkout_session_id is null
     and created_at < now() - interval '48 hours';
  get diagnostics v_purged_drafts = row_count;

  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_purged_limits = row_count;

  delete from public.ingestion_runs where finished_at < now() - interval '90 days';
  get diagnostics v_purged_ingestion = row_count;

  -- Unsubscribed subscribers: erase the email 90 days after they left.
  delete from public.subscribers
   where unsubscribed_at is not null
     and unsubscribed_at < now() - interval '90 days';
  get diagnostics v_purged_subs = row_count;

  delete from public.digest_deliveries where sent_at < now() - interval '12 months';
  get diagnostics v_purged_deliv = row_count;

  -- Non-live employer jobs older than 24 months (status compared as text so the
  -- statement does not depend on enum values added by later migrations).
  delete from public.jobs
   where source = 'employer'
     and status::text in ('expired', 'rejected', 'payment_expired', 'draft', 'pending_payment')
     and coalesce(expires_at, created_at) < now() - interval '24 months'
     and created_at < now() - interval '24 months';
  get diagnostics v_purged_emp_jobs = row_count;

  delete from public.employers e
   where e.created_at < now() - interval '24 months'
     and not exists (select 1 from public.jobs j where j.employer_id = e.id);
  get diagnostics v_purged_employers = row_count;

  return jsonb_build_object(
    'expired_jobs', v_expiry.expired_count,
    'lapsed_features', v_expiry.unfeatured_count,
    'purged_drafts', v_purged_drafts,
    'purged_rate_limit_windows', v_purged_limits,
    'purged_ingestion_runs', v_purged_ingestion,
    'purged_unsubscribed_subscribers', v_purged_subs,
    'purged_digest_deliveries', v_purged_deliv,
    'purged_employer_jobs', v_purged_emp_jobs,
    'purged_employers', v_purged_employers
  );
end;
$$;
