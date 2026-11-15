import { resolveCountry, resolvePlace, isRemoteLabel, type Country } from "@/lib/geo";
import { formatLocationSummary, formatSalaryRange, splitLocations } from "@/lib/format";
import { markdownToHtml, markdownToPlainText } from "@/lib/markdown-html";
import { absoluteUrl, siteConfig } from "@/lib/site";
import { WORKPLACE_LABELS, type JobDetail, type JobType } from "@/lib/types";

const SCHEMA_EMPLOYMENT_TYPE: Record<JobType, string> = {
  full_time: "FULL_TIME",
  part_time: "PART_TIME",
  contract: "CONTRACTOR",
  internship: "INTERN",
};

function isoDate(value: string | null | undefined, now: number): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  if (Number.isNaN(time) || time > now + 24 * 3600 * 1000) return null;
  return new Date(time).toISOString();
}

function place(parts: NonNullable<ReturnType<typeof resolvePlace>>): Record<string, unknown> {
  return {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      addressLocality: parts.locality,
      ...(parts.region ? { addressRegion: parts.region } : {}),
      addressCountry: parts.country.code,
    },
  };
}

function countryNode(country: Country): Record<string, unknown> {
  return { "@type": "Country", name: country.code };
}

/**
 * JobPosting structured data for Google for Jobs.
 *
 * `validThrough` is intentionally NOT derived from `expires_at`: for ingested
 * roles that column is a rolling retention horizon that is bumped on every
 * ingest run, not a date the employer set. Publishing it would claim a close
 * date nobody chose. Pass `closesAt` only for a real, employer-supplied date.
 */
export function buildJobPostingJsonLd(
  job: JobDetail,
  options: { closesAt?: string | null; now?: number } = {},
): Record<string, unknown> {
  const now = options.now ?? Date.now();
  const html = markdownToHtml(job.description);
  const datePosted = isoDate(job.published_at, now);
  const validThrough = isoDate(options.closesAt, Number.POSITIVE_INFINITY);

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: html || `<p>${job.title} at ${job.company}.</p>`,
    identifier: { "@type": "PropertyValue", name: siteConfig.name, value: job.id },
    ...(datePosted ? { datePosted } : {}),
    ...(validThrough ? { validThrough } : {}),
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

  const locations = splitLocations(job.location);
  const places = locations
    .filter((location) => !isRemoteLabel(location))
    .map(resolvePlace)
    .filter((p): p is NonNullable<typeof p> => p !== null);

  if (job.workplace_type === "remote") {
    // Google requires the countries a remote worker may live in. Claim
    // TELECOMMUTE only when the listing says which.
    const countries = new Map<string, Country>();
    for (const location of locations) {
      const country = resolveCountry(location);
      if (country) countries.set(country.code, country);
    }
    if (countries.size > 0) {
      data.jobLocationType = "TELECOMMUTE";
      data.applicantLocationRequirements = [...countries.values()].map(countryNode);
    }
  }
  if (places.length > 0) {
    data.jobLocation = places.length === 1 ? place(places[0]!) : places.map(place);
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

export function buildBreadcrumbJsonLd(items: Array<{ name: string; path: string }>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function buildWebSiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    url: absoluteUrl("/"),
    description: siteConfig.description,
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${absoluteUrl("/")}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

const META_MAX = 160;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Unique, specific meta description: "{Title} at {Company} · {location}, {workplace}
 * · {salary} · {stack}. {first sentence of the role}", clipped to 160 characters.
 */
export function buildJobMetaDescription(job: JobDetail): string {
  const location = formatLocationSummary(job.location).display;
  const workplace = WORKPLACE_LABELS[job.workplace_type];
  const salary = formatSalaryRange(job.salary_min, job.salary_max, job.salary_currency);
  const where = location && !location.toLowerCase().includes(workplace.toLowerCase()) ? `${location}, ${workplace}` : location || workplace;
  const stack = job.tags.slice(0, 4).join(", ");

  const facts = [where, salary, stack ? `Stack: ${stack}` : ""].filter(Boolean).join(" · ");
  const head = `${job.title} at ${job.company}. ${facts}.`;
  const room = META_MAX - head.length - 1;
  if (room < 40) return clip(head, META_MAX);

  const plain = markdownToPlainText(job.description);
  // Skip the generic "About {company}" boilerplate when a later sentence exists.
  const sentences = plain.split(/(?<=[.!?])\s+/).filter((s) => s.length > 30);
  const lead = sentences.find((s) => !new RegExp(`^about\\s+${job.company}`, "i").test(s)) ?? sentences[0] ?? "";
  return lead ? clip(`${head} ${lead}`, META_MAX) : head;
}
