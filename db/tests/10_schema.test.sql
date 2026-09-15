-- Schema contract tests. Run via scripts/test-db.sh.
-- Everything executes inside one transaction that is rolled back at the end,
-- so the file is safe to run repeatedly against the same database.
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

-- ---------------------------------------------------------------------------
-- Fixtures (as table owner)
-- ---------------------------------------------------------------------------
do $$
declare
  v_desc constant text := repeat('Build production multi-agent systems with LangGraph and tool calling. ', 3);
begin
  perform test_helpers.assert((select count(*) from public.categories) = 7, 'seven seeded categories');

  -- privilege catalogue: privileged RPCs are not even executable by clients
  perform test_helpers.assert(
    not has_function_privilege('anon', 'public.activate_paid_job(text, boolean, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.activate_paid_job(text, boolean, integer)', 'execute')
    and not has_function_privilege('anon', 'public.expire_jobs()', 'execute')
    and not has_function_privilege('authenticated', 'public.expire_jobs()', 'execute'),
    'privileged RPCs not executable by anon/authenticated'
  );
  perform test_helpers.assert(
    has_function_privilege('service_role', 'public.activate_paid_job(text, boolean, integer)', 'execute')
    and has_function_privilege('anon', 'public.search_jobs(text, text, public.workplace_type, text, integer, integer)', 'execute')
    and has_function_privilege('anon', 'public.subscribe_to_digest(text, text)', 'execute'),
    'public RPCs executable'
  );
  perform test_helpers.assert(
    not has_table_privilege('authenticated', 'public.employers', 'select')
    and not has_table_privilege('authenticated', 'public.subscribers', 'insert')
    and not has_column_privilege('authenticated', 'public.jobs', 'stripe_checkout_session_id', 'select'),
    'authenticated role is as restricted as anon'
  );
  perform test_helpers.assert(
    (select bool_and(relrowsecurity) from pg_class
      where oid in ('public.jobs'::regclass, 'public.employers'::regclass,
                    'public.subscribers'::regclass, 'public.categories'::regclass)),
    'RLS enabled on every table'
  );

  insert into public.employers (id, company_name, email)
  values ('00000000-0000-0000-0000-00000000e001', 'Acme Agents', 'hiring@acme-agents.test');

  -- Paid posting awaiting webhook
  insert into public.jobs (id, employer_id, status, title, company, location, workplace_type,
                           category_slug, tags, description, apply_url, salary_min, salary_max,
                           stripe_checkout_session_id)
  values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001',
          'pending_payment', '  Senior Agent Orchestration Engineer  ', 'Acme Agents',
          'San Francisco, CA', 'hybrid', 'agent-orchestration', array['LangGraph', 'Python', 'C++'],
          v_desc, 'https://acme-agents.test/jobs/1', 180000, 240000, 'cs_test_paid_001');

  -- Ingested, already live, not featured, remote
  insert into public.jobs (id, status, source, source_name, external_id, title, company, location,
                           workplace_type, category_slug, tags, description, apply_url,
                           published_at, expires_at)
  values ('00000000-0000-0000-0000-0000000000a2', 'active', 'ingested', 'greenhouse:beta', 'gh-42',
          'Local LLM Inference Engineer', 'Beta Labs', 'Remote (US)', 'remote', 'local-llm-infra',
          array['vLLM', 'CUDA'], repeat('Serve quantised open-weight models on our GPU fleet. ', 3),
          'mailto:jobs@beta.test', now() - interval '1 day', now() + interval '29 days');

  -- Active but past expiry (sweep has not run): must be invisible anyway
  insert into public.jobs (id, status, source, title, company, location, workplace_type,
                           category_slug, description, apply_url, published_at, expires_at)
  values ('00000000-0000-0000-0000-0000000000a3', 'active', 'admin', 'Expired Agent Role',
          'Gamma AI', 'Berlin', 'onsite', 'multi-agent-systems',
          repeat('This listing ran out and should never be shown publicly. ', 2),
          'https://gamma.test/apply', now() - interval '40 days', now() - interval '10 days');
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers and normalisation
-- ---------------------------------------------------------------------------
do $$
declare
  v_job public.jobs;
  v_before timestamptz;
begin
  select * into v_job from public.jobs where id = '00000000-0000-0000-0000-0000000000a1';
  perform test_helpers.assert(v_job.title = 'Senior Agent Orchestration Engineer', 'title trimmed');
  perform test_helpers.assert(
    v_job.slug = 'senior-agent-orchestration-engineer-at-acme-agents-00000000',
    format('auto slug generated, got %s', v_job.slug)
  );

  insert into public.jobs (id, status, source, title, company, location, workplace_type,
                           category_slug, description, apply_url)
  values ('00000000-0000-0000-0000-0000000000a4', 'draft', 'admin', 'エージェント開発者', '株式会社',
          'Tokyo', 'onsite', 'agent-platform', repeat('日本語の求人票です。', 10), 'https://jp.test');
  perform test_helpers.assert(
    (select slug from public.jobs where id = '00000000-0000-0000-0000-0000000000a4') = 'job-00000000',
    'non-latin title and company fall back to "job" + id fragment'
  );

  -- updated_at is always set by the trigger, never trusted from the client
  update public.jobs set updated_at = now() - interval '1 hour' where id = '00000000-0000-0000-0000-0000000000a2';
  select updated_at into v_before from public.jobs where id = '00000000-0000-0000-0000-0000000000a2';
  perform test_helpers.assert(v_before = now(), 'trigger overrides manual updated_at');

  -- featured_until is cleared when a job is un-featured
  update public.jobs set is_featured = true, featured_until = now() + interval '1 day'
   where id = '00000000-0000-0000-0000-0000000000a4';
  update public.jobs set is_featured = false where id = '00000000-0000-0000-0000-0000000000a4';
  perform test_helpers.assert(
    (select featured_until is null from public.jobs where id = '00000000-0000-0000-0000-0000000000a4'),
    'featured_until cleared on unfeature'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------
do $$
declare
  v_base constant text :=
    'insert into public.jobs (status, source, title, company, location, workplace_type, category_slug, tags, description, apply_url, salary_min, salary_max, published_at, expires_at, is_featured, employer_id, source_name, external_id) values ';
  v_desc constant text := quote_literal(repeat('A sufficiently long job description for testing. ', 2));
begin
  -- happy path through the same template
  execute v_base || format($f$('draft','admin','Valid Role','Co','Remote','remote','tool-use-backends','{MCP,"Tool Use",Node.js,C#}',%s,'https://x.test',null,null,null,null,false,null,null,null)$f$, v_desc);

  call test_helpers.expect_error(v_base || format($f$('draft','admin','Valid Role','Co','Remote','remote','tool-use-backends','{}',%s,'https://x.test',200,100,null,null,false,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','admin','Valid Role','Co','Remote','remote','tool-use-backends','{}',%s,'https://x.test',-1,null,null,null,false,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('active','admin','Valid Role','Co','Remote','remote','tool-use-backends','{}',%s,'https://x.test',null,null,null,null,false,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('active','admin','Valid Role','Co','Remote','remote','tool-use-backends','{}',%s,'https://x.test',null,null,now(),now() - interval '1 day',false,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','admin','Valid Role','Co','Remote','remote','tool-use-backends','{}',%s,'javascript:alert(1)',null,null,null,null,false,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','admin','Valid Role','Co','Remote','remote','tool-use-backends','{}',%s,'https://x.test/a b',null,null,null,null,false,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','admin','Valid Role','Co','Remote','remote','tool-use-backends','{LangGraph,langgraph}',%s,'https://x.test',null,null,null,null,false,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','admin','Valid Role','Co','Remote','remote','tool-use-backends','{Python,NULL}',%s,'https://x.test',null,null,null,null,false,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','admin','Valid Role','Co','Remote','remote','tool-use-backends','{"Python "}',%s,'https://x.test',null,null,null,null,false,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','admin','Valid Role','Co','Remote','remote','tool-use-backends','{a,b,c,d,e,f,g,h,i,j,k,l,m}',%s,'https://x.test',null,null,null,null,false,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','admin','Valid Role','Co','Remote','remote','tool-use-backends','{{a},{b}}',%s,'https://x.test',null,null,null,null,false,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','admin','  ab  ','Co','Remote','remote','tool-use-backends','{}',%s,'https://x.test',null,null,null,null,false,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || $f$('draft','admin','Valid Role','Co','Remote','remote','tool-use-backends','{}','too short','https://x.test',null,null,null,null,false,null,null,null)$f$, '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','admin','Valid Role','Co','Remote','remote','no-such-category','{}',%s,'https://x.test',null,null,null,null,false,null,null,null)$f$, v_desc), '23503');
  call test_helpers.expect_error(v_base || format($f$('draft','employer','Valid Role','Co','Remote','remote','tool-use-backends','{}',%s,'https://x.test',null,null,null,null,false,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','ingested','Valid Role','Co','Remote','remote','tool-use-backends','{}',%s,'https://x.test',null,null,null,null,false,null,'greenhouse:beta',null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','admin','Valid Role','Co','Remote','remote','tool-use-backends','{}',%s,'https://x.test',null,null,null,null,false,null,null,'orphan-id')$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','ingested','Valid Role','Co','Remote','remote','tool-use-backends','{}',%s,'https://x.test',null,null,null,null,false,null,'greenhouse:beta','gh-42')$f$, v_desc), '23505');
  call test_helpers.expect_error(v_base || format($f$('draft','admin','Valid Role','Co','Remote','remote','tool-use-backends','{}',%s,'https://x.test',null,null,null,null,true,null,null,null)$f$, v_desc), '23514');
  call test_helpers.expect_error(v_base || format($f$('draft','admin','Valid Role','Co','Remote','hybrid-ish','tool-use-backends','{}',%s,'https://x.test',null,null,null,null,false,null,null,null)$f$, v_desc), '22P02');

  -- pending_payment requires a checkout session
  call test_helpers.expect_error(
    format($f$insert into public.jobs (status, source, title, company, location, workplace_type, category_slug, description, apply_url) values ('pending_payment','admin','Valid Role','Co','Remote','remote','tool-use-backends',%s,'https://x.test')$f$, v_desc),
    '23514');

  -- explicit slugs are validated and unique
  call test_helpers.expect_error(
    format($f$insert into public.jobs (slug, status, source, title, company, location, workplace_type, category_slug, description, apply_url) values ('Bad Slug!','draft','admin','Valid Role','Co','Remote','remote','tool-use-backends',%s,'https://x.test')$f$, v_desc),
    '23514');
  call test_helpers.expect_error(
    format($f$insert into public.jobs (slug, status, source, title, company, location, workplace_type, category_slug, description, apply_url) values ('senior-agent-orchestration-engineer-at-acme-agents-00000000','draft','admin','Valid Role','Co','Remote','remote','tool-use-backends',%s,'https://x.test')$f$, v_desc),
    '23505');

  -- employers
  call test_helpers.expect_error($f$insert into public.employers (company_name, email) values ('X', 'Upper@Case.test')$f$, '23514');
  call test_helpers.expect_error($f$insert into public.employers (company_name, email) values ('X', 'not-an-email')$f$, '23514');
  call test_helpers.expect_error($f$insert into public.employers (company_name, email) values ('X', 'hiring@acme-agents.test')$f$, '23505');
  call test_helpers.expect_error($f$insert into public.employers (company_name, email, logo_url) values ('X', 'y@z.test', 'http://insecure.test/logo.png')$f$, '23514');
  call test_helpers.expect_error($f$insert into public.employers (company_name, email) values ('   ', 'y@z.test')$f$, '23514');

  -- deleting an employer with jobs is blocked
  call test_helpers.expect_error($f$delete from public.employers where id = '00000000-0000-0000-0000-00000000e001'$f$, '23503');
end;
$$;

-- ---------------------------------------------------------------------------
-- Anonymous visitor: visibility, column privileges, write protection
-- ---------------------------------------------------------------------------
set role anon;

do $$
begin
  perform test_helpers.assert((select count(*) from public.categories) = 7, 'anon reads categories');
  perform test_helpers.assert(
    (select count(*) from (select id from public.jobs) s) = 1,
    'anon sees only the single live, unexpired job before payment webhook'
  );
  call test_helpers.expect_error('select * from public.jobs', '42501');
  call test_helpers.expect_error('select stripe_checkout_session_id from public.jobs', '42501');
  call test_helpers.expect_error('select employer_id from public.jobs', '42501');
  call test_helpers.expect_error('select external_id from public.jobs', '42501');
  call test_helpers.expect_error('select id from public.employers', '42501');
  call test_helpers.expect_error('select id from public.subscribers', '42501');
  call test_helpers.expect_error($f$update public.jobs set title = 'pwned'$f$, '42501');
  call test_helpers.expect_error($f$delete from public.jobs$f$, '42501');
  call test_helpers.expect_error($f$insert into public.categories (slug, name, description) values ('x-y', 'XY', 'A description here')$f$, '42501');
  call test_helpers.expect_error($f$select public.activate_paid_job('cs_test_paid_001', true)$f$, '42501');
  call test_helpers.expect_error($f$select public.expire_jobs()$f$, '42501');

  -- newsletter RPC
  perform public.subscribe_to_digest('  Dev@Example.TEST ');
  perform public.subscribe_to_digest('dev@example.test', 'job-page');
  call test_helpers.expect_error($f$select public.subscribe_to_digest('nope')$f$, '22023');
  call test_helpers.expect_error($f$select public.subscribe_to_digest(null)$f$, '22023');
  call test_helpers.expect_error($f$select public.subscribe_to_digest('a@b.test', 'Bad Source')$f$, '22023');
end;
$$;

reset role;

do $$
begin
  perform test_helpers.assert(
    (select count(*) from public.subscribers where email = 'dev@example.test') = 1,
    'duplicate signup (case-insensitive) stored once'
  );
  perform test_helpers.assert(
    (select source from public.subscribers where email = 'dev@example.test') = 'website',
    'first signup source is preserved'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Payment webhook path (service_role)
-- ---------------------------------------------------------------------------
set role service_role;

do $$
declare
  v_job public.jobs;
begin
  v_job := public.activate_paid_job('cs_test_paid_001', true);
  perform test_helpers.assert(v_job.status = 'active', 'job activated');
  perform test_helpers.assert(v_job.is_featured and v_job.featured_until = v_job.expires_at, 'featured window matches listing');
  perform test_helpers.assert(v_job.expires_at = v_job.published_at + interval '30 days', '30-day listing');

  -- redelivered webhook with different flag must not downgrade
  v_job := public.activate_paid_job('cs_test_paid_001', false);
  perform test_helpers.assert(v_job.status = 'active' and v_job.is_featured, 'activation is idempotent');

  call test_helpers.expect_error($f$select public.activate_paid_job('cs_missing', false)$f$, 'P0002');
  call test_helpers.expect_error($f$select public.activate_paid_job('', false)$f$, '22023');
  call test_helpers.expect_error($f$select public.activate_paid_job('cs_test_paid_001', false, 0)$f$, '22023');
  call test_helpers.expect_error($f$select public.activate_paid_job('cs_test_paid_001', false, 91)$f$, '22023');
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Search RPC as anon
-- ---------------------------------------------------------------------------
set role anon;

do $$
declare
  v_first record;
begin
  perform test_helpers.assert((select count(*) from public.search_jobs()) = 2, 'two live jobs');

  select * into v_first from public.search_jobs() limit 1;
  perform test_helpers.assert(v_first.id = '00000000-0000-0000-0000-0000000000a1', 'featured job pinned first');
  perform test_helpers.assert(v_first.is_featured, 'featured flag surfaced');
  perform test_helpers.assert(v_first.total_count = 2, 'total_count reflects full result set');

  perform test_helpers.assert(
    (select array_agg(id) from public.search_jobs(p_query => 'langgraph')) = array['00000000-0000-0000-0000-0000000000a1'::uuid],
    'tag text is searchable'
  );
  perform test_helpers.assert(
    (select array_agg(id) from public.search_jobs(p_query => 'quantised GPU')) = array['00000000-0000-0000-0000-0000000000a2'::uuid],
    'description is searchable'
  );
  perform test_helpers.assert((select count(*) from public.search_jobs(p_query => 'Expired')) = 0, 'expired job never matches');
  perform test_helpers.assert((select count(*) from public.search_jobs(p_query => 'the and of')) = 2, 'stop-word query ignored');
  perform test_helpers.assert((select count(*) from public.search_jobs(p_query => '   ')) = 2, 'blank query ignored');
  perform test_helpers.assert((select count(*) from public.search_jobs(p_query => '"unterminated -')) >= 0, 'malformed websearch syntax tolerated');
  perform test_helpers.assert((select count(*) from public.search_jobs(p_query => 'zzzqqq')) = 0, 'no false positives');
  perform test_helpers.assert((select count(*) from public.search_jobs(p_category => 'local-llm-infra')) = 1, 'category filter');
  perform test_helpers.assert((select count(*) from public.search_jobs(p_category => 'does-not-exist')) = 0, 'unknown category yields nothing');
  perform test_helpers.assert((select count(*) from public.search_jobs(p_workplace => 'remote')) = 1, 'workplace filter');
  perform test_helpers.assert((select count(*) from public.search_jobs(p_tag => 'CUDA')) = 1, 'tag filter');
  perform test_helpers.assert((select count(*) from public.search_jobs(p_limit => 0)) = 1, 'limit clamped to >= 1');
  perform test_helpers.assert((select count(*) from public.search_jobs(p_limit => -5, p_offset => -5)) = 1, 'negative paging clamped');
  perform test_helpers.assert((select count(*) from public.search_jobs(p_offset => 1)) = 1, 'offset pages');
  perform test_helpers.assert((select count(*) from public.search_jobs(p_limit => null, p_offset => null)) = 2, 'null paging uses defaults');
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Expiry sweep
-- ---------------------------------------------------------------------------
set role service_role;

do $$
declare
  v_result record;
begin
  update public.jobs set featured_until = now() - interval '1 minute'
   where id = '00000000-0000-0000-0000-0000000000a1';

  select * into v_result from public.expire_jobs();
  perform test_helpers.assert(v_result.expired_count = 1, format('one job expired, got %s', v_result.expired_count));
  perform test_helpers.assert(v_result.unfeatured_count = 1, format('one pin lapsed, got %s', v_result.unfeatured_count));
  perform test_helpers.assert(
    (select status from public.jobs where id = '00000000-0000-0000-0000-0000000000a3') = 'expired',
    'expired status written'
  );
end;
$$;

reset role;

-- Lapsed pin is no longer sorted first even before the sweep would run
set role anon;
do $$
begin
  perform test_helpers.assert(
    (select bool_and(not is_featured) from public.search_jobs()),
    'no job reported as featured after pin lapsed'
  );
end;
$$;
reset role;

rollback;

\echo 'schema tests passed'
