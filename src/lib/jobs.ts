import "server-only";
import { cache } from "react";
import type { PostgrestError } from "@supabase/supabase-js";
import { siteConfig } from "@/lib/site";
import { getPublicDbClient } from "@/lib/supabase/server";
import { isValidSlug } from "@/lib/validation";
import type { Category, JobDetail, JobSearchFilters, JobSearchResult } from "@/lib/types";

export class DataAccessError extends Error {
  override readonly name = "DataAccessError";
}

function toDataAccessError(operation: string, error: PostgrestError): DataAccessError {
  // Log full detail server-side; surface only a generic message to callers.
  console.error(`[db] ${operation} failed`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
  return new DataAccessError(`Database request failed: ${operation}`, { cause: error });
}

const JOB_DETAIL_COLUMNS = `
  id, slug, title, company, company_logo_url, company_url, location,
  workplace_type, job_type, category_slug, tags, description, apply_url,
  salary_min, salary_max, salary_currency, is_featured, featured_until,
  published_at, expires_at,
  category:categories ( slug, name, description )
` as const;

export const listCategories = cache(async (): Promise<Category[]> => {
  const { data, error } = await getPublicDbClient()
    .from("categories")
    .select("slug, name, description")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw toDataAccessError("listCategories", error);
  return data;
});

export async function searchJobs(filters: JobSearchFilters): Promise<JobSearchResult> {
  const { pageSize } = siteConfig;
  const offset = (filters.page - 1) * pageSize;

  const { data, error } = await getPublicDbClient().rpc("search_jobs", {
    p_limit: pageSize,
    p_offset: offset,
    ...(filters.query ? { p_query: filters.query } : {}),
    ...(filters.category ? { p_category: filters.category } : {}),
    ...(filters.workplace ? { p_workplace: filters.workplace } : {}),
    ...(filters.tag ? { p_tag: filters.tag } : {}),
  });

  if (error) throw toDataAccessError("searchJobs", error);

  const rows = data ?? [];
  // total_count is a window aggregate, identical on every row. When the page
  // is past the end there are no rows, so fall back to a count of zero.
  const total = rows[0]?.total_count ?? 0;
  const jobs = rows.map(({ total_count: _total, ...job }) => job);

  return {
    jobs,
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    fetchedAt: Date.now(),
  };
}

/**
 * Fetches a single live job. Returns null for unknown, expired, unpaid or
 * malformed slugs (RLS hides everything that is not publicly visible).
 * Wrapped in React `cache` so generateMetadata and the page share one query.
 */
export const getJobBySlug = cache(async (slug: string): Promise<JobDetail | null> => {
  if (!isValidSlug(slug)) return null;

  const { data, error } = await getPublicDbClient()
    .from("jobs")
    .select(JOB_DETAIL_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw toDataAccessError("getJobBySlug", error);
  if (!data || !data.published_at || !data.expires_at) return null;

  const { featured_until, category, published_at, expires_at, ...job } = data;
  const now = Date.now();

  return {
    ...job,
    published_at,
    expires_at,
    is_featured: job.is_featured && featured_until !== null && Date.parse(featured_until) > now,
    category: category ?? null,
  };
});

export type SitemapJob = { slug: string; published_at: string };

export async function listLiveJobSlugs(limit = 5000): Promise<SitemapJob[]> {
  const { data, error } = await getPublicDbClient()
    .from("jobs")
    .select("slug, published_at")
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) throw toDataAccessError("listLiveJobSlugs", error);

  return data.flatMap((row) => (row.published_at ? [{ slug: row.slug, published_at: row.published_at }] : []));
}

export async function checkDatabaseHealth(): Promise<{ ok: true; latencyMs: number } | { ok: false; latencyMs: number }> {
  const started = performance.now();
  // Single attempt: a probe should report the current state, not mask it
  // behind the client's transient-error retries.
  const { error } = await getPublicDbClient()
    .from("categories")
    .select("slug", { count: "exact", head: true })
    .retry(false);
  const latencyMs = Math.round(performance.now() - started);

  if (error) {
    console.error("[db] health check failed", { code: error.code, message: error.message });
    return { ok: false, latencyMs };
  }
  return { ok: true, latencyMs };
}
