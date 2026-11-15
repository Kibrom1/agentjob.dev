/**
 * Legal and contact details shown on /terms, /privacy, /refund, /about and in
 * the footer. EVERY value is a placeholder until the owner (and a lawyer)
 * fills it in. `scripts/check-launch-placeholders.sh` fails while any
 * `[[PLACEHOLDER` token remains in `src`.
 */
export const PLACEHOLDER_PREFIX = "[[PLACEHOLDER";

export const legalConfig = {
  companyName: "Bright Steps Digital",
  contactEmail: "brightstepsdigitalllc@gmail.com",
  privacyEmail: "brightstepsdigitalllc@gmail.com",
  // Online-only business: the website does not need a street address. This is
  // shown (footer, privacy policy) only when POSTAL_ADDRESS is set; an empty
  // string hides it. The digest emails still require POSTAL_ADDRESS (CAN-SPAM),
  // enforced in src/lib/env.ts.
  postalAddress: process.env.POSTAL_ADDRESS?.trim() ?? "",
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
