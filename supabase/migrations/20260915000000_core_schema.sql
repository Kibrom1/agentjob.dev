-- =============================================================================
-- AgentJobs.dev — Phase 1 core schema
--
-- Design notes
--   * Lifecycle is an explicit enum (`job_status`) instead of an `is_active`
--     boolean so "paid but not yet published", "expired" and "rejected" are
--     distinguishable. Public visibility = status 'active' AND not yet expired,
--     enforced by RLS, so an expired row disappears even if the expiry sweep
--     has not run yet.
--   * Categories are a reference table (FK) rather than free text, so filters
--     can never drift out of sync with stored data.
--   * Emails are stored normalised (lower-case, trimmed) and validated with a
--     CHECK; no citext dependency.
--   * The anon/authenticated roles get column-level SELECT on `jobs` only.
--     Billing and ingestion bookkeeping columns are never exposed.
--   * `subscribers` is not directly writable by clients; the security-definer
--     RPC `subscribe_to_digest` is the only public entry point and never
--     reveals whether an address already exists.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.job_status as enum ('draft', 'pending_payment', 'active', 'expired', 'rejected');
create type public.job_type as enum ('full_time', 'part_time', 'contract', 'internship');
create type public.workplace_type as enum ('remote', 'hybrid', 'onsite');
create type public.job_source as enum ('employer', 'ingested', 'admin');

-- -----------------------------------------------------------------------------
-- Helper functions (immutable, safe for CHECK constraints / generated columns)
-- -----------------------------------------------------------------------------
create function public.is_valid_email(p_email text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_email is not null
     and char_length(p_email) between 3 and 254
     and p_email = lower(btrim(p_email))
     and p_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
$$;

create function public.is_valid_slug(p_slug text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_slug is not null
     and char_length(p_slug) between 1 and 160
     and p_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$';
$$;

-- Tags keep their display casing ("LangGraph"), are 1-32 chars, may contain
-- space . + # / - internally (e.g. "C++", "Node.js", "Tool Use"), and must be
-- unique case-insensitively. At most 12 per job.
create function public.are_valid_tags(p_tags text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_tags is not null
     and coalesce(array_ndims(p_tags), 1) = 1
     and (
       select coalesce(bool_and(
                t is not null
                and t ~ '^[A-Za-z0-9]([A-Za-z0-9 .+#/-]{0,30}[A-Za-z0-9+#])?$'
              ), true)
          and count(*) <= 12
          and count(*) = count(distinct lower(t))
       from unnest(p_tags) as t
     );
$$;

-- array_to_string() is STABLE, which generated columns reject. Tags are plain
-- text so the conversion is deterministic; this wrapper declares that.
create function public.tags_to_text(p_tags text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_to_string(p_tags, ' '), '');
$$;

create function public.slugify(p_input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
           left(
             btrim(regexp_replace(lower(coalesce(p_input, '')), '[^a-z0-9]+', '-', 'g'), '-'),
             80
           ),
           '-'
         );
$$;

-- -----------------------------------------------------------------------------
-- categories (reference data)
-- -----------------------------------------------------------------------------
create table public.categories (
  slug        text primary key check (public.is_valid_slug(slug) and char_length(slug) <= 60),
  name        text not null unique check (char_length(btrim(name)) between 2 and 60),
  description text not null check (char_length(btrim(description)) between 10 and 280),
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.categories (slug, name, description, sort_order) values
  ('agent-orchestration',  'Agent Orchestration',      'Planning loops, state machines and control flow for autonomous agents (LangGraph, Temporal, custom runtimes).', 10),
  ('multi-agent-systems',  'Multi-Agent Systems',      'Architectures where multiple specialised agents coordinate, negotiate or hand off work.',                        20),
  ('tool-use-backends',    'Tool-Use Backends',        'APIs, MCP servers, sandboxes and execution environments that agents call into.',                                 30),
  ('local-llm-infra',      'Local LLM Infrastructure', 'Self-hosted inference, quantisation, GPU scheduling and on-device model serving.',                               40),
  ('retrieval-memory',     'Retrieval & Memory',       'RAG pipelines, vector stores, long-term agent memory and context engineering.',                                  50),
  ('evals-observability',  'Evals & Observability',    'Agent evaluation harnesses, tracing, guardrails and production reliability.',                                    60),
  ('agent-platform',       'Agent Platform & DevTools','Frameworks, SDKs and internal platforms that other engineers build agents on.',                                  70);

-- -----------------------------------------------------------------------------
-- employers
-- -----------------------------------------------------------------------------
create table public.employers (
  id                 uuid primary key default gen_random_uuid(),
  company_name       text not null check (char_length(btrim(company_name)) between 1 and 120),
  email              text not null unique check (public.is_valid_email(email)),
  website_url        text check (website_url ~* '^https?://[^[:space:]]+$' and char_length(website_url) <= 2048),
  logo_url           text check (logo_url ~* '^https://[^[:space:]]+$' and char_length(logo_url) <= 2048),
  stripe_customer_id text unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- jobs
-- -----------------------------------------------------------------------------
create table public.jobs (
  id                         uuid primary key default gen_random_uuid(),
  slug                       text not null unique check (public.is_valid_slug(slug)),
  employer_id                uuid references public.employers (id) on delete restrict,
  status                     public.job_status not null default 'draft',
  source                     public.job_source not null default 'employer',
  source_name                text check (char_length(source_name) between 1 and 80),
  external_id                text check (char_length(external_id) between 1 and 255),

  title                      text not null check (char_length(btrim(title)) between 3 and 140),
  company                    text not null check (char_length(btrim(company)) between 1 and 120),
  company_logo_url           text check (company_logo_url ~* '^https://[^[:space:]]+$' and char_length(company_logo_url) <= 2048),
  company_url                text check (company_url ~* '^https?://[^[:space:]]+$' and char_length(company_url) <= 2048),
  location                   text not null check (char_length(btrim(location)) between 1 and 120),
  workplace_type             public.workplace_type not null,
  job_type                   public.job_type not null default 'full_time',
  category_slug              text not null references public.categories (slug) on update cascade on delete restrict,
  tags                       text[] not null default '{}' check (public.are_valid_tags(tags)),
  description                text not null check (char_length(btrim(description)) between 50 and 50000),
  apply_url                  text not null check (
                               char_length(apply_url) <= 2048
                               and (apply_url ~* '^https?://[^[:space:]]+$' or apply_url ~* '^mailto:[^@[:space:]]+@[^@[:space:]]+$')
                             ),

  salary_min                 integer check (salary_min >= 0),
  salary_max                 integer check (salary_max >= 0),
  salary_currency            char(3) not null default 'USD' check (salary_currency ~ '^[A-Z]{3}$'),

  is_featured                boolean not null default false,
  featured_until             timestamptz,
  stripe_checkout_session_id text unique check (stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),

  published_at               timestamptz,
  expires_at                 timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  search_vector              tsvector generated always as (
                               setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A')
                               || setweight(to_tsvector('english'::regconfig, public.tags_to_text(tags)), 'A')
                               || setweight(to_tsvector('english'::regconfig, coalesce(company, '')), 'B')
                               || setweight(to_tsvector('english'::regconfig, coalesce(location, '')), 'C')
                               || setweight(to_tsvector('english'::regconfig, coalesce(description, '')), 'D')
                             ) stored,

  constraint jobs_salary_range_chk
    check (salary_min is null or salary_max is null or salary_max >= salary_min),
  constraint jobs_active_has_window_chk
    check (status <> 'active' or (published_at is not null and expires_at is not null and expires_at > published_at)),
  constraint jobs_featured_has_window_chk
    check (not is_featured or featured_until is not null),
  constraint jobs_employer_source_chk
    check (source <> 'employer' or employer_id is not null),
  constraint jobs_ingested_identity_chk
    check (source <> 'ingested' or (source_name is not null and external_id is not null)),
  constraint jobs_external_id_needs_source_chk
    check (external_id is null or source_name is not null),
  constraint jobs_pending_payment_has_session_chk
    check (status <> 'pending_payment' or stripe_checkout_session_id is not null)
);

comment on column public.jobs.source_name is 'Ingestion origin, e.g. "greenhouse:acme". Paired with external_id for idempotent upserts.';
comment on column public.jobs.featured_until is 'Pin to top while now() < featured_until.';
comment on column public.jobs.search_vector is 'Weighted FTS document: title/tags (A), company (B), location (C), description (D).';

-- Idempotent ingestion key
create unique index jobs_source_external_uidx
  on public.jobs (source_name, external_id)
  where external_id is not null;

-- Public feed (newest first) and its filtered variants
create index jobs_active_feed_idx
  on public.jobs (published_at desc, id)
  where status = 'active';

create index jobs_active_workplace_idx
  on public.jobs (workplace_type, published_at desc)
  where status = 'active';

-- Also serves the categories FK (ON UPDATE CASCADE) because it is not partial
create index jobs_category_published_idx
  on public.jobs (category_slug, published_at desc);

-- Search and tag filters
create index jobs_search_vector_idx on public.jobs using gin (search_vector);
create index jobs_tags_idx          on public.jobs using gin (tags);

-- Maintenance sweeps and admin views
create index jobs_active_expiry_idx
  on public.jobs (expires_at)
  where status = 'active';

create index jobs_featured_until_idx
  on public.jobs (featured_until)
  where is_featured;

create index jobs_status_created_idx on public.jobs (status, created_at desc);
create index jobs_employer_id_idx    on public.jobs (employer_id) where employer_id is not null;

-- -----------------------------------------------------------------------------
-- subscribers
-- -----------------------------------------------------------------------------
create table public.subscribers (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique check (public.is_valid_email(email)),
  source            text not null default 'website' check (public.is_valid_slug(source) and char_length(source) <= 40),
  unsubscribe_token uuid not null unique default gen_random_uuid(),
  unsubscribed_at   timestamptz,
  created_at        timestamptz not null default now()
);

-- Digest fan-out reads only active subscribers
create index subscribers_active_created_idx
  on public.subscribers (created_at)
  where unsubscribed_at is null;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger employers_set_updated_at
  before update on public.employers
  for each row execute function public.set_updated_at();

create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

-- Generates "<title>-at-<company>-<8 hex of id>" when no slug is supplied;
-- parts that slugify to nothing (e.g. non-Latin text) are dropped.
-- Column defaults are applied before BEFORE triggers, so new.id is populated.
create function public.jobs_assign_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base text;
begin
  if new.slug is null or btrim(new.slug) = '' then
    v_base := coalesce(
      nullif(concat_ws('-at-', nullif(public.slugify(new.title), ''), nullif(public.slugify(new.company), '')), ''),
      'job'
    );
    new.slug := v_base || '-' || left(replace(new.id::text, '-', ''), 8);
  end if;
  return new;
end;
$$;

create trigger jobs_assign_slug
  before insert on public.jobs
  for each row execute function public.jobs_assign_slug();

-- Trim whitespace-only differences so CHECK constraints see canonical values.
create function public.jobs_normalise()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title    := btrim(new.title);
  new.company  := btrim(new.company);
  new.location := btrim(new.location);
  if not new.is_featured then
    new.featured_until := null;
  end if;
  return new;
end;
$$;

create trigger jobs_normalise
  before insert or update on public.jobs
  for each row execute function public.jobs_normalise();

-- -----------------------------------------------------------------------------
-- RPC: public job search
--   Security invoker: runs under the caller's RLS + column grants.
--   Empty / whitespace / stop-word-only queries behave like "no query".
-- -----------------------------------------------------------------------------
create function public.search_jobs(
  p_query     text default null,
  p_category  text default null,
  p_workplace public.workplace_type default null,
  p_tag       text default null,
  p_limit     integer default 30,
  p_offset    integer default 0
)
returns table (
  id               uuid,
  slug             text,
  title            text,
  company          text,
  company_logo_url text,
  location         text,
  workplace_type   public.workplace_type,
  job_type         public.job_type,
  category_slug    text,
  tags             text[],
  salary_min       integer,
  salary_max       integer,
  salary_currency  char(3),
  is_featured      boolean,
  published_at     timestamptz,
  total_count      bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_query  tsquery;
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  if p_query is not null and btrim(p_query) <> '' then
    v_query := websearch_to_tsquery('english'::regconfig, left(btrim(p_query), 200));
    if pg_catalog.numnode(v_query) = 0 then
      v_query := null;
    end if;
  end if;

  return query
  select
    j.id,
    j.slug,
    j.title,
    j.company,
    j.company_logo_url,
    j.location,
    j.workplace_type,
    j.job_type,
    j.category_slug,
    j.tags,
    j.salary_min,
    j.salary_max,
    j.salary_currency,
    (j.is_featured and j.featured_until > now()) as is_featured,
    j.published_at,
    count(*) over () as total_count
  from public.jobs as j
  where j.status = 'active'
    and j.expires_at > now()
    and (v_query is null or j.search_vector @@ v_query)
    and (p_category is null or j.category_slug = p_category)
    and (p_workplace is null or j.workplace_type = p_workplace)
    and (p_tag is null or j.tags @> array[p_tag])
  order by
    (j.is_featured and j.featured_until > now()) desc,
    case when v_query is null then 0 else ts_rank_cd(j.search_vector, v_query) end desc,
    j.published_at desc,
    j.id
  limit v_limit
  offset v_offset;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: newsletter signup (anon-callable, enumeration-safe)
--   Existing addresses (including unsubscribed ones) are left untouched so a
--   third party cannot re-subscribe someone who opted out.
-- -----------------------------------------------------------------------------
create function public.subscribe_to_digest(p_email text, p_source text default 'website')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_source text := coalesce(nullif(btrim(p_source), ''), 'website');
begin
  if not public.is_valid_email(v_email) then
    raise exception 'Invalid email address' using errcode = '22023';
  end if;
  if not public.is_valid_slug(v_source) or char_length(v_source) > 40 then
    raise exception 'Invalid signup source' using errcode = '22023';
  end if;

  insert into public.subscribers (email, source)
  values (v_email, v_source)
  on conflict (email) do nothing;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: publish a job after Stripe confirms payment (service_role only)
--   Idempotent: repeated webhook deliveries return the already-active row.
-- -----------------------------------------------------------------------------
create function public.activate_paid_job(
  p_stripe_session_id text,
  p_featured          boolean,
  p_duration_days     integer default 30
)
returns public.jobs
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  if p_stripe_session_id is null or p_stripe_session_id = '' then
    raise exception 'Stripe session id is required' using errcode = '22023';
  end if;
  if p_duration_days is null or p_duration_days not between 1 and 90 then
    raise exception 'Listing duration must be between 1 and 90 days' using errcode = '22023';
  end if;

  update public.jobs
     set status         = 'active',
         published_at   = now(),
         expires_at     = now() + make_interval(days => p_duration_days),
         is_featured    = coalesce(p_featured, false),
         featured_until = case when coalesce(p_featured, false)
                               then now() + make_interval(days => p_duration_days)
                          end
   where stripe_checkout_session_id = p_stripe_session_id
     and status = 'pending_payment'
  returning * into v_job;

  if not found then
    select * into v_job
      from public.jobs
     where stripe_checkout_session_id = p_stripe_session_id;

    if not found then
      raise exception 'No job found for checkout session %', p_stripe_session_id using errcode = 'P0002';
    end if;
  end if;

  return v_job;
end;
$$;

-- -----------------------------------------------------------------------------
-- Maintenance: expire listings and lapsed featured pins (service_role / cron)
-- -----------------------------------------------------------------------------
create function public.expire_jobs()
returns table (expired_count integer, unfeatured_count integer)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_expired    integer;
  v_unfeatured integer;
begin
  update public.jobs
     set status = 'expired', is_featured = false
   where status = 'active'
     and expires_at <= now();
  get diagnostics v_expired = row_count;

  update public.jobs
     set is_featured = false
   where is_featured
     and featured_until <= now();
  get diagnostics v_unfeatured = row_count;

  return query select v_expired, v_unfeatured;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.categories  enable row level security;
alter table public.employers   enable row level security;
alter table public.jobs        enable row level security;
alter table public.subscribers enable row level security;

create policy "categories are publicly readable"
  on public.categories for select
  to anon, authenticated
  using (true);

create policy "live jobs are publicly readable"
  on public.jobs for select
  to anon, authenticated
  using (status = 'active' and expires_at > now());

-- employers and subscribers intentionally have no client policies:
-- only service_role (which bypasses RLS) and security-definer RPCs touch them.

-- -----------------------------------------------------------------------------
-- Privileges
--   Supabase grants ALL on new public objects to anon/authenticated by default.
--   Strip that and grant back only what the public site needs.
-- -----------------------------------------------------------------------------
revoke all on public.categories, public.employers, public.jobs, public.subscribers
  from anon, authenticated;

grant select on public.categories to anon, authenticated;

grant select (
  id, slug, status, title, company, company_logo_url, company_url, location,
  workplace_type, job_type, category_slug, tags, description, apply_url,
  salary_min, salary_max, salary_currency, is_featured, featured_until,
  published_at, expires_at, search_vector
) on public.jobs to anon, authenticated;

grant all on public.categories, public.employers, public.jobs, public.subscribers
  to service_role;

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.search_jobs(text, text, public.workplace_type, text, integer, integer)
  to anon, authenticated, service_role;
grant execute on function public.subscribe_to_digest(text, text)
  to anon, authenticated, service_role;
grant execute on function public.activate_paid_job(text, boolean, integer) to service_role;
grant execute on function public.expire_jobs() to service_role;

-- Helpers are referenced by CHECK constraints, generated columns and triggers,
-- which run with the privileges of the writing role.
grant execute on function
  public.is_valid_email(text),
  public.is_valid_slug(text),
  public.are_valid_tags(text[]),
  public.tags_to_text(text[]),
  public.slugify(text),
  public.set_updated_at(),
  public.jobs_assign_slug(),
  public.jobs_normalise()
to anon, authenticated, service_role;
