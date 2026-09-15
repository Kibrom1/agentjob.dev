import "server-only";
import { z } from "zod";
import type { Enums, Tables } from "@/lib/database.types";
import { getAdminDbClient } from "@/lib/supabase/admin";

export const ADMIN_PAGE_SIZE = 50;

export const ADMIN_STATUS_FILTERS = ["all", "active", "pending_payment", "payment_expired", "draft", "expired", "rejected"] as const;
export type AdminStatusFilter = (typeof ADMIN_STATUS_FILTERS)[number];

export const ADMIN_ACTIONS = ["reject", "restore", "extend", "feature", "unfeature"] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export type AdminJobRow = Pick<
  Tables<"jobs">,
  | "id"
  | "slug"
  | "title"
  | "company"
  | "status"
  | "source"
  | "source_name"
  | "is_featured"
  | "featured_until"
  | "published_at"
  | "expires_at"
  | "created_at"
  | "category_slug"
> & { employer: { email: string } | null };

const ingestionLastRunSchema = z.object({
  source_name: z.string(),
  status: z.string(),
  fetched: z.number(),
  relevant: z.number(),
  inserted: z.number(),
  updated: z.number(),
  skipped: z.number(),
  failed: z.number(),
  closed: z.number(),
  error: z.string().nullable(),
  started_at: z.string(),
  finished_at: z.string(),
});

export type IngestionLastRun = z.infer<typeof ingestionLastRunSchema>;

const statsSchema = z.object({
  jobs_by_status: z.record(z.string(), z.number()),
  jobs_by_source: z.record(z.string(), z.number()),
  live_jobs: z.number(),
  featured_live: z.number(),
  subscribers_active: z.number(),
  subscribers_total: z.number(),
  paid_last_30d: z.number(),
  last_digest: z
    .object({
      period_start: z.string(),
      status: z.string(),
      job_count: z.number(),
      sent_count: z.number(),
      started_at: z.string(),
      completed_at: z.string().nullable(),
    })
    .nullable(),
  // Optional/default so a stats payload from before this migration (or a
  // stale PostgREST schema cache) still validates instead of throwing.
  ingestion_last_runs: z.array(ingestionLastRunSchema).default([]),
});

export type AdminStats = z.infer<typeof statsSchema>;

export async function getAdminStats(): Promise<AdminStats> {
  const { data, error } = await getAdminDbClient().rpc("admin_stats");
  if (error) throw new Error(`admin_stats failed: ${error.message}`, { cause: error });
  return statsSchema.parse(data);
}

export type AdminJobQuery = {
  status: AdminStatusFilter;
  search?: string;
  page: number;
};

/**
 * Builds a quoted PostgREST `ilike` operand from admin search text. LIKE
 * wildcards and PostgREST filter syntax are removed rather than escaped, so
 * the text can never widen the match or inject another filter.
 */
export function toIlikePattern(search: string): string {
  const cleaned = search
    .replace(/[%_\\",()*]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `"%${cleaned}%"`;
}

export async function listAdminJobs(query: AdminJobQuery): Promise<{ jobs: AdminJobRow[]; total: number }> {
  const from = (query.page - 1) * ADMIN_PAGE_SIZE;
  let request = getAdminDbClient()
    .from("jobs")
    .select(
      "id, slug, title, company, status, source, source_name, is_featured, featured_until, published_at, expires_at, created_at, category_slug, employer:employers ( email )",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + ADMIN_PAGE_SIZE - 1);

  if (query.status !== "all") {
    request = request.eq("status", query.status satisfies Enums<"job_status">);
  }
  if (query.search) {
    const pattern = toIlikePattern(query.search);
    request = request.or(`title.ilike.${pattern},company.ilike.${pattern}`);
  }

  const { data, error, count } = await request;
  if (error) throw new Error(`listAdminJobs failed: ${error.message}`, { cause: error });
  return { jobs: data, total: count ?? data.length };
}
