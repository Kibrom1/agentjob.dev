import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const vercelTrack = vi.fn();
vi.mock("@vercel/analytics", () => ({ track: (...args: unknown[]) => vercelTrack(...args) }));

import { track } from "@/lib/analytics";

describe("track", () => {
  it("forwards typed events and properties", () => {
    track("digest_signup", { source: "website" });
    track("apply_click", { placement: "sidebar", slug: "agent-engineer-1" });
    track("post_job_interest", { action: "waitlist_submit" });
    expect(vercelTrack.mock.calls).toEqual([
      ["digest_signup", { source: "website" }],
      ["apply_click", { placement: "sidebar", slug: "agent-engineer-1" }],
      ["post_job_interest", { action: "waitlist_submit" }],
    ]);
  });

  it("never throws into the page", () => {
    vercelTrack.mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(() => track("digest_signup", { source: "job-page" })).not.toThrow();
  });
});

describe("analytics wiring", () => {
  it("mounts <Analytics /> in the root layout", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain('from "@vercel/analytics/next"');
    expect(layout).toContain("<Analytics />");
  });

  it("pins @vercel/analytics to an exact version", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@vercel/analytics"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("keeps event properties free of personal data", () => {
    const events = readFileSync("src/lib/analytics.ts", "utf8").split("export type AnalyticsEvents")[1]!.split("};")[0]!;
    expect(events).not.toMatch(/email|company|name|phone|note/i);
  });

  it("needs no extra CSP origin: analytics is first-party in production", async () => {
    const { buildContentSecurityPolicy } = await import("@/lib/csp");
    const policy = buildContentSecurityPolicy(false);
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain("vercel-scripts.com");
  });
});
