import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyLogo } from "@/components/company-logo";
import { JsonLd } from "@/components/json-ld";
import { Markdown } from "@/components/markdown";
import { SourceAttribution } from "@/components/source-attribution";
import { SubscribeCard } from "@/components/subscribe-card";
import { TagList } from "@/components/tag-list";
import { buildApplyHref, formatDate, formatLocationSummary, formatSalaryRange, splitLocations } from "@/lib/format";
import { buildBreadcrumbJsonLd, buildJobMetaDescription, buildJobPostingJsonLd } from "@/lib/job-schema";
import { getJobBySlug } from "@/lib/jobs";
import { buildJobSearchHref } from "@/lib/search-params";
import { siteConfig } from "@/lib/site";
import { JOB_TYPE_LABELS, WORKPLACE_LABELS } from "@/lib/types";

// Rendered on first request, then served from cache and refreshed at most
// every five minutes (ISR). Payment webhooks can revalidate a path instantly.
export const revalidate = 300;

export function generateStaticParams(): Array<{ slug: string }> {
  return [];
}

type JobPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: JobPageProps): Promise<Metadata> {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job) return { title: "Job not found", robots: { index: false, follow: true } };

  const title = `${job.title} at ${job.company}`;
  const description = buildJobMetaDescription(job);
  const path = `/jobs/${job.slug}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "article", siteName: siteConfig.name, title, description, url: path, publishedTime: job.published_at },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function JobPage({ params }: JobPageProps) {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job) notFound();

  const applyHref = buildApplyHref(job.apply_url, job.title, siteConfig.domain);
  const salary = formatSalaryRange(job.salary_min, job.salary_max, job.salary_currency);
  const locations = splitLocations(job.location);
  const locationSummary = formatLocationSummary(job.location);
  const breadcrumbs = [
    { name: "Jobs", path: "/" },
    ...(job.category
      ? [{ name: job.category.name, path: buildJobSearchHref({ page: 1 }, { category: job.category.slug }) }]
      : []),
    { name: job.title, path: `/jobs/${job.slug}` },
  ];
  const hrefForTag = (tag: string): Route => buildJobSearchHref({ page: 1 }, { tag });

  const details: Array<{ label: string; value: string }> = [
    { label: "Location", value: locations.join(" · ") || job.location },
    { label: "Workplace", value: WORKPLACE_LABELS[job.workplace_type] },
    { label: "Employment", value: JOB_TYPE_LABELS[job.job_type] },
    { label: "Salary", value: salary ?? "Not listed" },
    ...(job.category ? [{ label: "Category", value: job.category.name }] : []),
    { label: "Posted", value: formatDate(job.published_at) },
  ];

  const applyButton = (className: string) =>
    applyHref ? (
      <a
        href={applyHref}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent-700 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-800 ${className}`}
      >
        Apply for this role
        <span aria-hidden="true">↗</span>
      </a>
    ) : (
      <p className={`text-sm text-zinc-500 ${className}`}>Applications for this role are handled directly by {job.company}.</p>
    );

  return (
    <>
      <JsonLd data={buildJobPostingJsonLd(job)} />
      <JsonLd data={buildBreadcrumbJsonLd(breadcrumbs)} />

      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
        <nav aria-label="Breadcrumb" className="text-sm">
          <ol className="flex flex-wrap items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
            <li>
              <Link href="/" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Jobs
              </Link>
            </li>
            {job.category && (
              <>
                <li aria-hidden="true">/</li>
                <li>
                  <Link
                    href={buildJobSearchHref({ page: 1 }, { category: job.category.slug })}
                    className="hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    {job.category.name}
                  </Link>
                </li>
              </>
            )}
          </ol>
        </nav>
      </div>

      <article className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <header className="flex flex-col gap-5 border-b border-zinc-200 pb-8 sm:flex-row sm:items-start dark:border-zinc-800">
            <CompanyLogo company={job.company} logoUrl={job.company_logo_url} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                {job.company_url ? (
                  <a
                    href={job.company_url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="underline-offset-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
                  >
                    {job.company}
                  </a>
                ) : (
                  job.company
                )}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{job.title}</h1>
              <ul
                aria-label="Role summary"
                className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400"
              >
                {[
                  { key: "location", label: locationSummary.display || job.location, title: locationSummary.extra > 0 ? locationSummary.full : undefined },
                  { key: "workplace", label: WORKPLACE_LABELS[job.workplace_type] },
                  { key: "type", label: JOB_TYPE_LABELS[job.job_type] },
                  ...(salary ? [{ key: "salary", label: salary, emphasis: true }] : []),
                ].map((item) => (
                  <li key={item.key} className="meta-item">
                    <span
                      title={"title" in item ? item.title : undefined}
                      className={"emphasis" in item ? "font-medium text-zinc-800 dark:text-zinc-200" : undefined}
                    >
                      {item.label}
                    </span>
                  </li>
                ))}
              </ul>
              {job.is_featured && (
                <span className="mt-3 inline-flex rounded-full bg-accent-700 px-2 py-0.5 text-xs font-medium text-white">
                  Featured
                </span>
              )}
              <TagList tags={job.tags} hrefForTag={hrefForTag} className="mt-4" />
              {/* Mobile Apply lives in the sticky bar below; only the no-link notice shows here. */}
              {!applyHref && applyButton("mt-6 lg:hidden")}
            </div>
          </header>

          <div className="py-8">
            <Markdown>{job.description}</Markdown>
          </div>

          <div className="hidden border-t border-zinc-200 pt-8 lg:block dark:border-zinc-800">{applyButton("w-full sm:w-auto")}</div>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <section
            aria-labelledby="job-details-heading"
            className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
          >
            <h2 id="job-details-heading" className="text-sm font-semibold">
              Role details
            </h2>
            <dl className="mt-3 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
              {details.map((item) => (
                <div key={item.label} className="flex justify-between gap-4 py-2">
                  <dt className="text-zinc-500 dark:text-zinc-400">{item.label}</dt>
                  <dd className="text-right font-medium">{item.value}</dd>
                </div>
              ))}
            </dl>
            {applyButton("mt-4 hidden w-full lg:flex")}
          </section>

          <SourceAttribution applyUrl={job.apply_url} company={job.company} slug={job.slug} />

          <SubscribeCard source="job-page" idPrefix="job-digest" />
        </aside>
      </article>

      {applyHref && (
        <>
          {/* Sticky (not fixed): pins to the viewport bottom while reading, then rests in
              normal flow above the footer, so it never covers content or the footer. */}
          <div
            data-testid="mobile-apply-bar"
            className="sticky bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
          >
            <div className="mx-auto max-w-6xl sm:px-2">{applyButton("w-full")}</div>
          </div>
        </>
      )}
    </>
  );
}
