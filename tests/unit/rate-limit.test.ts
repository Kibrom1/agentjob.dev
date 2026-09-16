import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ getAdminDbClient: () => ({ rpc }) }));

import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

describe("consumeRateLimit", () => {
  it("accepts headers directly, for callers outside next/headers' request scope (e.g. middleware)", async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });

    const allowed = await consumeRateLimit(RATE_LIMITS.adminAuth, headers);

    expect(allowed).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "consume_rate_limit",
      expect.objectContaining({ p_limit: RATE_LIMITS.adminAuth.limit, p_window_seconds: RATE_LIMITS.adminAuth.windowSeconds }),
    );
  });

  it("denies once the bucket is exceeded", async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });

    expect(await consumeRateLimit(RATE_LIMITS.adminAuth, headers)).toBe(false);
  });

  it("scopes admin-auth and jobs-recent to their own buckets, distinct from other scopes", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });

    await consumeRateLimit(RATE_LIMITS.adminAuth, headers);
    await consumeRateLimit(RATE_LIMITS.jobsRecent, headers);

    const keys = rpc.mock.calls.map(([, args]) => args.p_key);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toMatch(/^admin-auth:/);
    expect(keys[1]).toMatch(/^jobs-recent:/);
  });

  it("fails open when the limiter RPC errors", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "500", message: "boom" } });
    expect(await consumeRateLimit(RATE_LIMITS.jobsRecent, new Headers())).toBe(true);
  });
});
