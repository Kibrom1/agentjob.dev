/**
 * Single source of truth for what employers pay. Amounts are in the smallest
 * currency unit and are sent to Stripe from the server only; the webhook
 * re-checks the paid subtotal against these values before publishing.
 */
export const PRICING = {
  currency: "usd",
  listing: {
    amount: 14_900,
    durationDays: 30,
    name: "AgentJob.dev job listing (30 days)",
  },
  featured: {
    amount: 9_900,
    name: "Featured placement (pinned for 30 days)",
  },
} as const;

export type Plan = "standard" | "featured";

export function planFor(featured: boolean): Plan {
  return featured ? "featured" : "standard";
}

export function isPlan(value: unknown): value is Plan {
  return value === "standard" || value === "featured";
}

/** Expected pre-discount subtotal for a plan, in cents. */
export function planSubtotal(plan: Plan): number {
  return PRICING.listing.amount + (plan === "featured" ? PRICING.featured.amount : 0);
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
