import type { Metadata, Route } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState } from "@/components/empty-state";
import { FilterChips, type FilterChip } from "@/components/filter-chips";
import { JobCard } from "@/components/job-card";
import { JobSearchBox } from "@/components/job-search-box";
import { Pagination } from "@/components/pagination";
import { SubscribeCard } from "@/components/subscribe-card";
import { listCategories, searchJobs } from "@/lib/jobs";
import { buildJobSearchHref, hasActiveFilters, parseJobSearchParams, type RawSearchParams } from "@/lib/search-params";
import { Constants } from "@/lib/database.types";
import { siteConfig } from "@/lib/site";
import { WORKPLACE_LABELS, type JobSearchFilters } from "@/lib/types";

type HomePageProps = {
  searchParams: Promise<RawSearchParams>;
};

export async function generateMetadata({ searchParams }: HomePageProps): Promise<Metadata> {
  const filters = parseJobSearchParams(await searchParams);
  // Filtered and paginated views are useful to people but duplicate content
  // for crawlers; keep them out of the index while still following links.
  if (hasActiveFilters(filters) || filters.page > 1) {
    return { robots: { index: false, follow: true } };
  }
  return {};
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const filters = parseJobSearchParams(await searchParams);
  const [categories, result] = await Promise.all([listCategories(), searchJobs(filters)]);

  const categoryNames = new Map(categories.map((c) => [c.slug, c.name]));
  const activeCategory = filters.category ? categories.find((c) => c.slug === filters.category) : undefined;
  const filtered = hasActiveFilters(filters);

  const categoryChips: FilterChip[] = [
    { key: "all", label: "All roles", href: buildJobSearchHref(filters, { category: undefined }), active: !filters.category },
    ...categories.map((category) => ({
      key: category.slug,
      label: category.name,
      title: category.description,
      href: buildJobSearchHref(filters, { category: filters.category === category.slug ? undefined : category.slug }),
      active: filters.category === category.slug,
    })),
  ];

  const workplaceChips: FilterChip[] = [
    { key: "any", label: "Anywhere", href: buildJobSearchHref(filters, { workplace: undefined }), active: !filters.workplace },
    ...Constants.public.Enums.workplace_type.map((workplace) => ({
      key: workplace,
      label: WORKPLACE_LABELS[workplace],
      href: buildJobSearchHref(filters, { workplace: filters.workplace === workplace ? undefined : workplace }),
      active: filters.workplace === workplace,
    })),
  ];

  const hrefForTag = (tag: string): Route =>
    buildJobSearchHref(filters, { tag: filters.tag === tag ? undefined : tag });
  const hrefForPage = (page: number): Route => buildJobSearchHref(filters, { page });

  return (
    <>
      <section className="border-b border-zinc-200 bg-gradient-to-b from-zinc-50 to-white dark:border-zinc-800 dark:from-zinc-900/60 dark:to-zinc-950">
        <div className="mx-auto max-w-6xl px-4 pt-12 pb-8 sm:px-6 sm:pt-16">
          <p className="font-mono text-xs tracking-wider text-accent-700 uppercase dark:text-accent-400">
            {siteConfig.domain}
          </p>
          <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
            Jobs for engineers who build <span className="text-accent-600 dark:text-accent-400">AI agents</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base text-pretty text-zinc-600 sm:text-lg dark:text-zinc-400">
            Orchestration, multi-agent systems, tool-use backends and local LLM infrastructure — one focused board, no
            generic “AI” noise.
          </p>
          <div className="mt-8 max-w-2xl">
            <Suspense fallback={<div className="h-12 rounded-xl border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900" />}>
              <JobSearchBox
                preserved={{ category: filters.category, workplace: filters.workplace, tag: filters.tag }}
              />
            </Suspense>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-5">
          <div className="space-y-3">
            <FilterChips label="Filter by category" chips={categoryChips} />
            <FilterChips label="Filter by workplace" chips={workplaceChips} />
          </div>

          <ResultsSummary
            total={result.total}
            filters={filters}
            categoryName={activeCategory?.name}
            clearHref={buildJobSearchHref({ page: 1 })}
            clearTagHref={buildJobSearchHref(filters, { tag: undefined })}
          />

          {result.jobs.length > 0 ? (
            <ol className="space-y-3">
              {result.jobs.map((job) => (
                <li key={job.id}>
                  <JobCard
                    job={job}
                    categoryName={categoryNames.get(job.category_slug)}
                    activeTag={filters.tag}
                    hrefForTag={hrefForTag}
                    now={result.fetchedAt}
                  />
                </li>
              ))}
            </ol>
          ) : filtered ? (
            <EmptyState
              title="No roles match those filters"
              description="Try a broader search term, or remove a filter. New roles are added every day."
              action={{ label: "Clear all filters", href: buildJobSearchHref({ page: 1 }) }}
            />
          ) : filters.page > 1 ? (
            <EmptyState
              title="You've reached the end"
              description="There are no more roles on this page."
              action={{ label: "Back to the first page", href: buildJobSearchHref({ page: 1 }) }}
            />
          ) : (
            <EmptyState
              title="No open roles right now"
              description="Subscribe to the weekly digest and we'll email you as soon as new AI agent roles are posted."
              action={{ label: "Get the weekly digest", href: "/#subscribe" as Route }}
            />
          )}

          <Pagination page={result.page} pageCount={result.pageCount} hrefForPage={hrefForPage} />
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <SubscribeCard source="website" idPrefix="home-digest" />
        </aside>
      </div>
    </>
  );
}

type ResultsSummaryProps = {
  total: number;
  filters: JobSearchFilters;
  categoryName?: string;
  clearHref: Route;
  clearTagHref: Route;
};

function ResultsSummary({ total, filters, categoryName, clearHref, clearTagHref }: ResultsSummaryProps) {
  const noun = total === 1 ? "role" : "roles";
  const context: string[] = [];
  if (filters.query) context.push(`matching “${filters.query}”`);
  if (categoryName) context.push(`in ${categoryName}`);
  if (filters.workplace) context.push(`· ${WORKPLACE_LABELS[filters.workplace]}`);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-zinc-600 dark:text-zinc-400" aria-live="polite">
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">{total.toLocaleString("en-US")}</span> {noun}{" "}
        {context.join(" ")}
      </p>
      <div className="flex items-center gap-2">
        {filters.tag && (
          <Link
            href={clearTagHref}
            scroll={false}
            className="inline-flex items-center gap-1 rounded-md border border-accent-500 bg-accent-50 px-2 py-0.5 font-mono text-xs text-accent-700 hover:bg-accent-100 dark:bg-accent-950 dark:text-accent-400"
          >
            {filters.tag}
            <span aria-hidden="true">×</span>
            <span className="sr-only">Remove tag filter</span>
          </Link>
        )}
        {hasActiveFilters(filters) && (
          <Link
            href={clearHref}
            scroll={false}
            className="text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
          >
            Clear filters
          </Link>
        )}
      </div>
    </div>
  );
}
