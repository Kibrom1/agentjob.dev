import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ getAdminDbClient: () => ({ rpc }) }));

import { proxy } from "@/proxy";

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
const req = (authorization?: string) =>
  new NextRequest("https://x.dev/admin", { headers: authorization ? { authorization } : {} });

describe("admin proxy", () => {
  it("503s (never leaking rate-limit internals) when the admin console is disabled", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "");
    const response = await proxy(req());
    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes through on correct credentials without ever consuming the rate-limit bucket", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "correct horse battery staple");
    vi.stubEnv("ADMIN_USERNAME", "root");
    rpc.mockResolvedValue({ data: true, error: null });

    const response = await proxy(req(basic("root", "correct horse battery staple")));

    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("401s on wrong credentials while the failed-attempt bucket has room", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "correct horse battery staple");
    vi.stubEnv("ADMIN_USERNAME", "root");
    rpc.mockResolvedValueOnce({ data: true, error: null });

    const response = await proxy(req(basic("root", "wrong password")));

    expect(response.status).toBe(401);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[1].p_key).toMatch(/^admin-auth:/);
  });

  it("429s before revealing anything further once the failed-attempt bucket is exceeded", async () => {
    vi.stubEnv("ADMIN_PASSWORD", "correct horse battery staple");
    vi.stubEnv("ADMIN_USERNAME", "root");
    rpc.mockResolvedValueOnce({ data: false, error: null });

    const response = await proxy(req(basic("root", "wrong password")));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });
});
