-- =============================================================================
-- AgentJobs.dev — employer posting, rate limiting, ingestion, weekly digest
--
-- Every function here except unsubscribe_from_digest() is callable only by
-- service_role (the Next.js server and the ingestion runner). Supabase grants
-- EXECUTE on new functions to anon/authenticated by default, so each function
-- is explicitly revoked below.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rate limiting (fixed window, keyed by "<scope>:<sha256(ip)>")
-- -----------------------------------------------------------------------------
create table public.rate_limits (
  key          text not null check (char_length(key) between 1 and 200),
  window_start timestamptz not null,
  hits         integer not null default 0 check (hits >= 0),
  primary key (key, window_start)
);

create index rate_limits_window_start_idx on public.rate_limits (window_start);

create function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits   integer;
begin
  if p_key is null or char_length(p_key) not between 1 and 200 then
    raise exception 'Rate limit key must be 1-200 characters' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 then
    raise exception 'Rate limit must be at least 1' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'Rate limit window must be 1-86400 seconds' using errcode = '22023';
  end if;

  v_window := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- Employer posting
-- -----------------------------------------------------------------------------

-- Creates (or reuses) the employer contact and a draft job in one transaction.
-- An existing employer row is never modified: the email is only a billing
-- contact, and company details live on the job itself.
create function public.create_job_posting(p_employer jsonb, p_job jsonb)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_job_id      uuid;
begin
  if jsonb_typeof(p_employer) is distinct from 'object' or jsonb_typeof(p_job) is distinct from 'object' then
    raise exception 'Employer and job payloads must be JSON objects' using errcode = '22023';
  end if;
  if p_job ? 'tags' and jsonb_typeof(p_job -> 'tags') not in ('array', 'null') then
    raise exception 'tags must be an array' using errcode = '22023';
  end if;

  insert into public.employers (company_name, email, website_url, logo_url)
  values (
    btrim(p_employer ->> 'company_name'),
    lower(btrim(p_employer ->> 'email')),
    nullif(btrim(p_employer ->> 'website_url'), ''),
    nullif(btrim(p_employer ->> 'logo_url'), '')
  )
  on conflict (email) do update set email = excluded.email
  returning id into v_employer_id;

  insert into public.jobs (
    employer_id, status, source, title, company, company_logo_url, company_url,
    location, workplace_type, job_type, category_slug, tags, description,
    apply_url, salary_min, salary_max, salary_currency
  )
  values (
    v_employer_id,
    'draft',
    'employer',
    p_job ->> 'title',
    p_job ->> 'company',
    nullif(btrim(p_job ->> 'company_logo_url'), ''),
    nullif(btrim(p_job ->> 'company_url'), ''),
    p_job ->> 'location',
    (p_job ->> 'workplace_type')::public.workplace_type,
    (p_job ->> 'job_type')::public.job_type,
    p_job ->> 'category_slug',
    coalesce(
      array(select jsonb_array_elements_text(case when jsonb_typeof(p_job -> 'tags') = 'array' then p_job -> 'tags' else '[]'::jsonb end)),
      '{}'
    ),
    p_job ->> 'description',
    btrim(p_job ->> 'apply_url'),
    (p_job ->> 'salary_min')::integer,
    (p_job ->> 'salary_max')::integer,
    coalesce(nullif(p_job ->> 'salary_currency', ''), 'USD')
  )
  returning id into v_job_id;

  return v_job_id;
end;
$$;

-- draft -> pending_payment once a Checkout session exists.
create function public.attach_checkout_session(p_job_id uuid, p_session_id text)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  update public.jobs
     set status = 'pending_payment',
         stripe_checkout_session_id = p_session_id
   where id = p_job_id
     and status = 'draft';

  if not found then
    raise exception 'Job % is not an open draft', p_job_id using errcode = 'P0002';
  end if;
end;
$$;

-- pending_payment -> payment_expired when Stripe expires the session.
create function public.mark_checkout_expired(p_session_id text)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.jobs
     set status = 'payment_expired'
   where stripe_checkout_session_id = p_session_id
     and status = 'pending_payment';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Maintenance (pg_cron every 15 min + Vercel Cron daily as a backstop)
-- -----------------------------------------------------------------------------
create function public.run_maintenance()
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_expiry        record;
  v_purged_drafts integer;
  v_purged_limits integer;
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

  return jsonb_build_object(
    'expired_jobs', v_expiry.expired_count,
    'lapsed_features', v_expiry.unfeatured_count,
    'purged_drafts', v_purged_drafts,
    'purged_rate_limit_windows', v_purged_limits
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Ingestion
--   p_jobs: JSON array of normalised postings (see ingestion/ package).
--   Rows are matched on (source_name, external_id). Admin-rejected rows are
--   never touched. Each row runs in its own subtransaction so a single bad
--   record is reported instead of aborting the batch.
-- -----------------------------------------------------------------------------
create function public.upsert_ingested_jobs(
  p_source_name   text,
  p_jobs          jsonb,
  p_close_missing boolean default false
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_item      jsonb;
  v_ext       text;
  v_ids       text[] := '{}';
  v_inserted  integer := 0;
  v_updated   integer := 0;
  v_skipped   integer := 0;
  v_failed    integer := 0;
  v_closed    integer := 0;
  v_errors    jsonb := '[]'::jsonb;
  v_is_insert boolean;
  v_published timestamptz;
begin
  if p_source_name is null
     or char_length(p_source_name) > 80
     or p_source_name !~ '^[a-z0-9]+:[a-z0-9][a-z0-9._-]*$' then
    raise exception 'source_name must look like "provider:board", got %', p_source_name using errcode = '22023';
  end if;
  if jsonb_typeof(p_jobs) is distinct from 'array' then
    raise exception 'jobs payload must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_jobs) > 2000 then
    raise exception 'at most 2000 jobs per call' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_jobs) loop
    v_ext := nullif(btrim(v_item ->> 'external_id'), '');
    if v_ext is null then
      v_failed := v_failed + 1;
      if jsonb_array_length(v_errors) < 50 then
        v_errors := v_errors || jsonb_build_object('external_id', null, 'code', '22023', 'message', 'missing external_id');
      end if;
      continue;
    end if;
    v_ids := v_ids || v_ext;

    begin
      v_published := least(coalesce((v_item ->> 'published_at')::timestamptz, now()), now());

      insert into public.jobs (
        status, source, source_name, external_id, title, company, company_logo_url,
        company_url, location, workplace_type, job_type, category_slug, tags,
        description, apply_url, salary_min, salary_max, salary_currency,
        published_at, expires_at
      )
      values (
        'active',
        'ingested',
        p_source_name,
        v_ext,
        v_item ->> 'title',
        v_item ->> 'company',
        nullif(v_item ->> 'company_logo_url', ''),
        nullif(v_item ->> 'company_url', ''),
        v_item ->> 'location',
        (v_item ->> 'workplace_type')::public.workplace_type,
        coalesce((v_item ->> 'job_type')::public.job_type, 'full_time'),
        v_item ->> 'category_slug',
        coalesce(array(select jsonb_array_elements_text(coalesce(v_item -> 'tags', '[]'::jsonb))), '{}'),
        v_item ->> 'description',
        v_item ->> 'apply_url',
        (v_item ->> 'salary_min')::integer,
        (v_item ->> 'salary_max')::integer,
        coalesce(nullif(v_item ->> 'salary_currency', ''), 'USD'),
        v_published,
        now() + interval '30 days'
      )
      on conflict (source_name, external_id) where external_id is not null
      do update set
        status           = 'active',
        title            = excluded.title,
        company          = excluded.company,
        company_logo_url = coalesce(excluded.company_logo_url, public.jobs.company_logo_url),
        company_url      = coalesce(excluded.company_url, public.jobs.company_url),
        location         = excluded.location,
        workplace_type   = excluded.workplace_type,
        job_type         = excluded.job_type,
        category_slug    = excluded.category_slug,
        tags             = excluded.tags,
        description      = excluded.description,
        apply_url        = excluded.apply_url,
        salary_min       = excluded.salary_min,
        salary_max       = excluded.salary_max,
        salary_currency  = excluded.salary_currency,
        expires_at       = greatest(public.jobs.expires_at, excluded.expires_at)
      where public.jobs.status in ('active', 'expired')
      returning (xmax = 0) into v_is_insert;

      if not found then
        v_skipped := v_skipped + 1;
      elsif v_is_insert then
        v_inserted := v_inserted + 1;
      else
        v_updated := v_updated + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      if jsonb_array_length(v_errors) < 50 then
        v_errors := v_errors || jsonb_build_object('external_id', v_ext, 'code', sqlstate, 'message', sqlerrm);
      end if;
    end;
  end loop;

  if coalesce(p_close_missing, false) then
    if cardinality(v_ids) = 0 then
      raise exception 'Refusing to close every job for % from an empty feed', p_source_name using errcode = '22023';
    end if;

    update public.jobs
       set status = 'expired',
           is_featured = false
     where source = 'ingested'
       and source_name = p_source_name
       and status = 'active'
       and external_id <> all (v_ids);
    get diagnostics v_closed = row_count;
  end if;

  return jsonb_build_object(
    'source_name', p_source_name,
    'received', jsonb_array_length(p_jobs),
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'failed', v_failed,
    'closed', v_closed,
    'errors', v_errors
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Weekly digest bookkeeping
-- -----------------------------------------------------------------------------
create table public.digest_runs (
  id           uuid primary key default gen_random_uuid(),
  period_start date not null unique,
  status       text not null default 'sending' check (status in ('sending', 'completed', 'skipped')),
  job_count    integer not null default 0 check (job_count >= 0),
  sent_count   integer not null default 0 check (sent_count >= 0),
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  constraint digest_runs_completion_chk check ((status = 'sending') = (completed_at is null))
);

create table public.digest_deliveries (
  run_id              uuid not null references public.digest_runs (id) on delete cascade,
  subscriber_id       uuid not null references public.subscribers (id) on delete cascade,
  provider_message_id text check (char_length(provider_message_id) <= 200),
  sent_at             timestamptz not null default now(),
  primary key (run_id, subscriber_id)
);

create index digest_deliveries_subscriber_idx on public.digest_deliveries (subscriber_id);

-- Returns the run for the period, creating it on first call. Safe to call from
-- concurrent or retried cron invocations.
create function public.begin_digest_run(p_period_start date)
returns public.digest_runs
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_run public.digest_runs;
begin
  if p_period_start is null then
    raise exception 'period_start is required' using errcode = '22023';
  end if;

  insert into public.digest_runs (period_start)
  values (p_period_start)
  on conflict (period_start) do nothing;

  select * into v_run from public.digest_runs where period_start = p_period_start;
  return v_run;
end;
$$;

-- Active subscribers who joined before the run started and have not been
-- sent this run yet. Deterministic order so retried batches are identical.
create function public.next_digest_recipients(p_run_id uuid, p_limit integer default 100)
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
     and s.created_at < r.started_at
     and not exists (
       select 1 from public.digest_deliveries d
        where d.run_id = p_run_id and d.subscriber_id = s.id
     )
   order by s.id
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;

-- p_deliveries: [{ "subscriber_id": uuid, "provider_message_id": text|null }]
create function public.record_digest_deliveries(p_run_id uuid, p_deliveries jsonb)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_deliveries) is distinct from 'array' then
    raise exception 'deliveries must be a JSON array' using errcode = '22023';
  end if;

  insert into public.digest_deliveries (run_id, subscriber_id, provider_message_id)
  select p_run_id, (d ->> 'subscriber_id')::uuid, nullif(d ->> 'provider_message_id', '')
    from jsonb_array_elements(p_deliveries) as d
  on conflict (run_id, subscriber_id) do nothing;
  get diagnostics v_count = row_count;

  update public.digest_runs
     set sent_count = sent_count + v_count
   where id = p_run_id;

  return v_count;
end;
$$;

create function public.finish_digest_run(p_run_id uuid, p_status text, p_job_count integer)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if p_status not in ('completed', 'skipped') then
    raise exception 'finish status must be completed or skipped' using errcode = '22023';
  end if;

  update public.digest_runs
     set status = p_status,
         job_count = coalesce(p_job_count, 0),
         completed_at = now()
   where id = p_run_id
     and status = 'sending';
end;
$$;

-- Anon-callable: the token is an unguessable secret delivered only by email.
create function public.unsubscribe_from_digest(p_token uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_token is null then
    return false;
  end if;

  update public.subscribers
     set unsubscribed_at = coalesce(unsubscribed_at, now())
   where unsubscribe_token = p_token;

  return found;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS and privileges
-- -----------------------------------------------------------------------------
alter table public.rate_limits       enable row level security;
alter table public.digest_runs       enable row level security;
alter table public.digest_deliveries enable row level security;

revoke all on public.rate_limits, public.digest_runs, public.digest_deliveries from anon, authenticated;
grant all on public.rate_limits, public.digest_runs, public.digest_deliveries to service_role;

revoke execute on function
  public.consume_rate_limit(text, integer, integer),
  public.create_job_posting(jsonb, jsonb),
  public.attach_checkout_session(uuid, text),
  public.mark_checkout_expired(text),
  public.run_maintenance(),
  public.upsert_ingested_jobs(text, jsonb, boolean),
  public.begin_digest_run(date),
  public.next_digest_recipients(uuid, integer),
  public.record_digest_deliveries(uuid, jsonb),
  public.finish_digest_run(uuid, text, integer),
  public.unsubscribe_from_digest(uuid)
from public, anon, authenticated;

grant execute on function
  public.consume_rate_limit(text, integer, integer),
  public.create_job_posting(jsonb, jsonb),
  public.attach_checkout_session(uuid, text),
  public.mark_checkout_expired(text),
  public.run_maintenance(),
  public.upsert_ingested_jobs(text, jsonb, boolean),
  public.begin_digest_run(date),
  public.next_digest_recipients(uuid, integer),
  public.record_digest_deliveries(uuid, jsonb),
  public.finish_digest_run(uuid, text, integer),
  public.unsubscribe_from_digest(uuid)
to service_role;

grant execute on function public.unsubscribe_from_digest(uuid) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Replace the expiry-only cron job with the full maintenance routine.
-- -----------------------------------------------------------------------------
do $migration$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron not installed; skipping run_maintenance schedule';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'expire-jobs') then
    perform cron.unschedule('expire-jobs');
  end if;
  if exists (select 1 from cron.job where jobname = 'run-maintenance') then
    perform cron.unschedule('run-maintenance');
  end if;

  perform cron.schedule('run-maintenance', '*/15 * * * *', 'select public.run_maintenance()');
end;
$migration$;
