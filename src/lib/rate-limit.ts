import "server-only";
import { headers } from "next/headers";
import { clientAddress, rateLimitKey } from "@/lib/request-meta";
import { getAdminDbClient } from "@/lib/supabase/admin";

export type RateLimitPolicy = {
  scope: "subscribe" | "post-job" | "unsubscribe" | "admin-auth" | "jobs-recent";
  limit: number;
  windowSeconds: number;
};

export const RATE_LIMITS = {
  subscribe: { scope: "subscribe", limit: 5, windowSeconds: 3600 },
  postJob: { scope: "post-job", limit: 10, windowSeconds: 3600 },
  unsubscribe: { scope: "unsubscribe", limit: 30, windowSeconds: 3600 },
  // Failed admin Basic-auth attempts only (see proxy.ts) — a single shared
  // credential also gates employer PII, so failures get a tight window.
  adminAuth: { scope: "admin-auth", limit: 10, windowSeconds: 900 },
  // Public read-only feed; generous since it's not a mutation, just a
  // backstop against scraping/DoS (unlike the other endpoints above).
  jobsRecent: { scope: "jobs-recent", limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitPolicy>;

/**
 * Consumes one request from the caller's bucket. Fails open: if the limiter
 * itself is unavailable (missing service key, database hiccup) the request is
 * allowed and the problem is logged — losing a paying employer or subscriber
 * costs more than an occasional unthrottled request.
 *
 * `requestHeaders` lets callers outside the Server Component/Action context
 * (e.g. `proxy.ts` middleware, which receives a `NextRequest` directly and
 * cannot call `next/headers`' `headers()`) pass the request's headers in
 * directly. Route handlers and server actions can omit it.
 */
export async function consumeRateLimit(policy: RateLimitPolicy, requestHeaders?: Headers): Promise<boolean> {
  try {
    const hdrs = requestHeaders ?? (await headers());
    const key = rateLimitKey(policy.scope, clientAddress(hdrs));
    const { data, error } = await getAdminDbClient().rpc("consume_rate_limit", {
      p_key: key,
      p_limit: policy.limit,
      p_window_seconds: policy.windowSeconds,
    });
    if (error) {
      console.error("[rate-limit] rpc failed; allowing request", { scope: policy.scope, code: error.code });
      return true;
    }
    return data !== false;
  } catch (cause) {
    console.error("[rate-limit] unavailable; allowing request", { scope: policy.scope, cause });
    return true;
  }
}
