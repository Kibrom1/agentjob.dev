import { describe, expect, it, vi } from "vitest";
import { constantTimeEqual, isAuthorizedAdmin, parseBasicAuth, readAdminConfig } from "@/lib/admin/auth";
import { toIlikePattern } from "@/lib/admin/jobs";
import { isAuthorizedCron, requireCronAuth } from "@/lib/cron-auth";
import { clientAddress, rateLimitKey } from "@/lib/request-meta";

vi.mock("@/lib/supabase/admin", () => ({ getAdminDbClient: vi.fn() }));

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

describe("admin basic auth", () => {
  const config = readAdminConfig({ ADMIN_USERNAME: "root", ADMIN_PASSWORD: "correct horse battery" });

  it("is disabled without a strong password", () => {
    expect(readAdminConfig({}).enabled).toBe(false);
    expect(readAdminConfig({ ADMIN_PASSWORD: "short" }).enabled).toBe(false);
    const defaults = readAdminConfig({ ADMIN_PASSWORD: "long-enough-pass" });
    expect(defaults.enabled && defaults.credentials.username).toBe("admin");
  });

  it("parses Basic headers including colons and unicode in the password", () => {
    expect(parseBasicAuth(basic("root", "p:ä:ss"))).toEqual({ username: "root", password: "p:ä:ss" });
    expect(parseBasicAuth(null)).toBeNull();
    expect(parseBasicAuth("Bearer abc")).toBeNull();
    expect(parseBasicAuth("Basic !!!")).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from("nocolon").toString("base64")}`)).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from([0xff, 0xfe, 0x3a]).toString("base64")}`)).toBeNull();
  });

  it("authorises only exact credentials", async () => {
    expect(await isAuthorizedAdmin(basic("root", "correct horse battery"), config)).toBe(true);
    expect(await isAuthorizedAdmin(basic("root", "correct horse batter"), config)).toBe(false);
    expect(await isAuthorizedAdmin(basic("Root", "correct horse battery"), config)).toBe(false);
    expect(await isAuthorizedAdmin(undefined, config)).toBe(false);
    expect(await isAuthorizedAdmin(basic("admin", ""), readAdminConfig({}))).toBe(false);
  });

  it("compares strings by digest", async () => {
    expect(await constantTimeEqual("abc", "abc")).toBe(true);
    expect(await constantTimeEqual("abc", "abcd")).toBe(false);
    expect(await constantTimeEqual("", "")).toBe(true);
  });
});

describe("cron auth", () => {
  it("requires the exact bearer secret", () => {
    vi.stubEnv("CRON_SECRET", "0123456789abcdef-secret");
    const request = (value?: string) => new Request("https://x.dev/api/cron/digest", { headers: value ? { authorization: value } : {} });
    expect(isAuthorizedCron(request("Bearer 0123456789abcdef-secret"))).toBe(true);
    expect(isAuthorizedCron(request("Bearer 0123456789abcdef-secreT"))).toBe(false);
    expect(isAuthorizedCron(request("0123456789abcdef-secret"))).toBe(false);
    expect(isAuthorizedCron(request())).toBe(false);
  });

  it("refuses to run with a weak or missing secret", () => {
    vi.stubEnv("CRON_SECRET", "short");
    expect(() => isAuthorizedCron(new Request("https://x.dev"))).toThrow(/CRON_SECRET/);
  });
});

describe("requireCronAuth", () => {
  it("returns null (proceed) for a correctly authenticated request", () => {
    vi.stubEnv("CRON_SECRET", "0123456789abcdef-secret");
    const request = new Request("https://x.dev/api/cron/digest", {
      headers: { authorization: "Bearer 0123456789abcdef-secret" },
    });
    expect(requireCronAuth(request)).toBeNull();
  });

  it("returns a generic 401 for a wrong/missing bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "0123456789abcdef-secret");
    const response = requireCronAuth(new Request("https://x.dev/api/cron/digest"));
    expect(response).not.toBeNull();
    expect(response?.status).toBe(401);
    expect(await response?.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns a generic 401 — never the env-var detail — when CRON_SECRET is unset/misconfigured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = requireCronAuth(new Request("https://x.dev/api/cron/digest"));
    expect(response).not.toBeNull();
    expect(response?.status).toBe(401);
    const body = await response?.json();
    expect(body).toEqual({ error: "Unauthorized" });
    expect(JSON.stringify(body)).not.toMatch(/CRON_SECRET/);
  });
});

describe("request metadata", () => {
  it("uses the first forwarded address", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientAddress(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientAddress(new Headers())).toBe("unknown");
  });

  it("hashes addresses into scoped keys", () => {
    const key = rateLimitKey("post-job", "203.0.113.9");
    expect(key).toMatch(/^post-job:[0-9a-f]{32}$/);
    expect(key).not.toContain("203.0.113.9");
    expect(rateLimitKey("post-job", "203.0.113.9")).toBe(key);
    expect(rateLimitKey("subscribe", "203.0.113.9")).not.toBe(key);
  });
});

describe("admin search pattern", () => {
  it("strips wildcards and PostgREST syntax", () => {
    expect(toIlikePattern("  agent  engineer ")).toBe('"%agent engineer%"');
    expect(toIlikePattern('100%_,title.eq.x),("\\')).toBe('"%100 title.eq.x%"');
    expect(toIlikePattern("x".repeat(300))).toHaveLength(104);
  });
});

describe("content security policy (report-only)", () => {
  it("ships report-only with the expected directives and no enforcing header", async () => {
    const { buildContentSecurityPolicy } = await import("@/lib/csp");
    const src = (await import("node:fs")).readFileSync("next.config.ts", "utf8");
    expect(src).toContain('key: "Content-Security-Policy-Report-Only"');
    expect(src).not.toMatch(/key: "Content-Security-Policy"/);
    const directives = buildContentSecurityPolicy(false).split("; ");
    expect(directives.join(";")).not.toContain("unsafe-eval");
    expect(buildContentSecurityPolicy(true)).toContain("'unsafe-eval'");
    for (const d of [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self' https://checkout.stripe.com",
      "base-uri 'self'",
      "report-uri /api/csp-report",
    ]) {
      expect(directives.some((x) => x.startsWith(d))).toBe(true);
    }
  });
});

describe("csp-report route", () => {
  const post = async (body: BodyInit | null, headers: HeadersInit = {}) => {
    const { POST } = await import("@/app/api/csp-report/route");
    return POST(new Request("https://x.dev/api/csp-report", { method: "POST", body, headers }));
  };

  it("204s on a legacy report and logs scrubbed fields only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const res = await post(
      JSON.stringify({
        "csp-report": {
          "document-uri": "https://x.dev/jobs/a?token=secret",
          "violated-directive": "img-src",
          "blocked-uri": "https://evil.test/p.png?u=me",
        },
      }),
    );
    expect(res.status).toBe(204);
    const logged = String(warn.mock.calls[0]?.[1]);
    expect(logged).not.toContain("secret");
    expect(logged).not.toContain("u=me");
    warn.mockRestore();
  });

  it("never throws on garbage and rejects oversized bodies", async () => {
    expect((await post("not json")).status).toBe(204);
    expect((await post(null)).status).toBe(204);
    expect((await post("x".repeat(9 * 1024))).status).toBe(413);
    expect((await post("{}", { "content-length": "999999" })).status).toBe(413);
  });
});
