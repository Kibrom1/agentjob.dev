-- =============================================================================
-- Company blocklist: companies that asked to be removed (takedown) or that we
-- decided not to list. The ingestion RPC (upsert_ingested_jobs, next migration)
-- skips any posting whose company matches, so a removed company is not
-- re-ingested on the next daily run.
--
-- Matching key: lower(btrim(company)) exactly as sent by the ingestion payload.
-- Service-role only (RLS enabled, no policies, client grants revoked).
--
-- Operating it (SQL editor or service_role client):
--   select public.block_company('Acme AI', 'takedown request 2026-11-20');
--   select public.unblock_company('Acme AI');
-- block_company also rejects the company's currently active ingested listings
-- ('rejected' rows are never touched by ingestion, so they stay gone).
-- (Draft for counsel review: the retention/takedown policy this supports.)
-- =============================================================================

create table public.company_blocklist (
  company_key text primary key
    check (company_key = lower(btrim(company_key)) and char_length(company_key) between 1 and 120),
  reason      text check (char_length(reason) <= 500),
  created_at  timestamptz not null default now()
);

comment on table public.company_blocklist is
  'Companies whose postings are never ingested (takedown requests). Key is lower(btrim(company)).';

alter table public.company_blocklist enable row level security;
revoke all on public.company_blocklist from anon, authenticated;
grant all on public.company_blocklist to service_role;

create function public.block_company(p_company text, p_reason text default null)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_key     text := lower(btrim(p_company));
  v_removed integer;
begin
  if v_key is null or char_length(v_key) not between 1 and 120 then
    raise exception 'company must be 1-120 characters' using errcode = '22023';
  end if;

  insert into public.company_blocklist (company_key, reason)
  values (v_key, nullif(btrim(p_reason), ''))
  on conflict (company_key) do update set reason = coalesce(excluded.reason, public.company_blocklist.reason);

  update public.jobs
     set status = 'rejected',
         is_featured = false
   where source = 'ingested'
     and status in ('active', 'expired')
     and lower(btrim(company)) = v_key;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

create function public.unblock_company(p_company text)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.company_blocklist where company_key = lower(btrim(p_company));
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

revoke execute on function public.block_company(text, text), public.unblock_company(text)
  from public, anon, authenticated;
grant execute on function public.block_company(text, text), public.unblock_company(text)
  to service_role;
