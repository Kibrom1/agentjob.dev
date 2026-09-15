import "server-only";
import { headers } from "next/headers";
import { clientAddress, rateLimitKey } from "@/lib/request-meta";
import { getAdminDbClient } from "@/lib/supabase/admin";

export type RateLimitPolicy = {
  scope: "subscribe" | "post-job" | "unsubscribe";
  limit: number;
  windowSeconds: number;
};

export const RATE_LIMITS = {
  subscribe: { scope: "subscribe", limit: 5, windowSeconds: 3600 },
  postJob: { scope: "post-job", limit: 10, windowSeconds: 3600 },
  unsubscribe: { scope: "unsubscribe", limit: 30, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitPolicy>;

/**
 * Consumes one request from the caller's bucket. Fails open: if the limiter
 * itself is unavailable (missing service key, database hiccup) the request is
 * allowed and the problem is logged — losing a paying employer or subscriber
 * costs more than an occasional unthrottled request.
 */
export async function consumeRateLimit(policy: RateLimitPolicy): Promise<boolean> {
  try {
    const key = rateLimitKey(policy.scope, clientAddress(await headers()));
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
