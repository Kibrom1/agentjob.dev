-- Contract tests for admin console RPCs. Runs in a single rolled-back transaction.
\set ON_ERROR_STOP on
\set QUIET on

begin;

create schema test_helpers;
grant usage on schema test_helpers to anon, authenticated, service_role;

create procedure test_helpers.expect_error(p_sql text, p_sqlstate text)
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_sqlstate then
      raise exception 'expected SQLSTATE %, got % (%) for: %', p_sqlstate, sqlstate, sqlerrm, p_sql;
    end if;
    return;
  end;
  raise exception 'expected SQLSTATE % but statement succeeded: %', p_sqlstate, p_sql;
end;
$$;

create function test_helpers.assert(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'assertion failed: %', p_message;
  end if;
end;
$$;

grant execute on procedure test_helpers.expect_error(text, text) to anon, authenticated, service_role;
grant execute on function test_helpers.assert(boolean, text) to anon, authenticated, service_role;

create function test_helpers.job_payload(p_title text default 'Staff Agent Platform Engineer')
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'title', p_title,
    'company', 'Orbit Labs',
    'company_logo_url', 'https://orbit.test/logo.png',
    'company_url', 'https://orbit.test',
    'location', 'Remote (EU)',
    'workplace_type', 'remote',
    'job_type', 'full_time',
    'category_slug', 'agent-platform',
    'tags', jsonb_build_array('LangGraph', 'TypeScript'),
    'description', repeat('Design the runtime our agents execute on, end to end. ', 3),
    'apply_url', 'https://orbit.test/careers/42',
    'salary_min', 150000,
    'salary_max', 190000,
    'salary_currency', 'EUR'
  );
$$;
grant execute on function test_helpers.job_payload(text) to anon, authenticated, service_role;

do $$
declare
  v_job public.jobs;
  v_id  uuid;
  v_before timestamptz;
  v_stats jsonb;
begin
  perform test_helpers.assert(
    not has_function_privilege('anon', 'public.admin_update_job(uuid, text, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.admin_create_job(jsonb, boolean, integer)', 'execute')
    and not has_function_privilege('anon', 'public.admin_stats()', 'execute')
    and has_function_privilege('service_role', 'public.admin_stats()', 'execute'),
    'admin RPCs are service_role only'
  );

  set local role service_role;

  -- Create: live immediately, optional feature
  v_job := public.admin_create_job(test_helpers.job_payload('Curated Agent Role'), true, 14);
  v_id := v_job.id;
  perform test_helpers.assert(v_job.status = 'active' and v_job.source = 'admin', 'admin job is live');
  perform test_helpers.assert(v_job.is_featured and v_job.featured_until = v_job.expires_at, 'featured for the listing window');
  perform test_helpers.assert(v_job.expires_at = v_job.published_at + interval '14 days', 'custom duration');

  call test_helpers.expect_error($f$select public.admin_create_job('[]')$f$, '22023');
  call test_helpers.expect_error($f$select public.admin_create_job(test_helpers.job_payload(), false, 0)$f$, '22023');
  call test_helpers.expect_error($f$select public.admin_create_job(test_helpers.job_payload() || '{"description":"short"}')$f$, '23514');
  call test_helpers.expect_error($f$select public.admin_create_job(test_helpers.job_payload() || '{"category_slug":"nope"}')$f$, '23503');

  -- Unfeature / feature
  v_job := public.admin_update_job(v_id, 'unfeature');
  perform test_helpers.assert(not v_job.is_featured and v_job.featured_until is null, 'unfeatured');
  v_job := public.admin_update_job(v_id, 'feature', 7);
  perform test_helpers.assert(v_job.is_featured and v_job.featured_until = now() + interval '7 days', 'featured for 7 days');
  v_job := public.admin_update_job(v_id, 'feature', 90);
  perform test_helpers.assert(v_job.featured_until = v_job.expires_at, 'feature window capped at listing expiry');

  -- Extend moves both windows
  v_before := v_job.expires_at;
  v_job := public.admin_update_job(v_id, 'extend', 10);
  perform test_helpers.assert(v_job.expires_at = v_before + interval '10 days', 'expiry extended');
  perform test_helpers.assert(v_job.featured_until = v_before + interval '10 days', 'feature window extended too');

  -- Reject hides and unfeatures; restore brings it back with a fresh window
  v_job := public.admin_update_job(v_id, 'reject');
  perform test_helpers.assert(v_job.status = 'rejected' and not v_job.is_featured, 'rejected');
  call test_helpers.expect_error(format($f$select public.admin_update_job(%L, 'extend')$f$, v_id), '22023');
  call test_helpers.expect_error(format($f$select public.admin_update_job(%L, 'feature')$f$, v_id), '22023');
  v_job := public.admin_update_job(v_id, 'restore', 5);
  perform test_helpers.assert(v_job.status = 'active' and v_job.expires_at > now(), 'restored');
  call test_helpers.expect_error(format($f$select public.admin_update_job(%L, 'restore')$f$, v_id), '22023');

  -- Restoring a job that expired long ago gives it a window from now
  reset role;
  update public.jobs set status = 'expired', published_at = now() - interval '60 days', expires_at = now() - interval '30 days' where id = v_id;
  set local role service_role;
  v_job := public.admin_update_job(v_id, 'restore', 30);
  perform test_helpers.assert(v_job.expires_at = now() + interval '30 days', 'restore window starts now');

  -- Input validation
  call test_helpers.expect_error(format($f$select public.admin_update_job(%L, 'delete')$f$, v_id), '22023');
  call test_helpers.expect_error(format($f$select public.admin_update_job(%L, 'extend', 0)$f$, v_id), '22023');
  call test_helpers.expect_error($f$select public.admin_update_job(gen_random_uuid(), 'reject')$f$, 'P0002');

  -- Stats
  v_stats := public.admin_stats();
  perform test_helpers.assert((v_stats ->> 'live_jobs')::int >= 1, format('live jobs counted: %s', v_stats));
  perform test_helpers.assert((v_stats -> 'jobs_by_status' ->> 'active')::int >= 1, 'status breakdown');
  perform test_helpers.assert((v_stats -> 'jobs_by_source' ->> 'admin')::int >= 1, 'source breakdown');
  perform test_helpers.assert(v_stats ? 'subscribers_active' and v_stats ? 'last_digest' and v_stats ? 'paid_last_30d', 'all counters present');

  reset role;
end;
$$;

rollback;

\echo 'admin tests passed'
