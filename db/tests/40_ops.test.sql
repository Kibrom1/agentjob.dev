-- Contract tests for ingestion observability (log_ingestion_run,
-- admin_stats().ingestion_last_runs, run_maintenance() purge).
-- Runs in a single rolled-back transaction.
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

do $$
declare
  v_id      uuid;
  v_stats   jsonb;
  v_runs    jsonb;
  v_result  jsonb;
begin
  perform test_helpers.assert(
    not has_function_privilege('anon', 'public.log_ingestion_run(text, text, integer, integer, integer, integer, integer, integer, integer, text, timestamptz, timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.log_ingestion_run(text, text, integer, integer, integer, integer, integer, integer, integer, text, timestamptz, timestamptz)', 'execute')
    and has_function_privilege('service_role', 'public.log_ingestion_run(text, text, integer, integer, integer, integer, integer, integer, integer, text, timestamptz, timestamptz)', 'execute'),
    'log_ingestion_run is service_role only'
  );

  set local role service_role;

  -- Input validation
  call test_helpers.expect_error(
    $f$select public.log_ingestion_run('', 'ok', 0,0,0,0,0,0,0, null, now(), now())$f$, '22023');
  call test_helpers.expect_error(
    $f$select public.log_ingestion_run('greenhouse:acme', 'ok', 0,0,0,0,0,0,0, null, now(), now() - interval '1 minute')$f$, '22023');
  call test_helpers.expect_error(
    $f$select public.log_ingestion_run('greenhouse:acme', 'bogus_status', 0,0,0,0,0,0,0, null, now(), now())$f$, '23514');

  -- A stale, then a fresh run for the same source: admin_stats surfaces only the latest.
  v_id := public.log_ingestion_run('greenhouse:acme', 'ok', 10, 2, 1, 1, 0, 0, 0, null, now() - interval '2 days', now() - interval '2 days' + interval '30 seconds');
  perform test_helpers.assert(v_id is not null, 'log_ingestion_run returns the new row id');
  perform public.log_ingestion_run('greenhouse:acme', 'fetch_failed', 0, 0, 0, 0, 0, 0, 0, 'connection reset', now(), now());
  perform public.log_ingestion_run('lever:beta', 'ok', 5, 1, 1, 0, 0, 0, 0, null, now(), now());

  v_stats := public.admin_stats();
  v_runs := v_stats -> 'ingestion_last_runs';
  perform test_helpers.assert(jsonb_array_length(v_runs) = 2, format('one row per source, latest only: %s', v_runs));

  select r into v_result from jsonb_array_elements(v_runs) r where r ->> 'source_name' = 'greenhouse:acme';
  perform test_helpers.assert(v_result ->> 'status' = 'fetch_failed', 'the most recent run wins, not the first');
  perform test_helpers.assert(v_result ->> 'error' = 'connection reset', 'error message carried through');

  -- run_maintenance purges old ingestion_runs but keeps recent ones.
  update public.ingestion_runs set finished_at = now() - interval '100 days' where source_name = 'lever:beta';
  v_result := public.run_maintenance();
  perform test_helpers.assert((v_result ->> 'purged_ingestion_runs')::int = 1, format('purges rows older than 90 days: %s', v_result));
  perform test_helpers.assert(
    (select count(*) from public.ingestion_runs) = 2,
    'the two remaining (fresh) greenhouse runs survive the purge'
  );

  reset role;
end;
$$;

rollback;

\echo 'ops observability tests passed'
