-- WP-10: revive a checkout that Stripe later reports as paid.
--
-- Edge case: checkout.session.expired flips a job pending_payment ->
-- payment_expired (mark_checkout_expired). If payment for that same session
-- then settles late (async payment methods), the employer has paid but the job
-- stayed unpublished. activate_paid_job() now also accepts payment_expired.
--
-- Signature is unchanged (text, boolean, integer) so this is an additive
-- `create or replace`; grants are preserved. Only the WHERE clause changes.
-- The RPC is service_role-only and the application calls it solely after
-- verifying the Stripe session is paid for the expected plan, amount and
-- currency (src/lib/stripe/fulfillment.ts). draft, rejected, expired and
-- active rows are still untouched (active stays idempotent).

create or replace function public.activate_paid_job(
  p_stripe_session_id text,
  p_featured          boolean,
  p_duration_days     integer default 30
)
returns public.jobs
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  if p_stripe_session_id is null or p_stripe_session_id = '' then
    raise exception 'Stripe session id is required' using errcode = '22023';
  end if;
  if p_duration_days is null or p_duration_days not between 1 and 90 then
    raise exception 'Listing duration must be between 1 and 90 days' using errcode = '22023';
  end if;

  update public.jobs
     set status         = 'active',
         published_at   = now(),
         expires_at     = now() + make_interval(days => p_duration_days),
         is_featured    = coalesce(p_featured, false),
         featured_until = case when coalesce(p_featured, false)
                               then now() + make_interval(days => p_duration_days)
                          end
   where stripe_checkout_session_id = p_stripe_session_id
     and status in ('pending_payment', 'payment_expired')
  returning * into v_job;

  if not found then
    select * into v_job
      from public.jobs
     where stripe_checkout_session_id = p_stripe_session_id;

    if not found then
      raise exception 'No job found for checkout session %', p_stripe_session_id using errcode = 'P0002';
    end if;
  end if;

  return v_job;
end;
$$;
