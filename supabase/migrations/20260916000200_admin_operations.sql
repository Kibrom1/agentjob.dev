-- =============================================================================
-- Admin console operations (service_role only).
-- All lifecycle rules live here so the console cannot put a row into a state
-- the table constraints would reject halfway through a multi-step update.
-- =============================================================================

create function public.admin_update_job(p_job_id uuid, p_action text, p_days integer default 30)
returns public.jobs
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  if p_action not in ('reject', 'restore', 'extend', 'feature', 'unfeature') then
    raise exception 'Unknown admin action %', p_action using errcode = '22023';
  end if;
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'Days must be between 1 and 365' using errcode = '22023';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job % not found', p_job_id using errcode = 'P0002';
  end if;

  case p_action
    when 'reject' then
      update public.jobs
         set status = 'rejected', is_featured = false
       where id = p_job_id
      returning * into v_job;

    when 'restore' then
      if v_job.status not in ('rejected', 'expired') then
        raise exception 'Only rejected or expired jobs can be restored (job is %)', v_job.status using errcode = '22023';
      end if;
      update public.jobs
         set status       = 'active',
             published_at = coalesce(published_at, now()),
             expires_at   = greatest(coalesce(expires_at, now()), now()) + make_interval(days => p_days)
       where id = p_job_id
      returning * into v_job;

    when 'extend' then
      if v_job.status <> 'active' then
        raise exception 'Only active jobs can be extended (job is %)', v_job.status using errcode = '22023';
      end if;
      update public.jobs
         set expires_at     = greatest(expires_at, now()) + make_interval(days => p_days),
             featured_until = case when is_featured then greatest(featured_until, now()) + make_interval(days => p_days) end
       where id = p_job_id
      returning * into v_job;

    when 'feature' then
      if v_job.status <> 'active' then
        raise exception 'Only active jobs can be featured (job is %)', v_job.status using errcode = '22023';
      end if;
      update public.jobs
         set is_featured    = true,
             featured_until = least(expires_at, now() + make_interval(days => p_days))
       where id = p_job_id
      returning * into v_job;

    when 'unfeature' then
      update public.jobs
         set is_featured = false
       where id = p_job_id
      returning * into v_job;
  end case;

  return v_job;
end;
$$;

-- Publishes a curated listing immediately (source = 'admin').
create function public.admin_create_job(p_job jsonb, p_featured boolean default false, p_days integer default 30)
returns public.jobs
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  if jsonb_typeof(p_job) is distinct from 'object' then
    raise exception 'job payload must be a JSON object' using errcode = '22023';
  end if;
  if p_job ? 'tags' and jsonb_typeof(p_job -> 'tags') not in ('array', 'null') then
    raise exception 'tags must be an array' using errcode = '22023';
  end if;
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'Days must be between 1 and 365' using errcode = '22023';
  end if;

  insert into public.jobs (
    status, source, title, company, company_logo_url, company_url, location,
    workplace_type, job_type, category_slug, tags, description, apply_url,
    salary_min, salary_max, salary_currency, published_at, expires_at,
    is_featured, featured_until
  )
  values (
    'active',
    'admin',
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
    coalesce(nullif(p_job ->> 'salary_currency', ''), 'USD'),
    now(),
    now() + make_interval(days => p_days),
    coalesce(p_featured, false),
    case when coalesce(p_featured, false) then now() + make_interval(days => p_days) end
  )
  returning * into v_job;

  return v_job;
end;
$$;

-- Dashboard counters in one round trip.
create function public.admin_stats()
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
    )
  );
$$;

revoke execute on function
  public.admin_update_job(uuid, text, integer),
  public.admin_create_job(jsonb, boolean, integer),
  public.admin_stats()
from public, anon, authenticated;

grant execute on function
  public.admin_update_job(uuid, text, integer),
  public.admin_create_job(jsonb, boolean, integer),
  public.admin_stats()
to service_role;
