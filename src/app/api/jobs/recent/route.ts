import { RATE_LIMITS, consumeRateLimit } from "@/lib/rate-limit";
import { absoluteUrl } from "@/lib/site";
import { getPublicDbClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE_BUT_CACHEABLE = { "Cache-Control": "public, max-age=0, s-maxage=300" } as const;
const MAX_DAYS = 14;
const DEFAULT_DAYS = 2;

/**
 * Public, read-only feed of recently published jobs — the same data the
 * board itself shows, just as JSON. Built for the ops/marketing agent to
 * draft social posts about new listings without needing service-role
 * access; anyone else is welcome to it too (RLS/search_jobs already gate
 * what's returned to anon).
 */
export async function GET(request: Request) {
  if (!(await consumeRateLimit(RATE_LIMITS.jobsRecent, request.headers))) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(RATE_LIMITS.jobsRecent.windowSeconds) } },
    );
  }

  const url = new URL(request.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? DEFAULT_DAYS) || DEFAULT_DAYS, 1), MAX_DAYS);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  // p_published_after pushes the cutoff into the RPC's WHERE clause, before
  // its LIMIT — so a burst of older/featured jobs can no longer crowd the
  // top 100 rows and silently push genuinely recent jobs out of this
  // response. The client-side filter below is kept as a cheap defense in
  // depth, not as the primary mechanism.
  const { data, error } = await getPublicDbClient().rpc("search_jobs", {
    p_limit: 100,
    p_offset: 0,
    p_published_after: new Date(cutoff).toISOString(),
  });
  if (error) {
    console.error("[api/jobs/recent] search_jobs failed", error);
    return Response.json({ error: "Failed to load jobs" }, { status: 500, headers: NO_STORE_BUT_CACHEABLE });
  }

  const jobs = data
    .filter((job) => Date.parse(job.published_at) >= cutoff)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
    .map((job) => ({
      title: job.title,
      company: job.company,
      location: job.location,
      workplaceType: job.workplace_type,
      categorySlug: job.category_slug,
      tags: job.tags,
      isFeatured: job.is_featured,
      publishedAt: job.published_at,
      url: absoluteUrl(`/jobs/${job.slug}`),
    }));

  return Response.json({ days, jobs }, { headers: NO_STORE_BUT_CACHEABLE });
}
