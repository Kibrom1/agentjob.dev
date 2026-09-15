-- Contract tests for posting, rate limiting, ingestion, digest and
-- unsubscribe RPCs. Runs in a single rolled-back transaction.
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

-- ---------------------------------------------------------------------------
-- Privileges: clients can reach none of the operational RPCs or tables
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.consume_rate_limit(text, integer, integer)',
    'public.create_job_posting(jsonb, jsonb)',
    'public.attach_checkout_session(uuid, text)',
    'public.mark_checkout_expired(text)',
    'public.run_maintenance()',
    'public.upsert_ingested_jobs(text, jsonb, boolean)',
    'public.begin_digest_run(date)',
    'public.next_digest_recipients(uuid, integer)',
    'public.record_digest_deliveries(uuid, jsonb)',
    'public.finish_digest_run(uuid, text, integer)'
  ] loop
    perform test_helpers.assert(
      not has_function_privilege('anon', v_fn, 'execute')
      and not has_function_privilege('authenticated', v_fn, 'execute')
      and has_function_privilege('service_role', v_fn, 'execute'),
      format('%s is service_role only', v_fn)
    );
  end loop;

  perform test_helpers.assert(
    has_function_privilege('anon', 'public.unsubscribe_from_digest(uuid)', 'execute'),
    'anon can unsubscribe with a token'
  );
  perform test_helpers.assert(
    not has_table_privilege('anon', 'public.rate_limits', 'select')
    and not has_table_privilege('anon', 'public.digest_runs', 'select')
    and not has_table_privilege('authenticated', 'public.digest_deliveries', 'insert'),
    'operational tables are private'
  );
  perform test_helpers.assert(
    (select bool_and(relrowsecurity) from pg_class
      where oid in ('public.rate_limits'::regclass, 'public.digest_runs'::regclass, 'public.digest_deliveries'::regclass)),
    'RLS enabled on operational tables'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------
set role service_role;
do $$
begin
  perform test_helpers.assert(public.consume_rate_limit('post:abc', 2, 3600), 'hit 1 allowed');
  perform test_helpers.assert(public.consume_rate_limit('post:abc', 2, 3600), 'hit 2 allowed');
  perform test_helpers.assert(not public.consume_rate_limit('post:abc', 2, 3600), 'hit 3 blocked');
  perform test_helpers.assert(public.consume_rate_limit('post:other', 2, 3600), 'keys are independent');
  call test_helpers.expect_error($f$select public.consume_rate_limit('', 1, 60)$f$, '22023');
  call test_helpers.expect_error($f$select public.consume_rate_limit('k', 0, 60)$f$, '22023');
  call test_helpers.expect_error($f$select public.consume_rate_limit('k', 1, 0)$f$, '22023');
  call test_helpers.expect_error($f$select public.consume_rate_limit('k', 1, 86401)$f$, '22023');
end;
$$;
reset role;

set role anon;
do $$
begin
  call test_helpers.expect_error($f$select public.consume_rate_limit('x', 1, 60)$f$, '42501');
  call test_helpers.expect_error($f$select public.create_job_posting('{}', '{}')$f$, '42501');
  call test_helpers.expect_error($f$select public.upsert_ingested_jobs('greenhouse:x', '[]')$f$, '42501');
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Employer posting lifecycle
-- ---------------------------------------------------------------------------
set role service_role;
do $$
declare
  v_job_id  uuid;
  v_job2_id uuid;
  v_job     public.jobs;
  v_active  public.jobs;
begin
  v_job_id := public.create_job_posting(
    jsonb_build_object('company_name', 'Orbit Labs', 'email', '  Founder@Orbit.TEST ', 'website_url', 'https://orbit.test'),
    test_helpers.job_payload()
  );

  select * into v_job from public.jobs where id = v_job_id;
  perform test_helpers.assert(v_job.status = 'draft' and v_job.source = 'employer', 'draft employer job created');
  perform test_helpers.assert(v_job.tags = array['LangGraph', 'TypeScript'], 'tags copied from JSON');
  perform test_helpers.assert(v_job.salary_currency = 'EUR', 'currency copied');
  perform test_helpers.assert(
    (select email from public.employers where id = v_job.employer_id) = 'founder@orbit.test',
    'employer email normalised'
  );

  -- Same employer email: reuse row, never overwrite its details
  v_job2_id := public.create_job_posting(
    jsonb_build_object('company_name', 'Hijacked Name', 'email', 'founder@orbit.test'),
    test_helpers.job_payload('Senior Evals Engineer')
  );
  perform test_helpers.assert(
    (select count(*) from public.employers where email = 'founder@orbit.test') = 1
    and (select company_name from public.employers where email = 'founder@orbit.test') = 'Orbit Labs',
    'existing employer reused and unchanged'
  );
  perform test_helpers.assert(
    (select employer_id from public.jobs where id = v_job2_id) = v_job.employer_id,
    'second job linked to same employer'
  );

  -- Invalid payloads are rejected by the table constraints / casts
  call test_helpers.expect_error(
    $f$select public.create_job_posting('{"company_name":"X","email":"bad"}', test_helpers.job_payload())$f$, '23514');
  call test_helpers.expect_error(
    $f$select public.create_job_posting('{"company_name":"X","email":"a@b.test"}', test_helpers.job_payload() || '{"workplace_type":"moon"}')$f$, '22P02');
  call test_helpers.expect_error(
    $f$select public.create_job_posting('{"company_name":"X","email":"a@b.test"}', test_helpers.job_payload() || '{"apply_url":"javascript:alert(1)"}')$f$, '23514');
  call test_helpers.expect_error(
    $f$select public.create_job_posting('{"company_name":"X","email":"a@b.test"}', test_helpers.job_payload() || '{"tags":"LangGraph"}')$f$, '22023');
  call test_helpers.expect_error(
    $f$select public.create_job_posting('[]', test_helpers.job_payload())$f$, '22023');
  call test_helpers.expect_error(
    $f$select public.create_job_posting('{"company_name":"X","email":"a@b.test"}', test_helpers.job_payload() || '{"salary_min":"lots"}')$f$, '22P02');
  call test_helpers.expect_error(
    $f$select public.create_job_posting('{"company_name":"X","email":"a@b.test"}', test_helpers.job_payload() || '{"salary_currency":"eur"}')$f$, '23514');

  -- Checkout attach: only drafts, only once
  perform public.attach_checkout_session(v_job_id, 'cs_test_orbit_1');
  perform test_helpers.assert(
    (select status from public.jobs where id = v_job_id) = 'pending_payment',
    'draft moved to pending_payment'
  );
  call test_helpers.expect_error(
    format($f$select public.attach_checkout_session(%L, 'cs_test_orbit_again')$f$, v_job_id), 'P0002');
  call test_helpers.expect_error(
    $f$select public.attach_checkout_session(gen_random_uuid(), 'cs_test_nope')$f$, 'P0002');
  call test_helpers.expect_error(
    format($f$select public.attach_checkout_session(%L, 'not-a-session')$f$, v_job2_id), '23514');

  -- Payment succeeds
  v_active := public.activate_paid_job('cs_test_orbit_1', false);
  perform test_helpers.assert(v_active.status = 'active' and not v_active.is_featured, 'paid job live');

  -- Expired session only affects pending jobs
  perform test_helpers.assert(public.mark_checkout_expired('cs_test_orbit_1') = 0, 'active job not expired by stale session event');
  perform public.attach_checkout_session(v_job2_id, 'cs_test_orbit_2');
  perform test_helpers.assert(public.mark_checkout_expired('cs_test_orbit_2') = 1, 'pending job marked payment_expired');
  perform test_helpers.assert(
    (select status from public.jobs where id = v_job2_id) = 'payment_expired',
    'payment_expired stored'
  );
  perform test_helpers.assert(public.mark_checkout_expired('cs_test_orbit_2') = 0, 'expiry idempotent');

  -- An expired session can no longer be activated into a live job
  v_active := public.activate_paid_job('cs_test_orbit_2', true);
  perform test_helpers.assert(v_active.status = 'payment_expired', 'activation does not resurrect expired checkout');
end;
$$;
reset role;

-- payment_expired jobs are never public
set role anon;
do $$
begin
  perform test_helpers.assert(
    (select count(*) from public.search_jobs(p_query => 'evals')) = 0,
    'payment_expired job hidden'
  );
  perform test_helpers.assert(
    (select count(*) from public.search_jobs(p_query => 'runtime')) = 1,
    'paid job visible'
  );
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Maintenance
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
  v_stale  uuid;
  v_fresh  uuid;
begin
  v_stale := public.create_job_posting('{"company_name":"Stale","email":"stale@x.test"}', test_helpers.job_payload('Stale Draft Role'));
  v_fresh := public.create_job_posting('{"company_name":"Fresh","email":"fresh@x.test"}', test_helpers.job_payload('Fresh Draft Role'));
  update public.jobs set created_at = now() - interval '3 days' where id = v_stale;
  insert into public.rate_limits (key, window_start, hits) values ('old:key', now() - interval '2 days', 5);

  set local role service_role;
  v_result := public.run_maintenance();
  reset role;

  perform test_helpers.assert((v_result ->> 'purged_drafts')::int = 1, format('one stale draft purged: %s', v_result));
  perform test_helpers.assert((v_result ->> 'purged_rate_limit_windows')::int = 1, 'old rate-limit window purged');
  perform test_helpers.assert(v_result ? 'expired_jobs' and v_result ? 'lapsed_features', 'expiry counts reported');
  perform test_helpers.assert(not exists (select 1 from public.jobs where id = v_stale), 'stale draft gone');
  perform test_helpers.assert(exists (select 1 from public.jobs where id = v_fresh), 'fresh draft kept');
end;
$$;

-- ---------------------------------------------------------------------------
-- Ingestion
-- ---------------------------------------------------------------------------
set role service_role;
do $$
declare
  v_batch  jsonb;
  v_result jsonb;
begin
  v_batch := jsonb_build_array(
    test_helpers.job_payload('Agent Infrastructure Engineer') || '{"external_id":"101","published_at":"2026-09-01T10:00:00Z","company_logo_url":null}',
    test_helpers.job_payload('LLM Tooling Engineer') || '{"external_id":"102","published_at":"2999-01-01T00:00:00Z"}',
    test_helpers.job_payload('Bad Row') || '{"external_id":"103","description":"too short"}',
    test_helpers.job_payload('No Id Row')
  );

  v_result := public.upsert_ingested_jobs('greenhouse:orbit', v_batch);
  perform test_helpers.assert((v_result ->> 'inserted')::int = 2, format('two inserted: %s', v_result));
  perform test_helpers.assert((v_result ->> 'failed')::int = 2, 'bad row and missing id reported');
  perform test_helpers.assert(jsonb_array_length(v_result -> 'errors') = 2, 'errors listed');
  perform test_helpers.assert(
    (v_result -> 'errors' -> 0 ->> 'code') = '23514' and (v_result -> 'errors' -> 0 ->> 'external_id') = '103'
    and (v_result -> 'errors' -> 1 ->> 'code') = '22023',
    format('error codes surfaced: %s', v_result -> 'errors')
  );
  perform test_helpers.assert(
    (select published_at from public.jobs where source_name = 'greenhouse:orbit' and external_id = '101') = '2026-09-01T10:00:00Z',
    'source publish date kept'
  );
  perform test_helpers.assert(
    (select published_at <= now() from public.jobs where source_name = 'greenhouse:orbit' and external_id = '102'),
    'future publish date clamped to now'
  );
  perform test_helpers.assert(
    (select bool_and(status = 'active' and source = 'ingested' and expires_at > now() + interval '29 days')
       from public.jobs where source_name = 'greenhouse:orbit'),
    'ingested rows live for 30 days'
  );

  -- Re-run: updates in place, closes missing, keeps logo when feed omits it
  update public.jobs set company_logo_url = 'https://orbit.test/admin-logo.png'
   where source_name = 'greenhouse:orbit' and external_id = '101';
  update public.jobs set expires_at = now() + interval '1 day'
   where source_name = 'greenhouse:orbit' and external_id = '101';

  v_result := public.upsert_ingested_jobs(
    'greenhouse:orbit',
    jsonb_build_array(test_helpers.job_payload('Agent Infrastructure Engineer II') || '{"external_id":"101","company_logo_url":null}'),
    true
  );
  perform test_helpers.assert(
    (v_result ->> 'updated')::int = 1 and (v_result ->> 'inserted')::int = 0 and (v_result ->> 'closed')::int = 1,
    format('update + close counts: %s', v_result)
  );
  perform test_helpers.assert(
    (select title from public.jobs where source_name = 'greenhouse:orbit' and external_id = '101') = 'Agent Infrastructure Engineer II',
    'title updated'
  );
  perform test_helpers.assert(
    (select company_logo_url from public.jobs where source_name = 'greenhouse:orbit' and external_id = '101') = 'https://orbit.test/admin-logo.png',
    'existing logo preserved when feed has none'
  );
  perform test_helpers.assert(
    (select expires_at > now() + interval '29 days' from public.jobs where source_name = 'greenhouse:orbit' and external_id = '101'),
    'still-listed job has its expiry extended'
  );
  perform test_helpers.assert(
    (select status from public.jobs where source_name = 'greenhouse:orbit' and external_id = '102') = 'expired',
    'job missing from feed closed'
  );

  -- Reappearing job is reactivated; admin-rejected job is left alone
  update public.jobs set status = 'rejected' where source_name = 'greenhouse:orbit' and external_id = '101';
  v_result := public.upsert_ingested_jobs(
    'greenhouse:orbit',
    jsonb_build_array(
      test_helpers.job_payload('Agent Infrastructure Engineer III') || '{"external_id":"101"}',
      test_helpers.job_payload('LLM Tooling Engineer') || '{"external_id":"102"}'
    )
  );
  perform test_helpers.assert(
    (v_result ->> 'skipped')::int = 1 and (v_result ->> 'updated')::int = 1,
    format('rejected skipped, expired reactivated: %s', v_result)
  );
  perform test_helpers.assert(
    (select status from public.jobs where source_name = 'greenhouse:orbit' and external_id = '101') = 'rejected'
    and (select title from public.jobs where source_name = 'greenhouse:orbit' and external_id = '101') = 'Agent Infrastructure Engineer II',
    'rejected row untouched'
  );
  perform test_helpers.assert(
    (select status from public.jobs where source_name = 'greenhouse:orbit' and external_id = '102') = 'active',
    'expired row reactivated'
  );

  -- Other sources are never closed by this source's run
  perform public.upsert_ingested_jobs('lever:other', jsonb_build_array(test_helpers.job_payload('Other Source Agent Role') || '{"external_id":"x1"}'));
  perform public.upsert_ingested_jobs('greenhouse:orbit', jsonb_build_array(test_helpers.job_payload('LLM Tooling Engineer') || '{"external_id":"102"}'), true);
  perform test_helpers.assert(
    (select status from public.jobs where source_name = 'lever:other') = 'active',
    'close_missing scoped to its own source'
  );

  -- Safety rails
  call test_helpers.expect_error($f$select public.upsert_ingested_jobs('greenhouse:orbit', '[]', true)$f$, '22023');
  call test_helpers.expect_error($f$select public.upsert_ingested_jobs('Greenhouse Orbit', '[]')$f$, '22023');
  call test_helpers.expect_error($f$select public.upsert_ingested_jobs('greenhouse:orbit', '{}')$f$, '22023');
  call test_helpers.expect_error($f$select public.upsert_ingested_jobs(null, '[]')$f$, '22023');
  perform test_helpers.assert(
    (public.upsert_ingested_jobs('greenhouse:orbit', '[]') ->> 'received')::int = 0,
    'empty batch without close is a no-op'
  );
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Digest runs
-- ---------------------------------------------------------------------------
do $$
declare
  v_run      public.digest_runs;
  v_again    public.digest_runs;
  v_batch    jsonb;
  v_ids      uuid[];
  v_recorded integer;
begin
  insert into public.subscribers (email, created_at) values
    ('a@digest.test', now() - interval '2 days'),
    ('b@digest.test', now() - interval '2 days'),
    ('c@digest.test', now() - interval '2 days');
  insert into public.subscribers (email, created_at, unsubscribed_at) values
    ('gone@digest.test', now() - interval '2 days', now() - interval '1 day');

  set local role service_role;

  -- started_at is set to the transaction timestamp; move it forward so the
  -- fixture subscribers (created "2 days ago") are eligible, and a
  -- subscriber created "now" is not.
  v_run := public.begin_digest_run('2026-09-14');
  perform test_helpers.assert(v_run.status = 'sending' and v_run.sent_count = 0, 'run started');
  v_again := public.begin_digest_run('2026-09-14');
  perform test_helpers.assert(v_again.id = v_run.id, 'begin is idempotent per period');

  reset role;
  update public.digest_runs set started_at = now() - interval '1 day' where id = v_run.id;
  insert into public.subscribers (email, created_at) values ('late@digest.test', now());
  set local role service_role;

  perform test_helpers.assert(
    (select count(*) from public.next_digest_recipients(v_run.id, 100)) = 3,
    'only active subscribers who joined before the run'
  );

  select array_agg(subscriber_id) into v_ids from public.next_digest_recipients(v_run.id, 2);
  perform test_helpers.assert(cardinality(v_ids) = 2, 'batch limit respected');

  v_batch := (select jsonb_agg(jsonb_build_object('subscriber_id', id, 'provider_message_id', 'msg_' || id)) from unnest(v_ids) as id);
  v_recorded := public.record_digest_deliveries(v_run.id, v_batch);
  perform test_helpers.assert(v_recorded = 2, 'two deliveries recorded');
  v_recorded := public.record_digest_deliveries(v_run.id, v_batch);
  perform test_helpers.assert(v_recorded = 0, 'duplicate recording ignored');

  perform test_helpers.assert(
    (select count(*) from public.next_digest_recipients(v_run.id, 100)) = 1,
    'resume returns only unsent recipients'
  );
  perform test_helpers.assert(
    (select sent_count from public.digest_runs where id = v_run.id) = 2,
    'sent_count tracks unique deliveries'
  );

  perform public.finish_digest_run(v_run.id, 'completed', 5);
  perform test_helpers.assert(
    (select status = 'completed' and completed_at is not null and job_count = 5 from public.digest_runs where id = v_run.id),
    'run completed'
  );
  perform public.finish_digest_run(v_run.id, 'skipped', 0);
  perform test_helpers.assert(
    (select status from public.digest_runs where id = v_run.id) = 'completed',
    'finished run is immutable'
  );
  call test_helpers.expect_error(format($f$select public.finish_digest_run(%L, 'sending', 0)$f$, v_run.id), '22023');
  call test_helpers.expect_error($f$select public.begin_digest_run(null)$f$, '22023');
  call test_helpers.expect_error($f$select public.record_digest_deliveries(gen_random_uuid(), '{}')$f$, '22023');
  call test_helpers.expect_error(
    $f$select public.record_digest_deliveries(gen_random_uuid(), '[{"subscriber_id":"00000000-0000-0000-0000-000000000000"}]')$f$,
    '23503');

  reset role;
end;
$$;

-- ---------------------------------------------------------------------------
-- Unsubscribe (anon, token-based)
-- ---------------------------------------------------------------------------
select unsubscribe_token as token from public.subscribers where email = 'a@digest.test' \gset
set test.token = :'token';
set role anon;
do $$
begin
  perform test_helpers.assert(public.unsubscribe_from_digest(current_setting('test.token')::uuid), 'valid token unsubscribes');
  perform test_helpers.assert(public.unsubscribe_from_digest(current_setting('test.token')::uuid), 'repeat unsubscribe still succeeds');
  perform test_helpers.assert(not public.unsubscribe_from_digest(gen_random_uuid()), 'unknown token reports false');
  perform test_helpers.assert(not public.unsubscribe_from_digest(null), 'null token reports false');
  call test_helpers.expect_error($f$select public.unsubscribe_from_digest('not-a-uuid')$f$, '22P02');
end;
$$;
reset role;

do $$
begin
  perform test_helpers.assert(
    (select unsubscribed_at is not null from public.subscribers where email = 'a@digest.test'),
    'unsubscribed_at stored'
  );
end;
$$;

rollback;

\echo 'operations tests passed'
