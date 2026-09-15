import { createHash } from "node:crypto";

/**
 * Best-effort client address from proxy headers. On Vercel the first entry of
 * x-forwarded-for is set by the platform edge and cannot be spoofed by the
 * client; elsewhere it is advisory, which is acceptable for rate limiting.
 */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const real = headers.get("x-real-ip")?.trim();
  return real || "unknown";
}

/** Rate-limit bucket key; the address is hashed so raw IPs are never stored. */
export function rateLimitKey(scope: string, address: string): string {
  const digest = createHash("sha256").update(address).digest("hex").slice(0, 32);
  return `${scope}:${digest}`;
}
