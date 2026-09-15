import type { Metadata } from "next";
import { PostJobForm } from "@/components/post-job/post-job-form";
import { listCategories } from "@/lib/jobs";
import { PRICING, formatUsd } from "@/lib/posting/pricing";
import { siteConfig } from "@/lib/site";

export const metadata: Metadata = {
  title: "Post a job",
  description: `Reach engineers who build AI agents. ${formatUsd(PRICING.listing.amount)} for ${PRICING.listing.durationDays} days on ${siteConfig.domain}.`,
  alternates: { canonical: "/post-a-job" },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const BENEFITS = [
  "Seen only by engineers building agents, tool-use backends and LLM infrastructure",
  `Live for ${PRICING.listing.durationDays} days and included in the weekly email digest`,
  "Indexed for Google for Jobs with structured data",
  "Goes live the moment payment is confirmed. No approval queue",
];

export default async function PostJobPage({ searchParams }: Props) {
  const params = await searchParams;
  const canceled = params.canceled === "1";
  const categories = await listCategories();

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        <p className="font-mono text-xs tracking-wider text-accent-700 uppercase dark:text-accent-400">For employers</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance">Hire engineers who build AI agents</h1>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Post your role in about five minutes. {formatUsd(PRICING.listing.amount)} for {PRICING.listing.durationDays} days,
          with an optional {formatUsd(PRICING.featured.amount)} featured placement.
        </p>

        {canceled && (
          <p role="status" className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            Checkout was cancelled and you haven&apos;t been charged. Your details are still here when you&apos;re ready.
          </p>
        )}

        <div className="mt-8">
          <PostJobForm categories={categories} restoreDraft={canceled} />
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">What you get</h2>
          <ul className="mt-3 space-y-2.5 text-sm text-zinc-600 dark:text-zinc-400">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex gap-2">
                <span aria-hidden="true" className="text-accent-600">✓</span>
                {benefit}
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-xl bg-zinc-50 p-5 text-sm dark:bg-zinc-900/60">
          <h2 className="font-semibold">Pricing</h2>
          <dl className="mt-3 space-y-1.5">
            <div className="flex justify-between">
              <dt className="text-zinc-600 dark:text-zinc-400">Listing ({PRICING.listing.durationDays} days)</dt>
              <dd className="font-medium">{formatUsd(PRICING.listing.amount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-600 dark:text-zinc-400">Featured add-on</dt>
              <dd className="font-medium">+{formatUsd(PRICING.featured.amount)}</dd>
            </div>
          </dl>
        </section>
      </aside>
    </div>
  );
}
