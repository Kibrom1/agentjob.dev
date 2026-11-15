-- =============================================================================
-- Digest double opt-in
--
--   * New subscribers are "pending" (confirmed_at is null) until they click the
--     link in a confirmation email. Only confirmed, not-unsubscribed rows are
--     returned by next_digest_recipients().
--   * Everyone who subscribed before this migration is grandfathered as
--     confirmed (confirmed_at = created_at) so the existing list keeps working.
--   * request_digest_confirmation() (service_role only) creates/refreshes a
--     pending row and says whether a confirmation email should be sent now. It
--     applies a per-address cooldown and never tells the caller whether the
--     address already existed. The tokens are returned to the server only; the
--     anon-callable subscribe_to_digest() never exposes them.
--   * confirm_digest_subscription() (anon-callable, like unsubscribe) consumes
--     the confirm token.
-- =============================================================================

alter table public.subscribers
  add column confirmed_at          timestamptz,
  add column confirm_token         uuid not null default gen_random_uuid(),
  add column confirmation_sent_at  timestamptz;

alter table public.subscribers
  add constraint subscribers_confirm_token_key unique (confirm_token);

-- Grandfather the existing list.
update public.subscribers set confirmed_at = created_at where confirmed_at is null;

-- Digest fan-out reads only confirmed, active subscribers.
drop index public.subscribers_active_created_idx;
create index subscribers_active_created_idx
  on public.subscribers (created_at)
  where unsubscribed_at is null and confirmed_at is not null;

-- Stale pending rows are found by age.
create index subscribers_pending_created_idx
  on public.subscribers (created_at)
  where confirmed_at is null;

-- -----------------------------------------------------------------------------
-- Direct anon signups are recorded as pending. No email is sent from here and
-- no token is returned, so this path can never confirm anything on its own.
-- -----------------------------------------------------------------------------
create or replace function public.subscribe_to_digest(p_email text, p_source text default 'website')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_source text := coalesce(nullif(btrim(p_source), ''), 'website');
begin
  if not public.is_valid_email(v_email) then
    raise exception 'Invalid email address' using errcode = '22023';
  end if;
  if not public.is_valid_slug(v_source) or char_length(v_source) > 40 then
    raise exception 'Invalid signup source' using errcode = '22023';
  end if;

  insert into public.subscribers (email, source)
  values (v_email, v_source)
  on conflict (email) do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- Signup from the website server action (service_role only).
--   Returns one row. should_send is true only when the row is pending, not
--   unsubscribed, and no confirmation was sent in the last p_cooldown_seconds.
--   Existing confirmed or unsubscribed addresses return should_send = false and
--   are left untouched (an opted-out address is never re-enrolled).
-- -----------------------------------------------------------------------------
create function public.request_digest_confirmation(
  p_email            text,
  p_source           text default 'website',
  p_cooldown_seconds integer default 600
)
returns table (should_send boolean, confirm_token uuid, unsubscribe_token uuid)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_source text := coalesce(nullif(btrim(p_source), ''), 'website');
  v_row    public.subscribers;
begin
  if not public.is_valid_email(v_email) then
    raise exception 'Invalid email address' using errcode = '22023';
  end if;
  if not public.is_valid_slug(v_source) or char_length(v_source) > 40 then
    raise exception 'Invalid signup source' using errcode = '22023';
  end if;

  insert into public.subscribers (email, source)
  values (v_email, v_source)
  on conflict (email) do nothing;

  select * into v_row from public.subscribers as s where s.email = v_email for update;

  if v_row.confirmed_at is not null or v_row.unsubscribed_at is not null then
    return query select false, null::uuid, null::uuid;
    return;
  end if;

  if v_row.confirmation_sent_at is not null
     and v_row.confirmation_sent_at > now() - make_interval(secs => greatest(coalesce(p_cooldown_seconds, 600), 0)) then
    return query select false, null::uuid, null::uuid;
    return;
  end if;

  update public.subscribers set confirmation_sent_at = now() where id = v_row.id;
  return query select true, v_row.confirm_token, v_row.unsubscribe_token;
end;
$$;

-- -----------------------------------------------------------------------------
-- Confirm link target (anon-callable; the unguessable uuid is the credential).
--   True when the token belongs to a subscriber whose address is (now) confirmed.
--   Links expire 7 days after the confirmation email was sent; a fresh email
--   (re-submitting the form) issues a new window. Unsubscribed rows are never
--   confirmed.
-- -----------------------------------------------------------------------------
create function public.confirm_digest_subscription(p_token uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.subscribers;
begin
  if p_token is null then
    return false;
  end if;

  select * into v_row from public.subscribers as s where s.confirm_token = p_token for update;
  if not found or v_row.unsubscribed_at is not null then
    return false;
  end if;
  if v_row.confirmed_at is not null then
    return true;
  end if;
  if v_row.confirmation_sent_at is null or v_row.confirmation_sent_at < now() - interval '7 days' then
    return false;
  end if;

  update public.subscribers set confirmed_at = now() where id = v_row.id;
  return true;
end;
$$;

-- Digest recipients: confirmed + active + joined before the run started.
create or replace function public.next_digest_recipients(p_run_id uuid, p_limit integer default 100)
returns table (subscriber_id uuid, email text, unsubscribe_token uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.email, s.unsubscribe_token
    from public.subscribers as s
    join public.digest_runs as r on r.id = p_run_id
   where s.unsubscribed_at is null
     and s.confirmed_at is not null
     and s.created_at < r.started_at
     and not exists (
       select 1 from public.digest_deliveries d
        where d.run_id = p_run_id and d.subscriber_id = s.id
     )
   order by s.id
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke execute on function
  public.request_digest_confirmation(text, text, integer),
  public.confirm_digest_subscription(uuid)
from public, anon, authenticated;

grant execute on function public.request_digest_confirmation(text, text, integer) to service_role;
grant execute on function public.confirm_digest_subscription(uuid) to anon, authenticated, service_role;
