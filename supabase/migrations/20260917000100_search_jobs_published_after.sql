-- Adds an optional p_published_after cutoff to search_jobs(), pushed into
-- the WHERE clause (and thus before the LIMIT), so callers that only want
-- "recent" jobs (e.g. /api/jobs/recent) no longer filter client-side after a
-- hard LIMIT 100 — which could silently under-report during an ingestion
-- burst that fills the page with older/featured rows ahead of the cutoff.
-- See docs/reviews/data.md and docs/reviews/architecture-synthesis.md #10.
--
-- All existing parameters and behavior are unchanged when p_published_after
-- is null (the default), including the default 30 for p_limit — this is
-- purely additive.
\set ON_ERROR_STOP on

-- Postgres identifies functions by name + argument type list, so appending a
-- new parameter is a distinct signature, not a same-signature replace:
-- `create or replace` would leave the old 6-arg overload around alongside a
-- new 7-arg one. Drop the old overload explicitly so there is exactly one
-- `search_jobs`, then recreate (grants are re-issued below since dropping a
-- function drops its grants with it).
drop function if exists public.search_jobs(text, text, public.workplace_type, text, integer, integer);

create or replace function public.search_jobs(
  p_query            text default null,
  p_category         text default null,
  p_workplace        public.workplace_type default null,
  p_tag              text default null,
  p_limit            integer default 30,
  p_offset           integer default 0,
  p_published_after  timestamptz default null
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
    and (p_published_after is null or j.published_at > p_published_after)
  order by
    (j.is_featured and j.featured_until > now()) desc,
    case when v_query is null then 0 else ts_rank_cd(j.search_vector, v_query) end desc,
    j.published_at desc,
    j.id
  limit v_limit
  offset v_offset;
end;
$$;

comment on function public.search_jobs(text, text, public.workplace_type, text, integer, integer, timestamptz) is
  'Public job search/feed RPC. p_published_after (optional) filters to jobs published strictly after the given timestamp, applied before the LIMIT so recency-scoped callers (e.g. /api/jobs/recent) are LIMIT-safe.';

grant execute on function public.search_jobs(text, text, public.workplace_type, text, integer, integer, timestamptz)
  to anon, authenticated, service_role;
