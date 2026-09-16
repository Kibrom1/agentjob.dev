-- Regression tests for gaps found in the 2026-09-16 Data Architect review
-- (docs/reviews/data.md). Runs in a single rolled-back transaction.
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
-- ingestion_runs: RLS enabled but had no test that clients are actually
-- locked out (only the log_ingestion_run() grant was tested).
-- ---------------------------------------------------------------------------
do $$
begin
  perform test_helpers.assert(
    (select relrowsecurity from pg_class where oid = 'public.ingestion_runs'::regclass),
    'RLS enabled on ingestion_runs'
  );
  perform test_helpers.assert(
    not has_table_privilege('anon', 'public.ingestion_runs', 'select')
    and not has_table_privilege('authenticated', 'public.ingestion_runs', 'select'),
    'ingestion_runs has no client-facing SELECT grant'
  );
end;
$$;

set role anon;
do $$
begin
  call test_helpers.expect_error('select * from public.ingestion_runs', '42501');
end;
$$;
reset role;

set role authenticated;
do $$
begin
  call test_helpers.expect_error('select * from public.ingestion_runs', '42501');
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- digest_runs_completion_chk: (status = 'sending') = (completed_at is null)
-- was only exercised indirectly through finish_digest_run(); nothing tested
-- the table constraint itself against a direct write.
-- ---------------------------------------------------------------------------
do $$
begin
  call test_helpers.expect_error(
    $f$insert into public.digest_runs (period_start, status, completed_at) values ('2026-01-05', 'completed', null)$f$,
    '23514');
  call test_helpers.expect_error(
    $f$insert into public.digest_runs (period_start, status, completed_at) values ('2026-01-12', 'sending', now())$f$,
    '23514');
  call test_helpers.expect_error(
    $f$insert into public.digest_runs (period_start, status, completed_at) values ('2026-01-19', 'skipped', null)$f$,
    '23514');

  -- happy path for contrast
  insert into public.digest_runs (period_start, status, completed_at) values ('2026-01-26', 'skipped', now());
  perform test_helpers.assert(
    (select status from public.digest_runs where period_start = '2026-01-26') = 'skipped',
    'valid completed row accepted'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- categories: SELECT is public, but nothing verified that anon still cannot
-- write to the reference table (only INSERT was covered previously).
-- ---------------------------------------------------------------------------
set role anon;
do $$
begin
  call test_helpers.expect_error(
    $f$update public.categories set sort_order = 999 where slug = 'agent-platform'$f$, '42501');
  call test_helpers.expect_error(
    $f$delete from public.categories where slug = 'agent-platform'$f$, '42501');
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- category_slug FK is ON DELETE RESTRICT: a category in use cannot be
-- deleted out from under live jobs. Untested previously.
-- ---------------------------------------------------------------------------
do $$
declare
  v_desc constant text := repeat('A sufficiently long job description for testing. ', 2);
begin
  insert into public.jobs (status, source, title, company, location, workplace_type, category_slug, description, apply_url)
  values ('draft', 'admin', 'Category FK Guard Role', 'Co', 'Remote', 'remote', 'agent-platform', v_desc, 'https://x.test');

  call test_helpers.expect_error(
    $f$delete from public.categories where slug = 'agent-platform'$f$, '23503');
end;
$$;

-- ---------------------------------------------------------------------------
-- jobs_featured_within_window_chk: featured_until must never be past the
-- job's own expires_at (previously held only by convention in
-- activate_paid_job()/admin_update_job()). See migration
-- 20260917000000_jobs_featured_within_window_chk.sql.
-- ---------------------------------------------------------------------------
do $$
declare
  v_desc constant text := repeat('A sufficiently long job description for testing. ', 2);
begin
  call test_helpers.expect_error(
    $f$insert into public.jobs (
      status, source, title, company, location, workplace_type, category_slug,
      description, apply_url, is_featured, expires_at, featured_until
    ) values (
      'active', 'admin', 'Featured Past Expiry Role', 'Co', 'Remote', 'remote', 'agent-platform',
      $desc$A sufficiently long job description for testing. A sufficiently long job description for testing. $desc$,
      'https://x.test', true, now() + interval '1 day', now() + interval '2 days'
    )$f$,
    '23514');

  -- happy path for contrast: featured_until at or before expires_at is fine.
  insert into public.jobs (
    status, source, title, company, location, workplace_type, category_slug,
    description, apply_url, is_featured, expires_at, featured_until
  ) values (
    'active', 'admin', 'Featured Within Window Role', 'Co', 'Remote', 'remote', 'agent-platform',
    v_desc, 'https://x.test', true, now() + interval '2 days', now() + interval '2 days'
  );
  perform test_helpers.assert(
    (select is_featured from public.jobs where title = 'Featured Within Window Role'),
    'valid featured-within-window row accepted'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- search_jobs(p_published_after): pushes the "recent" cutoff into the WHERE
-- clause (before LIMIT) instead of leaving callers to filter client-side
-- after a hard limit. See migration
-- 20260917000100_search_jobs_published_after.sql and
-- architecture-synthesis.md #10.
-- ---------------------------------------------------------------------------
do $$
declare
  v_desc constant text := repeat('A sufficiently long job description for testing. ', 2);
begin
  insert into public.jobs (
    status, source, title, company, location, workplace_type, category_slug,
    description, apply_url, published_at, expires_at
  ) values (
    'active', 'admin', 'Old Published Job', 'Co', 'Remote', 'remote', 'agent-platform',
    v_desc, 'https://x.test', now() - interval '10 days', now() + interval '20 days'
  ), (
    'active', 'admin', 'Recently Published Job', 'Co', 'Remote', 'remote', 'agent-platform',
    v_desc, 'https://x.test', now() - interval '1 hour', now() + interval '29 days'
  );

  -- Defaults (no p_published_after) is unchanged: both rows visible.
  perform test_helpers.assert(
    (select count(*) from public.search_jobs(p_category => 'agent-platform')) = 2,
    'both jobs visible with no published_after cutoff'
  );

  -- With a cutoff, only the job published after it is returned.
  perform test_helpers.assert(
    (select count(*) from public.search_jobs(p_category => 'agent-platform', p_published_after => now() - interval '1 day')) = 1,
    'only the recently published job passes the cutoff'
  );
  perform test_helpers.assert(
    (select title from public.search_jobs(p_category => 'agent-platform', p_published_after => now() - interval '1 day')) = 'Recently Published Job',
    'the surviving row is the recent one, not the old one'
  );

  -- A cutoff before both jobs' published_at still returns both.
  perform test_helpers.assert(
    (select count(*) from public.search_jobs(p_category => 'agent-platform', p_published_after => now() - interval '30 days')) = 2,
    'a cutoff before both jobs still returns both'
  );
end;
$$;

rollback;

\echo 'data architect regression tests passed'
