-- Contract tests for the ingestion close rails (p_allow_empty, mass-close cap,
-- p_keep_ids), the company blocklist, search_jobs visibility of closed jobs and
-- the retention purges in run_maintenance(). Single rolled-back transaction.
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

-- Postings with external ids 'j<from>'..'j<to>'.
create function test_helpers.batch(p_from integer, p_to integer, p_company text default 'Orbit Labs')
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'external_id', 'j' || g,
    'title', 'Agent Platform Engineer ' || g,
    'company', p_company,
    'location', 'Remote (EU)',
    'workplace_type', 'remote',
    'job_type', 'full_time',
    'category_slug', 'agent-platform',
    'tags', jsonb_build_array('LangGraph'),
    'description', repeat('Design the runtime our agents execute on, end to end. ', 3),
    'apply_url', 'https://orbit.test/careers/' || g
  ) order by g), '[]'::jsonb)
  from generate_series(p_from, p_to) as g;
$$;
grant execute on function test_helpers.batch(integer, integer, text) to anon, authenticated, service_role;

create function test_helpers.job_payload(p_title text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'title', p_title,
    'location', 'Remote (EU)',
    'workplace_type', 'remote',
    'job_type', 'full_time',
    'category_slug', 'agent-platform',
    'tags', jsonb_build_array('LangGraph'),
    'description', repeat('Design the runtime our agents execute on, end to end. ', 3),
    'apply_url', 'https://orbit.test/careers/42',
    'company', 'Orbit Labs'
  );
$$;
grant execute on function test_helpers.job_payload(text) to anon, authenticated, service_role;

create function test_helpers.live(p_source text) returns integer
language sql
as $$ select count(*)::int from public.jobs where source_name = p_source and status = 'active'; $$;
grant execute on function test_helpers.live(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Empty feed, mass-close cap, keep ids
-- ---------------------------------------------------------------------------
set role service_role;
do $$
declare
  v_result jsonb;
begin
  -- Small source (4 live): an empty-but-fetched feed may close everything.
  perform public.upsert_ingested_jobs('greenhouse:small', test_helpers.batch(1, 4));
  perform test_helpers.assert(test_helpers.live('greenhouse:small') = 4, 'seeded 4 live jobs');

  -- Without the flag an empty feed is still refused.
  call test_helpers.expect_error($f$select public.upsert_ingested_jobs('greenhouse:small', '[]', true)$f$, '22023');
  -- p_allow_empty alone is not enough: the feed must have had postings.
  call test_helpers.expect_error($f$select public.upsert_ingested_jobs('greenhouse:small', '[]', true, true)$f$, '22023');
  call test_helpers.expect_error($f$select public.upsert_ingested_jobs('greenhouse:small', '[]', true, true, false, '{}', 0)$f$, '22023');
  perform test_helpers.assert(test_helpers.live('greenhouse:small') = 4, 'refused calls closed nothing');

  v_result := public.upsert_ingested_jobs('greenhouse:small', '[]', true, true, false, '{}', 12);
  perform test_helpers.assert((v_result ->> 'closed')::int = 4, format('empty feed closed the 4 jobs: %s', v_result));
  perform test_helpers.assert(test_helpers.live('greenhouse:small') = 0, 'no live jobs left');

  -- Large source (10 live): closing 10 > max(5, 50%) is refused without force.
  perform public.upsert_ingested_jobs('greenhouse:big', test_helpers.batch(1, 10));
  v_result := public.upsert_ingested_jobs('greenhouse:big', '[]', true, true, false, '{}', 10);
  perform test_helpers.assert(
    (v_result ->> 'closed')::int = 0 and (v_result ->> 'close_skipped')::int = 10,
    format('mass close skipped: %s', v_result)
  );
  perform test_helpers.assert(test_helpers.live('greenhouse:big') = 10, 'rail left all 10 live');

  -- A feed that drops 6 of 10 is skipped; dropping 5 is allowed.
  v_result := public.upsert_ingested_jobs('greenhouse:big', test_helpers.batch(1, 4), true);
  perform test_helpers.assert((v_result ->> 'close_skipped')::int = 6 and (v_result ->> 'closed')::int = 0, format('6 of 10 skipped: %s', v_result));
  v_result := public.upsert_ingested_jobs('greenhouse:big', test_helpers.batch(1, 5), true);
  perform test_helpers.assert((v_result ->> 'closed')::int = 5 and (v_result ->> 'close_skipped')::int = 0, format('5 closures allowed: %s', v_result));
  perform test_helpers.assert(test_helpers.live('greenhouse:big') = 5, '5 left live');

  -- Keep ids: an unknown (normalizer-rejected) posting is not closed.
  v_result := public.upsert_ingested_jobs('greenhouse:big', test_helpers.batch(1, 3), true, false, false, array['j4'], 0);
  perform test_helpers.assert((v_result ->> 'closed')::int = 1, format('only j5 closed, j4 kept: %s', v_result));
  perform test_helpers.assert(
    (select status::text from public.jobs where source_name = 'greenhouse:big' and external_id = 'j4') = 'active',
    'kept id stays active'
  );

  -- Force bypasses the rail.
  perform public.upsert_ingested_jobs('greenhouse:big', test_helpers.batch(1, 10));
  v_result := public.upsert_ingested_jobs('greenhouse:big', '[]', true, true, true, '{}', 10);
  perform test_helpers.assert((v_result ->> 'closed')::int = 10 and test_helpers.live('greenhouse:big') = 0, format('force closes: %s', v_result));
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- search_jobs hides closed jobs and shows live ones
-- ---------------------------------------------------------------------------
set role service_role;
do $$
begin
  perform public.upsert_ingested_jobs('greenhouse:vis', test_helpers.batch(1, 3, 'Visible Co'));
  perform public.upsert_ingested_jobs('greenhouse:vis', '[]', true, true, false, '{}', 3);
  perform public.upsert_ingested_jobs('greenhouse:vis2', test_helpers.batch(1, 2, 'Stays Co'));
end;
$$;
reset role;

set role anon;
do $$
begin
  perform test_helpers.assert(
    (select count(*) from public.search_jobs(p_query => 'Platform')) = 2,
    'closed (empty-feed) jobs vanish from search_jobs; live ones remain'
  );
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Company blocklist
-- ---------------------------------------------------------------------------
set role service_role;
do $$
declare
  v_result jsonb;
begin
  perform public.upsert_ingested_jobs('lever:takedown', test_helpers.batch(1, 2, 'Removed Inc'));
  perform test_helpers.assert(public.block_company('  Removed INC ', 'takedown request') = 2, 'block_company rejects live listings');
  perform test_helpers.assert(test_helpers.live('lever:takedown') = 0, 'blocked listings are not live');

  v_result := public.upsert_ingested_jobs('lever:takedown', test_helpers.batch(1, 2, 'Removed Inc') || test_helpers.batch(3, 3, 'Fine Co'));
  perform test_helpers.assert((v_result ->> 'blocked')::int = 2 and (v_result ->> 'inserted')::int = 1, format('blocked company skipped: %s', v_result));
  perform test_helpers.assert(
    not exists (select 1 from public.jobs where lower(company) = 'removed inc' and status = 'active'),
    'blocked company is not re-ingested'
  );
  perform test_helpers.assert(public.unblock_company('removed inc'), 'unblock removes the row');
end;
$$;
reset role;

do $$
begin
  perform test_helpers.assert(
    not has_table_privilege('anon', 'public.company_blocklist', 'select')
    and not has_function_privilege('anon', 'public.block_company(text, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.unblock_company(text)', 'execute')
    and has_function_privilege('service_role', 'public.block_company(text, text)', 'execute'),
    'blocklist is service_role only'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention purges
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_new    uuid;
  v_run    uuid;
  v_emp    uuid;
begin
  insert into public.subscribers (email, unsubscribed_at) values ('gone@x.test', now() - interval '91 days');
  insert into public.subscribers (email, unsubscribed_at) values ('recent@x.test', now() - interval '10 days');
  insert into public.subscribers (email) values ('active@x.test');
  select id into v_new from public.subscribers where email = 'active@x.test';

  insert into public.digest_runs (period_start) values (current_date) returning id into v_run;
  insert into public.digest_deliveries (run_id, subscriber_id, sent_at) values (v_run, v_new, now() - interval '13 months');
  insert into public.digest_runs (period_start) values (current_date - 7) returning id into v_run;
  insert into public.digest_deliveries (run_id, subscriber_id, sent_at) values (v_run, v_new, now());

  -- Old expired employer job (and its employer) vs a recent one.
  v_emp := public.create_job_posting('{"company_name":"Old Co","email":"old@x.test"}', test_helpers.job_payload('Old Employer Role'));
  perform public.create_job_posting('{"company_name":"New Co","email":"new@x.test"}', test_helpers.job_payload('New Employer Role'));
  update public.jobs set status = 'expired', published_at = now() - interval '30 months',
         expires_at = now() - interval '25 months', created_at = now() - interval '30 months'
   where id = v_emp;
  update public.employers set created_at = now() - interval '30 months' where email = 'old@x.test';

  set local role service_role;
  v_result := public.run_maintenance();
  reset role;

  perform test_helpers.assert((v_result ->> 'purged_unsubscribed_subscribers')::int = 1, format('one unsubscribed subscriber purged: %s', v_result));
  perform test_helpers.assert(
    exists (select 1 from public.subscribers where email = 'recent@x.test')
    and exists (select 1 from public.subscribers where email = 'active@x.test')
    and not exists (select 1 from public.subscribers where email = 'gone@x.test'),
    'only the long-unsubscribed subscriber is gone'
  );
  perform test_helpers.assert((v_result ->> 'purged_digest_deliveries')::int = 1, 'one old delivery purged');
  perform test_helpers.assert((select count(*) from public.digest_deliveries) = 1, 'recent delivery kept');
  perform test_helpers.assert((v_result ->> 'purged_employer_jobs')::int = 1, 'old employer job purged');
  perform test_helpers.assert((v_result ->> 'purged_employers')::int = 1, 'orphaned old employer purged');
  perform test_helpers.assert(
    exists (select 1 from public.employers where email = 'new@x.test')
    and not exists (select 1 from public.employers where email = 'old@x.test'),
    'recent employer kept'
  );
end;
$$;

rollback;

\echo 'close safety + retention tests passed'
