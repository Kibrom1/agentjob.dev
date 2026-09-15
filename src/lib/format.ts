const compactFormatters = new Map<string, Intl.NumberFormat>();

function compactCurrency(currency: string): Intl.NumberFormat | null {
  const cached = compactFormatters.get(currency);
  if (cached) return cached;
  try {
    const formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
    compactFormatters.set(currency, formatter);
    return formatter;
  } catch {
    // Unknown ISO code (RangeError); caller falls back to a plain rendering.
    return null;
  }
}

function formatAmount(amount: number, currency: string): string {
  const formatter = compactCurrency(currency);
  if (formatter) return formatter.format(amount);
  return `${currency} ${new Intl.NumberFormat("en-US").format(amount)}`;
}

/** "$180K – $240K", "From $150K", "Up to $90K", or null when unknown. */
export function formatSalaryRange(min: number | null, max: number | null, currency: string): string | null {
  if (min !== null && max !== null) {
    return min === max ? formatAmount(min, currency) : `${formatAmount(min, currency)} – ${formatAmount(max, currency)}`;
  }
  if (min !== null) return `From ${formatAmount(min, currency)}`;
  if (max !== null) return `Up to ${formatAmount(max, currency)}`;
  return null;
}

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "always", style: "narrow" });

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3h ago", "2w ago", "just now". Future timestamps (clock skew) read as "just now". */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "";
  const elapsedSeconds = Math.round((now - timestamp) / 1000);
  if (elapsedSeconds < 60) return "just now";

  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (elapsedSeconds >= seconds) {
      return relativeFormatter.format(-Math.floor(elapsedSeconds / seconds), unit);
    }
  }
  return "just now";
}

const absoluteFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function formatDate(iso: string): string {
  const timestamp = Date.parse(iso);
  return Number.isNaN(timestamp) ? "" : absoluteFormatter.format(timestamp);
}

/** Up to two initials for logo fallbacks: "Acme Agents" → "AA". */
export function companyInitials(company: string): string {
  const letters = company
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("");
  return (letters || "?").toUpperCase();
}

/**
 * Adds attribution to outbound apply links so employers can see where
 * candidates came from. Existing UTM params are respected and mailto links get
 * a subject line. Returns null for anything that is not http(s)/mailto, so a
 * bad value can never become a clickable `javascript:` link even if it slipped
 * past the database constraint.
 */
export function buildApplyHref(applyUrl: string, jobTitle: string, siteDomain: string): string | null {
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(applyUrl)) {
    if (applyUrl.includes("?")) return applyUrl;
    return `${applyUrl}?subject=${encodeURIComponent(`Application: ${jobTitle} (via ${siteDomain})`)}`;
  }

  try {
    const url = new URL(applyUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.searchParams.has("utm_source")) {
      url.searchParams.set("utm_source", siteDomain);
      url.searchParams.set("utm_medium", "job_board");
    }
    return url.toString();
  } catch {
    return null;
  }
}
