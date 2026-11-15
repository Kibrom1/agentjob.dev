/**
 * Paid job posting is gated behind PAYMENTS_ENABLED so the board can launch
 * with Stripe shown as "coming soon". It is OFF unless the variable is exactly
 * "true". Read at call time (never at import) like the rest of the env config.
 */
export function isPostingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PAYMENTS_ENABLED?.trim().toLowerCase() === "true";
}
