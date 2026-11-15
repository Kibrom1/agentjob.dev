import { LegalValue } from "@/components/legal-page";
import { isPlaceholder, legalConfig } from "@/lib/legal";
import { buildRemovalMailto, getSourceInfo } from "@/lib/source-attribution";

type SourceAttributionProps = {
  applyUrl: string | null;
  company: string;
  slug: string;
};

const linkClass = "underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100";

export function SourceAttribution({ applyUrl, company, slug }: SourceAttributionProps) {
  const source = getSourceInfo(applyUrl);
  const email = legalConfig.contactEmail;

  const removalLink = isPlaceholder(email) ? (
    <LegalValue value={email} />
  ) : (
    <a href={buildRemovalMailto(email, slug)} className={linkClass}>
      Request removal
    </a>
  );

  return (
    <section
      aria-labelledby="job-source-heading"
      className="rounded-xl border border-zinc-200 p-5 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400"
    >
      <h2 id="job-source-heading" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Source
      </h2>
      {source && (
        <p className="mt-2">
          Application hosted on {source.provider}. Applications are handled by {company} there, not by AgentJob.
        </p>
      )}
      <p className="mt-2">
        {source ? "Listing wrong or want it removed? " : "Report this listing: "}
        {removalLink}
      </p>
    </section>
  );
}
