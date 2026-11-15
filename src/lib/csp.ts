/**
 * Content-Security-Policy, REPORT-ONLY. Nothing is blocked; violations are
 * POSTed to /api/csp-report. Static (no nonce) so pages are not forced into
 * dynamic rendering; see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
 * ("Without Nonces").
 *
 * - default-src 'self'            fallback: same-origin only.
 * - script-src 'self' 'unsafe-inline'  Next inline bootstrap/flight scripts and the
 *                                 JSON-LD <script> need inline; no third-party scripts exist.
 *                                 'unsafe-eval' only in dev (React debugging).
 * - style-src 'self' 'unsafe-inline'   Next/Tailwind and style attributes.
 * - img-src 'self' data: https:   company logos/avatars may come from any https host.
 * - font-src 'self' data:         next/font self-hosts fonts.
 * - connect-src 'self'            fetch/RSC only to our own origin (dev adds ws: for HMR).
 * - object-src 'none'             no plugins.
 * - frame-ancestors 'none'        no embedding (matches X-Frame-Options: DENY).
 * - form-action 'self' https://checkout.stripe.com  Stripe Checkout redirect after a form POST.
 * - base-uri 'self'               blocks <base> injection.
 * - report-uri /api/csp-report    violation sink.
 */
export function buildContentSecurityPolicy(isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://checkout.stripe.com",
    "base-uri 'self'",
    "report-uri /api/csp-report",
  ].join("; ");
}
