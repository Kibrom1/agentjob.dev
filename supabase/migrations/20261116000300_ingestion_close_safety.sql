-- =============================================================================
-- Ingestion close safety (launch review P1-1, P1-3, P1-4) + company blocklist.
--
--   p_allow_empty   lets a run close every live job of a source whose feed was
--                   fetched (p_fetched_count > 0) but contained no relevant
--                   postings. Without it an empty p_jobs with close_missing
--                   still raises 22023, so a failed/empty fetch closes nothing.
--   p_force_close   bypasses the mass-close rail. Without it, a run that would
--                   close more than max(5, 50% of the source's live jobs) closes
--                   nothing and reports 'close_skipped' (also a log warning).
--   p_keep_ids      external ids that must not be closed even though they are
--                   absent from p_jobs (postings the normalizer rejected).
--   company_blocklist rows are skipped and reported as 'blocked'.
--
-- Signature change, so the old 3-arg overload is dropped and grants re-issued
-- (as in 20260917000100). Old callers sending three named args still resolve.
-- =============================================================================

-- New ingestion_runs status for the mass-close rail.
alter table public.ingestion_runs drop constraint ingestion_runs_status_check;
alter table public.ingestion_runs add constraint ingestion_runs_status_check
  check (status in ('ok', 'not_found', 'fetch_failed', 'db_failed', 'dry_run', 'no_relevant_jobs', 'close_skipped'));

drop function if exists public.upsert_ingested_jobs(text, jsonb, boolean);

create function public.upsert_ingested_jobs(
  p_source_name   text,
  p_jobs          jsonb,
  p_close_missing boolean default false,
  p_allow_empty   boolean default false,
  p_force_close   boolean default false,
  p_keep_ids      text[] default '{}',
  p_fetched_count integer default 0
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
  v_blocked   integer := 0;
  v_keep      text[];
  v_would_close integer := 0;
  v_active    integer := 0;
  v_close_skipped integer := 0;
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
    -- Takedown: companies on the blocklist are never (re-)ingested.
    if exists (
      select 1 from public.company_blocklist b
       where b.company_key = lower(btrim(v_item ->> 'company'))
    ) then
      v_blocked := v_blocked + 1;
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
    -- An empty keep-set closes every live job for the source. That is only
    -- legitimate when the caller explicitly says the feed was fetched (it had
    -- postings) but none of them is relevant any more: p_allow_empty plus a
    -- positive p_fetched_count. A failed or genuinely empty fetch never closes.
    if cardinality(v_ids) = 0 and v_blocked = 0 then
      if not coalesce(p_allow_empty, false) then
        raise exception 'Refusing to close every job for % from an empty feed', p_source_name using errcode = '22023';
      end if;
      if coalesce(p_fetched_count, 0) <= 0 then
        raise exception 'p_allow_empty requires p_fetched_count > 0 for %', p_source_name using errcode = '22023';
      end if;
    end if;

    -- Ids the caller could not process this run (e.g. the normalizer rejected a
    -- posting that is still listed upstream) are "unknown", not "gone".
    v_keep := v_ids || coalesce(p_keep_ids, '{}');

    select count(*) filter (where external_id <> all (v_keep)), count(*)
      into v_would_close, v_active
      from public.jobs
     where source = 'ingested'
       and source_name = p_source_name
       and status = 'active';

    -- Mass-close rail: closing more than max(5, 50% of the source's live jobs)
    -- in one run is treated as a probable truncated/glitched feed and skipped
    -- unless the caller passes p_force_close. Reported as close_skipped.
    if v_would_close > greatest(5, v_active / 2) and not coalesce(p_force_close, false) then
      v_close_skipped := v_would_close;
      raise warning 'close skipped for %: would close % of % live jobs (limit max(5, 50%%)); pass p_force_close to override',
        p_source_name, v_would_close, v_active;
    elsif v_would_close > 0 then
      update public.jobs
         set status = 'expired',
             is_featured = false
       where source = 'ingested'
         and source_name = p_source_name
         and status = 'active'
         and external_id <> all (v_keep);
      get diagnostics v_closed = row_count;
    end if;
  end if;

  return jsonb_build_object(
    'source_name', p_source_name,
    'received', jsonb_array_length(p_jobs),
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'failed', v_failed,
    'closed', v_closed,
    'close_skipped', v_close_skipped,
    'blocked', v_blocked,
    'errors', v_errors
  );
end;
$$;

revoke execute on function public.upsert_ingested_jobs(text, jsonb, boolean, boolean, boolean, text[], integer)
  from public, anon, authenticated;
grant execute on function public.upsert_ingested_jobs(text, jsonb, boolean, boolean, boolean, text[], integer)
  to service_role;
