import Link from "next/link";
import type { Route } from "next";
import { CompanyLogo } from "@/components/company-logo";
import { JobMeta } from "@/components/job-meta";
import { TagList } from "@/components/tag-list";
import { formatRelativeTime } from "@/lib/format";
import type { JobSummary } from "@/lib/types";

type JobCardProps = {
  job: JobSummary;
  categoryName?: string;
  activeTag?: string;
  hrefForTag: (tag: string) => Route;
  now: number;
};

export function JobCard({ job, categoryName, activeTag, hrefForTag, now }: JobCardProps) {
  const href = `/jobs/${job.slug}` as Route;

  return (
    <article
      className={`group relative flex gap-4 rounded-xl border p-4 transition-colors sm:p-5 ${
        job.is_featured
          ? "border-accent-500/60 bg-accent-50/60 hover:border-accent-500 dark:border-accent-700/60 dark:bg-accent-950/40 dark:hover:border-accent-500"
          : "border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
      }`}
    >
      <CompanyLogo company={job.company} logoUrl={job.company_logo_url} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{job.company}</p>
            <h2 className="mt-0.5 text-base font-semibold tracking-tight text-zinc-900 sm:text-lg dark:text-zinc-50">
              {/* Stretched link: the whole card is clickable; tag links sit above it (z-10). */}
              <Link href={href} className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none">
                {job.title}
              </Link>
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs">
            {job.is_featured && (
              <span className="rounded-full bg-accent-600 px-2 py-0.5 font-medium text-white">Featured</span>
            )}
            <time dateTime={job.published_at} className="font-mono text-zinc-500 dark:text-zinc-400">
              {formatRelativeTime(job.published_at, now)}
            </time>
          </div>
        </div>

        <div className="mt-2">
          <JobMeta
            location={job.location}
            workplaceType={job.workplace_type}
            jobType={job.job_type}
            salaryMin={job.salary_min}
            salaryMax={job.salary_max}
            salaryCurrency={job.salary_currency}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {categoryName && (
            <span className="inline-flex items-center rounded-md bg-zinc-900 px-2 py-0.5 text-xs leading-5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
              {categoryName}
            </span>
          )}
          <TagList tags={job.tags} activeTag={activeTag} hrefForTag={hrefForTag} />
        </div>
      </div>

      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-xl ring-accent-500 group-focus-within:ring-2"
      />
    </article>
  );
}
