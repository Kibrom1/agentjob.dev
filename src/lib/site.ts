import { z } from "zod";

/**
 * Resolves the canonical public origin. Order of precedence:
 *   1. NEXT_PUBLIC_SITE_URL (explicit, recommended for production)
 *   2. VERCEL_PROJECT_PRODUCTION_URL (auto-set on Vercel)
 *   3. http://localhost:3000 (local development)
 * An invalid explicit value fails loudly instead of producing broken canonical URLs.
 */
function resolveSiteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) {
    const parsed = z.url({ protocol: /^https?$/ }).safeParse(explicit);
    if (!parsed.success) {
      throw new Error(`NEXT_PUBLIC_SITE_URL must be an absolute http(s) URL, received "${explicit}".`);
    }
    return new URL(parsed.data);
  }

  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelHost) {
    return new URL(`https://${vercelHost}`);
  }

  return new URL("http://localhost:3000");
}

export const siteConfig = {
  name: "AgentJobs",
  domain: "agentjobs.dev",
  tagline: "Jobs for engineers who build AI agents",
  description:
    "Hand-picked roles for AI agent and multi-agent systems engineers: orchestration, tool-use backends, local LLM infrastructure, evals and more.",
  url: resolveSiteUrl(),
  pageSize: 30,
  maxPage: 200,
} as const;

export function absoluteUrl(path: string): string {
  return new URL(path, siteConfig.url).toString();
}

/**
 * Origin for links that must return to *this* deployment (Stripe redirect
 * URLs). Preview deployments use their own URL so a checkout started on a
 * preview never lands on production.
 */
export function deploymentOrigin(): string {
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return siteConfig.url.origin;
}
