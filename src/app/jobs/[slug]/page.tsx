import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyLogo } from "@/components/company-logo";
import { JsonLd } from "@/components/json-ld";
import { Markdown } from "@/components/markdown";
import { SubscribeCard } from "@/components/subscribe-card";
import { TagList } from "@/components/tag-list";
import { buildApplyHref, formatDate, formatSalaryRange } from "@/lib/format";
import { getJobBySlug } from "@/lib/jobs";
import { buildJobSearchHref } from "@/lib/search-params";
import { absoluteUrl, siteConfig } from "@/lib/site";
import { JOB_TYPE_LABELS, WORKPLACE_LABELS, type JobDetail, type JobType } from "@/lib/types";

// Rendered on first request, then served from cache and refreshed at most
// every five minutes (ISR). Payment webhooks can revalidate a path instantly.
export const revalidate = 300;

export function generateStaticParams(): Array<{ slug: string }> {
  return [];
}

type JobPageProps = {
  params: Promise<{ slug: string }>;
};

function excerpt(markdown: string, maxLength = 160): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLength) return plain;
  const cut = plain.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 80 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export async function generateMetadata({ params }: JobPageProps): Promise<Metadata> {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job) return { title: "Job not found", robots: { index: false, follow: true } };

  const title = `${job.title} at ${job.company}`;
  const description = excerpt(job.description);
  const path = `/jobs/${job.slug}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "article", title, description, url: path, publishedTime: job.published_at },
    twitter: { card: "summary", title, description },
  };
}

const SCHEMA_EMPLOYMENT_TYPE: Record<JobType, string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACTOR",
  internship: "INTERN",
};

function jobPostingJsonLd(job: JobDetail): Record<string, unknown> {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description,
    identifier: { "@type": "PropertyValue", name: siteConfig.name, value: job.id },
    datePosted: job.published_at,
    validThrough: job.expires_at,
    employmentType: SCHEMA_EMPLOYMENT_TYPE[job.job_type],
    url: absoluteUrl(`/jobs/${job.slug}`),
    hiringOrganization: {
      "@type": "Organization",
      name: job.company,
      ...(job.company_url ? { sameAs: job.company_url } : {}),
      ...(job.company_logo_url ? { logo: job.company_logo_url } : {}),
    },
    directApply: false,
  };

  if (job.workplace_type === "remote") {
    data.jobLocationType = "TELECOMMUTE";
  }
  if (job.workplace_type !== "remote" || !/^remote\b/i.test(job.location)) {
    data.jobLocation = {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: job.location },
    };
  }

  if (job.salary_min !== null || job.salary_max !== null) {
    data.baseSalary = {
      "@type": "MonetaryAmount",
      currency: job.salary_currency,
      value: {
        "@type": "QuantitativeValue",
        unitText: "YEAR",
        ...(job.salary_min !== null ? { minValue: job.salary_min } : {}),
        ...(job.salary_max !== null ? { maxValue: job.salary_max } : {}),
      },
    };
  }

  return data;
}

export default async function JobPage({ params }: JobPageProps) {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job) notFound();

  const applyHref = buildApplyHref(job.apply_url, job.title, siteConfig.domain);
  const salary = formatSalaryRange(job.salary_min, job.salary_max, job.salary_currency);
  const hrefForTag = (tag: string): Route => buildJobSearchHref({ page: 1 }, { tag });

  const details: Array<{ label: string; value: string }> = [
    { label: "Location", value: job.location },
    { label: "Workplace", value: WORKPLACE_LABELS[job.workplace_type] },
    { label: "Employment", value: JOB_TYPE_LABELS[job.job_type] },
    ...(salary ? [{ label: "Salary", value: salary }] : []),
    ...(job.category ? [{ label: "Category", value: job.category.name }] : []),
    { label: "Posted", value: formatDate(job.published_at) },
    { label: "Open until", value: formatDate(job.expires_at) },
  ];

  const applyButton = (className: string) =>
    applyHref ? (
      <a
        href={applyHref}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent-600 px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-700 ${className}`}
      >
        Apply for this role
        <span aria-hidden="true">↗</span>
      </a>
    ) : (
      <p className={`text-sm text-zinc-500 ${className}`}>Applications for this role are handled directly by {job.company}.</p>
    );

  return (
    <>
      <JsonLd data={jobPostingJsonLd(job)} />

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
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                {job.location} · {WORKPLACE_LABELS[job.workplace_type]} · {JOB_TYPE_LABELS[job.job_type]}
                {salary && (
                  <>
                    {" · "}
                    <span className="font-medium text-zinc-800 dark:text-zinc-200">{salary}</span>
                  </>
                )}
              </p>
              {job.is_featured && (
                <span className="mt-3 inline-flex rounded-full bg-accent-600 px-2 py-0.5 text-xs font-medium text-white">
                  Featured
                </span>
              )}
              <TagList tags={job.tags} hrefForTag={hrefForTag} className="mt-4" />
              {applyButton("mt-6 w-full sm:w-auto lg:hidden")}
            </div>
          </header>

          <div className="py-8">
            <Markdown>{job.description}</Markdown>
          </div>

          <div className="border-t border-zinc-200 pt-8 dark:border-zinc-800">{applyButton("w-full sm:w-auto")}</div>
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

          <SubscribeCard source="job-page" idPrefix="job-digest" />
        </aside>
      </article>
    </>
  );
}
