-- =============================================================================
-- Ops Agent: ingestion observability log + admin_stats extensions.
--
-- The ingestion script has always reported results to its own stdout/CI logs
-- only; there was no durable, queryable record of "did the last run of each
-- source succeed, and when." This adds that log, so the admin console and
-- the `/api/ops/report` endpoint can flag a source that has gone quiet or
-- started failing without anyone having to read GitHub Actions logs.
-- =============================================================================

create table public.ingestion_runs (
  id            uuid primary key default gen_random_uuid(),
  source_name   text not null,
  status        text not null check (status in ('ok', 'not_found', 'fetch_failed', 'db_failed', 'dry_run', 'no_relevant_jobs')),
  fetched       integer not null default 0 check (fetched >= 0),
  relevant      integer not null default 0 check (relevant >= 0),
  inserted      integer not null default 0 check (inserted >= 0),
  updated       integer not null default 0 check (updated >= 0),
  skipped       integer not null default 0 check (skipped >= 0),
  failed        integer not null default 0 check (failed >= 0),
  closed        integer not null default 0 check (closed >= 0),
  error         text,
  started_at    timestamp with time zone not null,
  finished_at   timestamp with time zone not null default timezone('utc'::text, now())
);

create index ingestion_runs_source_finished_idx on public.ingestion_runs (source_name, finished_at desc);

comment on table public.ingestion_runs is
  'One row per ingestion pipeline run (one row per source per invocation). Written by log_ingestion_run, read by admin_stats() and the ops report route.';

alter table public.ingestion_runs enable row level security;
-- No policies: anon/authenticated get nothing; service_role bypasses RLS.

create function public.log_ingestion_run(
  p_source_name text,
  p_status      text,
  p_fetched     integer,
  p_relevant    integer,
  p_inserted    integer,
  p_updated     integer,
  p_skipped     integer,
  p_failed      integer,
  p_closed      integer,
  p_error       text,
  p_started_at  timestamp with time zone,
  p_finished_at timestamp with time zone
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_source_name is null or btrim(p_source_name) = '' then
    raise exception 'source_name is required' using errcode = '22023';
  end if;
  if p_started_at is null or p_finished_at is null or p_finished_at < p_started_at then
    raise exception 'started_at/finished_at must be set and finished_at >= started_at' using errcode = '22023';
  end if;

  insert into public.ingestion_runs (
    source_name, status, fetched, relevant, inserted, updated, skipped, failed, closed, error, started_at, finished_at
  )
  values (
    btrim(p_source_name), p_status,
    coalesce(p_fetched, 0), coalesce(p_relevant, 0), coalesce(p_inserted, 0), coalesce(p_updated, 0),
    coalesce(p_skipped, 0), coalesce(p_failed, 0), coalesce(p_closed, 0),
    p_error, p_started_at, p_finished_at
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.log_ingestion_run(text, text, integer, integer, integer, integer, integer, integer, integer, text, timestamptz, timestamptz)
  from public, anon, authenticated;

grant execute on function public.log_ingestion_run(text, text, integer, integer, integer, integer, integer, integer, integer, text, timestamptz, timestamptz)
  to service_role;

-- Purge old ingestion run history alongside the rest of the daily sweep.
-- CREATE OR REPLACE keeps the existing grants (same signature), so no
-- revoke/grant lines are needed here.
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

  return jsonb_build_object(
    'expired_jobs', v_expiry.expired_count,
    'lapsed_features', v_expiry.unfeatured_count,
    'purged_drafts', v_purged_drafts,
    'purged_rate_limit_windows', v_purged_limits,
    'purged_ingestion_runs', v_purged_ingestion
  );
end;
$$;

-- Dashboard counters: add the latest run per ingestion source, so a stale
-- or failing source is visible without querying ingestion_runs directly.
create or replace function public.admin_stats()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'jobs_by_status', coalesce((
      select jsonb_object_agg(status, total)
        from (select status::text as status, count(*) as total from public.jobs group by status) s
    ), '{}'::jsonb),
    'live_jobs', (select count(*) from public.jobs where status = 'active' and expires_at > now()),
    'featured_live', (select count(*) from public.jobs where status = 'active' and expires_at > now() and is_featured and featured_until > now()),
    'jobs_by_source', coalesce((
      select jsonb_object_agg(source, total)
        from (select source::text as source, count(*) as total from public.jobs
               where status = 'active' and expires_at > now() group by source) s
    ), '{}'::jsonb),
    'subscribers_active', (select count(*) from public.subscribers where unsubscribed_at is null),
    'subscribers_total', (select count(*) from public.subscribers),
    'paid_last_30d', (select count(*) from public.jobs
                        where source = 'employer' and stripe_checkout_session_id is not null
                          and published_at > now() - interval '30 days'),
    'last_digest', (
      select to_jsonb(r) from (
        select period_start, status, job_count, sent_count, started_at, completed_at
          from public.digest_runs order by period_start desc limit 1
      ) r
    ),
    'ingestion_last_runs', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.source_name) from (
        select distinct on (source_name)
               source_name, status, fetched, relevant, inserted, updated, skipped, failed, closed, error, started_at, finished_at
          from public.ingestion_runs
         order by source_name, finished_at desc
      ) r
    ), '[]'::jsonb)
  );
$$;
