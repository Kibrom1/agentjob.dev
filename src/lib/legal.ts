/**
 * Legal and contact details shown on /terms, /privacy, /refund, /about and in
 * the footer. EVERY value is a placeholder until the owner (and a lawyer)
 * fills it in. `scripts/check-launch-placeholders.sh` fails while any
 * `[[PLACEHOLDER` token remains in `src`.
 *
 * Draft for counsel review: retention periods stated on /privacy mirror
 * run_maintenance() (supabase/migrations/20261116000400_data_retention.sql);
 * change both together.
 */
export const PLACEHOLDER_PREFIX = "[[PLACEHOLDER";

export const legalConfig = {
  companyName: "Bright Steps Digital",
  contactEmail: "brightstepsdigitalllc@gmail.com",
  privacyEmail: "brightstepsdigitalllc@gmail.com",
  // Online-only business. The website shows NO address by default. Set
  // PUBLIC_POSTAL_ADDRESS only if you want one published in the footer and
  // privacy policy. This is deliberately separate from POSTAL_ADDRESS, which
  // is the sender address printed in digest emails (CAN-SPAM) and is never
  // rendered on the site, so a home address used for email stays off the web.
  postalAddress: process.env.PUBLIC_POSTAL_ADDRESS?.trim() ?? "",
  // Business days within which we act on a removal/takedown request and reply.
  // Operational commitment, not a legal conclusion; keep it in step with
  // docs/runbooks (block_company) and the copy on /terms, /privacy and /about.
  takedownResponse: "3 business days",
  jurisdiction: "[[PLACEHOLDER: governing law and jurisdiction]]",
  lastUpdated: "[[PLACEHOLDER: date these terms were last reviewed]]",
} as const;

export type LegalConfig = typeof legalConfig;

export function isPlaceholder(value: string): boolean {
  return value.includes(PLACEHOLDER_PREFIX);
}

/** True while any legal value is still an unfilled placeholder. */
export function hasPlaceholders(config: Record<string, string> = legalConfig): boolean {
  return Object.values(config).some(isPlaceholder);
}

export const LEGAL_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refund", label: "Refund policy" },
  { href: "/about", label: "About" },
] as const;

export const LEGAL_PATHS: string[] = LEGAL_LINKS.map((link) => link.href);
