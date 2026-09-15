import type { Route } from "next";
import Link from "next/link";
import { z } from "zod";
import { JobActions } from "@/components/admin/job-actions";
import { assertAdmin } from "@/lib/admin/guard";
import {
  ADMIN_PAGE_SIZE,
  ADMIN_STATUS_FILTERS,
  getAdminStats,
  listAdminJobs,
  type AdminStatusFilter,
} from "@/lib/admin/jobs";
import { formatDate } from "@/lib/format";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const querySchema = z.object({
  status: z.enum(ADMIN_STATUS_FILTERS).catch("all"),
  q: z.string().trim().max(100).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).catch(1),
  error: z.string().max(200).optional().catch(undefined),
  created: z.string().max(200).optional().catch(undefined),
});

const STATUS_STYLES: Record<string, string> = {
  active: "bg-accent-50 text-accent-700 dark:bg-accent-950 dark:text-accent-400",
  pending_payment: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  payment_expired: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  draft: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  expired: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  rejected: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hrefFor(status: AdminStatusFilter, q: string | undefined, page = 1): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/admin?${qs}` : "/admin";
}

export default async function AdminPage({ searchParams }: Props) {
  await assertAdmin();

  const raw = await searchParams;
  const query = querySchema.parse({
    status: first(raw.status),
    q: first(raw.q) || undefined,
    page: first(raw.page) ?? 1,
    error: first(raw.error),
    created: first(raw.created),
  });

  const [stats, { jobs, total }] = await Promise.all([
    getAdminStats(),
    listAdminJobs({ status: query.status, search: query.q, page: query.page }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const returnTo = hrefFor(query.status, query.q, query.page);

  const cards = [
    { label: "Live jobs", value: stats.live_jobs, detail: `${stats.featured_live} featured` },
    {
      label: "By source",
      value: stats.jobs_by_source.employer ?? 0,
      detail: `paid · ${stats.jobs_by_source.ingested ?? 0} ingested · ${stats.jobs_by_source.admin ?? 0} curated`,
    },
    { label: "Paid (30 days)", value: stats.paid_last_30d, detail: `${stats.jobs_by_status.pending_payment ?? 0} awaiting payment` },
    { label: "Subscribers", value: stats.subscribers_active, detail: `${stats.subscribers_total} all-time` },
    {
      label: "Last digest",
      value: stats.last_digest ? stats.last_digest.sent_count : 0,
      detail: stats.last_digest
        ? `${stats.last_digest.status} · ${stats.last_digest.period_start} · ${stats.last_digest.job_count} jobs`
        : "not sent yet",
    },
  ];

  return (
    <div className="space-y-8">
      {query.error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          Action failed: {query.error}
        </p>
      )}
      {query.created && (
        <p role="status" className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-accent-700 dark:bg-accent-950 dark:text-accent-400">
          Listing published.{" "}
          <Link href={`/jobs/${query.created}` as Route} className="underline">
            View it
          </Link>
        </p>
      )}

      <section aria-label="Overview" className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-xs text-zinc-500">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{card.value.toLocaleString("en-US")}</p>
            <p className="mt-0.5 truncate text-xs text-zinc-500" title={card.detail}>
              {card.detail}
            </p>
          </div>
        ))}
      </section>

      <section aria-labelledby="jobs-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 id="jobs-heading" className="text-lg font-semibold">
            Jobs <span className="font-normal text-zinc-500">({total.toLocaleString("en-US")})</span>
          </h1>
          <form action="/admin" method="get" className="flex gap-2">
            {query.status !== "all" && <input type="hidden" name="status" value={query.status} />}
            <label htmlFor="admin-search" className="sr-only">
              Search title or company
            </label>
            <input
              id="admin-search"
              name="q"
              type="search"
              defaultValue={query.q}
              placeholder="Search title or company"
              className="h-9 w-56 rounded-lg border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button type="submit" className="h-9 rounded-lg border border-zinc-300 px-3 text-sm dark:border-zinc-700">
              Search
            </button>
          </form>
        </div>

        <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {ADMIN_STATUS_FILTERS.map((status) => (
            <Link
              key={status}
              href={hrefFor(status, query.q) as Route}
              aria-current={query.status === status ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-xs ${
                query.status === status
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400"
              }`}
            >
              {status.replace("_", " ")}
              {status !== "all" && stats.jobs_by_status[status] !== undefined && ` · ${stats.jobs_by_status[status]}`}
            </Link>
          ))}
        </nav>

        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900/60">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Job</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Source</th>
                <th scope="col" className="px-3 py-2 font-medium">Published</th>
                <th scope="col" className="px-3 py-2 font-medium">Expires</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-zinc-500">
                    No jobs match this filter.
                  </td>
                </tr>
              )}
              {jobs.map((job) => (
                <tr key={job.id} className="align-top">
                  <td className="px-3 py-2.5">
                    {job.status === "active" ? (
                      <Link href={`/jobs/${job.slug}` as Route} className="font-medium hover:underline">
                        {job.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{job.title}</span>
                    )}
                    <div className="text-xs text-zinc-500">
                      {job.company}
                      {job.employer && ` · ${job.employer.email}`}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[job.status] ?? ""}`}>
                      {job.status.replace("_", " ")}
                    </span>
                    {job.is_featured && <span className="ml-1 text-xs text-accent-700 dark:text-accent-400">★</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-zinc-600 dark:text-zinc-400">
                    {job.source}
                    {job.source_name && <div className="font-mono text-zinc-400">{job.source_name}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{job.published_at ? formatDate(job.published_at) : "—"}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{job.expires_at ? formatDate(job.expires_at) : "—"}</td>
                  <td className="px-3 py-2.5">
                    <JobActions job={job} returnTo={returnTo} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pageCount > 1 && (
          <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
            {query.page > 1 ? (
              <Link href={hrefFor(query.status, query.q, query.page - 1) as Route} className="underline">
                ← Previous
              </Link>
            ) : (
              <span />
            )}
            <span className="text-xs text-zinc-500">
              Page {query.page} of {pageCount}
            </span>
            {query.page < pageCount ? (
              <Link href={hrefFor(query.status, query.q, query.page + 1) as Route} className="underline">
                Next →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
