export type SourceProvider = "Greenhouse" | "Ashby" | "Lever";

export type SourceInfo = { provider: SourceProvider; host: string };

/** Exact registrable domains; a host matches itself or any subdomain (dot boundary). */
const PROVIDER_DOMAINS: ReadonlyArray<{ provider: SourceProvider; domains: readonly string[] }> = [
  { provider: "Greenhouse", domains: ["greenhouse.io"] },
  { provider: "Ashby", domains: ["ashbyhq.com"] },
  { provider: "Lever", domains: ["lever.co"] },
];

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Derives the applicant-tracking system from the apply URL host. Returns null
 * for unknown or invalid URLs. Applies equally to ingested and employer-posted
 * jobs, so callers must not claim who originally published the listing.
 */
export function getSourceInfo(applyUrl: string | null | undefined): SourceInfo | null {
  if (!applyUrl) return null;
  let url: URL;
  try {
    url = new URL(applyUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  for (const { provider, domains } of PROVIDER_DOMAINS) {
    if (domains.some((domain) => hostMatches(host, domain))) return { provider, host };
  }
  return null;
}

/** mailto link for a removal/report request. Contains only the slug (no PII). */
export function buildRemovalMailto(email: string, slug: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(`Removal request: ${slug}`)}`;
}
