-- Digest double opt-in and employer waitlist. Runs in a single rolled-back
-- transaction.
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
-- Privileges
-- ---------------------------------------------------------------------------
do $$
begin
  perform test_helpers.assert(
    not has_function_privilege('anon', 'public.request_digest_confirmation(text, text, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.request_digest_confirmation(text, text, integer)', 'execute')
    and has_function_privilege('service_role', 'public.request_digest_confirmation(text, text, integer)', 'execute'),
    'request_digest_confirmation is service_role only (it returns tokens)'
  );
  perform test_helpers.assert(
    has_function_privilege('anon', 'public.confirm_digest_subscription(uuid)', 'execute'),
    'anon can confirm with a token'
  );
  perform test_helpers.assert(
    not has_table_privilege('anon', 'public.employer_waitlist', 'select')
    and not has_table_privilege('anon', 'public.employer_waitlist', 'insert')
    and not has_table_privilege('authenticated', 'public.employer_waitlist', 'select')
    and not has_table_privilege('authenticated', 'public.employer_waitlist', 'insert')
    and has_table_privilege('service_role', 'public.employer_waitlist', 'insert'),
    'employer_waitlist is service_role only'
  );
  perform test_helpers.assert(
    (select relrowsecurity from pg_class where oid = 'public.employer_waitlist'::regclass),
    'RLS enabled on employer_waitlist'
  );
end;
$$;

set role anon;
do $$
begin
  call test_helpers.expect_error('select * from public.employer_waitlist', '42501');
  call test_helpers.expect_error($f$insert into public.employer_waitlist (email, company) values ('a@b.test', 'Acme')$f$, '42501');
  call test_helpers.expect_error($f$select * from public.request_digest_confirmation('a@b.test')$f$, '42501');
end;
$$;
reset role;

set role authenticated;
do $$
begin
  call test_helpers.expect_error('select * from public.employer_waitlist', '42501');
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Signup -> pending -> confirm
-- ---------------------------------------------------------------------------
set role service_role;
do $$
declare
  v_first  record;
  v_second record;
begin
  select * into v_first from public.request_digest_confirmation('  New@Example.TEST ', 'website');
  perform test_helpers.assert(v_first.should_send and v_first.confirm_token is not null and v_first.unsubscribe_token is not null,
    'first signup asks for a confirmation email and returns tokens');
  select * into v_second from public.request_digest_confirmation('new@example.test', 'website');
  perform test_helpers.assert(not v_second.should_send and v_second.confirm_token is null,
    'repeat within the cooldown sends nothing and returns no token');
  call test_helpers.expect_error($f$select * from public.request_digest_confirmation('nope')$f$, '22023');
  call test_helpers.expect_error($f$select * from public.request_digest_confirmation('a@b.test', 'Bad Source')$f$, '22023');
  perform test_helpers.assert(
    (select count(*) from public.subscribers where email = 'new@example.test') = 1,
    'one row per address'
  );
  perform test_helpers.assert(
    (select confirmed_at is null from public.subscribers where email = 'new@example.test'),
    'new subscriber is pending'
  );
end;
$$;
reset role;

-- Cooldown elapsed: a fresh email is allowed and re-issues the same token.
update public.subscribers set confirmation_sent_at = now() - interval '11 minutes' where email = 'new@example.test';
select confirm_token as old_token from public.subscribers where email = 'new@example.test' \gset
set test.old_token = :'old_token';

set role service_role;
do $$
declare
  v_again record;
begin
  select * into v_again from public.request_digest_confirmation('new@example.test');
  perform test_helpers.assert(v_again.should_send and v_again.confirm_token = current_setting('test.old_token')::uuid,
    'resend after the cooldown reuses the token');
end;
$$;
reset role;

set role anon;
do $$
begin
  perform test_helpers.assert(not public.confirm_digest_subscription(gen_random_uuid()), 'unknown token is rejected');
  perform test_helpers.assert(not public.confirm_digest_subscription(null), 'null token is rejected');
  perform test_helpers.assert(public.confirm_digest_subscription(current_setting('test.old_token')::uuid), 'valid token confirms');
  perform test_helpers.assert(public.confirm_digest_subscription(current_setting('test.old_token')::uuid), 'confirming twice is fine');
end;
$$;
reset role;

do $$
begin
  perform test_helpers.assert(
    (select confirmed_at is not null from public.subscribers where email = 'new@example.test'),
    'confirmed_at stored'
  );
end;
$$;

set role service_role;
do $$
declare
  v_done record;
begin
  select * into v_done from public.request_digest_confirmation('new@example.test');
  perform test_helpers.assert(not v_done.should_send, 'confirmed addresses never get another confirmation email');
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Expired links, unsubscribed addresses and grandfathering
-- ---------------------------------------------------------------------------
insert into public.subscribers (email, confirmation_sent_at) values ('stale@example.test', now() - interval '8 days');
insert into public.subscribers (email, confirmation_sent_at, unsubscribed_at) values ('optout@example.test', now() - interval '1 day', now());
insert into public.subscribers (email) values ('neversent@example.test');
select confirm_token as stale_token from public.subscribers where email = 'stale@example.test' \gset
set test.stale_token = :'stale_token';
select confirm_token as optout_token from public.subscribers where email = 'optout@example.test' \gset
set test.optout_token = :'optout_token';
select confirm_token as neversent_token from public.subscribers where email = 'neversent@example.test' \gset
set test.neversent_token = :'neversent_token';

set role anon;
do $$
begin
  perform test_helpers.assert(not public.confirm_digest_subscription(current_setting('test.stale_token')::uuid), 'link older than 7 days is rejected');
  perform test_helpers.assert(not public.confirm_digest_subscription(current_setting('test.optout_token')::uuid), 'unsubscribed row cannot be confirmed');
  perform test_helpers.assert(not public.confirm_digest_subscription(current_setting('test.neversent_token')::uuid), 'row with no email sent cannot be confirmed');
end;
$$;
reset role;

set role service_role;
do $$
declare
  v_optout record;
  v_stale  record;
begin
  select * into v_optout from public.request_digest_confirmation('optout@example.test');
  perform test_helpers.assert(not v_optout.should_send, 'unsubscribed address is never re-enrolled');
  select * into v_stale from public.request_digest_confirmation('stale@example.test');
  perform test_helpers.assert(v_stale.should_send, 'a stale pending address can request a fresh link');
end;
$$;
reset role;

do $$
begin
  perform test_helpers.assert(
    (select unsubscribed_at is not null and confirmed_at is null from public.subscribers where email = 'optout@example.test'),
    'opt-out row untouched'
  );
end;
$$;

-- Direct anon RPC records a pending row that can never confirm itself.
set role anon;
select public.subscribe_to_digest('direct@example.test');
reset role;

do $$
begin
  perform test_helpers.assert(
    (select confirmed_at is null and confirmation_sent_at is null from public.subscribers where email = 'direct@example.test'),
    'subscribe_to_digest creates a pending row'
  );
end;
$$;

-- Digest recipients: confirmed only.
insert into public.subscribers (email, created_at, confirmed_at) values ('ok@example.test', now() - interval '3 days', now() - interval '3 days');
insert into public.subscribers (email, created_at) values ('pend@example.test', now() - interval '3 days');
insert into public.digest_runs (period_start, status, started_at) values ('2026-11-16', 'sending', now());

do $$
declare
  v_run uuid := (select id from public.digest_runs where period_start = '2026-11-16');
begin
  perform test_helpers.assert(
    (select count(*) from public.next_digest_recipients(v_run, 100) where email = 'pend@example.test') = 0,
    'pending subscribers are not digest recipients'
  );
  perform test_helpers.assert(
    (select count(*) from public.next_digest_recipients(v_run, 100) where email = 'ok@example.test') = 1,
    'confirmed subscribers are digest recipients'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Employer waitlist constraints
-- ---------------------------------------------------------------------------
set role service_role;
do $$
begin
  insert into public.employer_waitlist (email, company, role_note) values ('boss@acme.test', 'Acme', null);
  call test_helpers.expect_error($f$insert into public.employer_waitlist (email, company) values ('boss@acme.test', 'Acme')$f$, '23505');
  call test_helpers.expect_error($f$insert into public.employer_waitlist (email, company) values ('bad', 'Acme')$f$, '23514');
  call test_helpers.expect_error($f$insert into public.employer_waitlist (email, company) values ('x@acme.test', '   ')$f$, '23514');
  call test_helpers.expect_error($f$insert into public.employer_waitlist (email, company, role_note) values ('y@acme.test', 'Acme', repeat('x', 1001))$f$, '23514');
end;
$$;
reset role;

rollback;

\echo 'double opt-in and employer waitlist tests passed'
