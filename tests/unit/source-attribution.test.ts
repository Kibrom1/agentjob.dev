import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourceAttribution } from "@/components/source-attribution";
import { siteConfig } from "@/lib/site";
import { buildRemovalMailto, getSourceInfo } from "@/lib/source-attribution";

describe("getSourceInfo", () => {
  it.each([
    ["https://boards.greenhouse.io/acme/jobs/1", "Greenhouse"],
    ["https://job-boards.greenhouse.io/acme/jobs/1", "Greenhouse"],
    ["https://jobs.ashbyhq.com/acme/abc", "Ashby"],
    ["https://jobs.lever.co/acme/abc", "Lever"],
    ["https://JOBS.LEVER.CO/acme/abc", "Lever"],
    ["https://lever.co/acme", "Lever"],
  ])("%s -> %s", (url, provider) => {
    expect(getSourceInfo(url)?.provider).toBe(provider);
  });

  it.each([
    "https://evil-lever.co/x",
    "https://lever.co.evil.com/x",
    "https://notgreenhouse.io/x",
    "https://example.com/careers",
    "https://acme.com/?u=jobs.lever.co",
    "javascript:alert(1)",
    "",
    "not a url",
    null,
    undefined,
  ])("returns null for %s", (url) => {
    expect(getSourceInfo(url as string | null)).toBeNull();
  });
});

describe("buildRemovalMailto", () => {
  it("encodes the subject with the slug", () => {
    expect(buildRemovalMailto("a@b.co", "ai engineer/x y")).toBe(
      "mailto:a@b.co?subject=Removal%20request%3A%20ai%20engineer%2Fx%20y",
    );
  });
});

describe("SourceAttribution", () => {
  const render = (applyUrl: string | null) =>
    renderToStaticMarkup(createElement(SourceAttribution, { applyUrl, company: "Acme", slug: "ml-eng" }));

  it("names the ATS neutrally for known hosts and does not claim original posting", () => {
    const html = render("https://jobs.ashbyhq.com/acme/1");
    expect(html).toContain("Application hosted on Ashby");
    expect(html).toContain("handled by Acme");
    expect(html).not.toContain("Originally posted");
  });

  it("omits the source line for unknown hosts but keeps the report link", () => {
    const html = render("https://acme.com/careers");
    expect(html).not.toContain("Application hosted on");
    expect(html).toContain("Report this listing");
  });

  it("builds a mailto with the slug when a contact email is configured", async () => {
    vi.resetModules();
    vi.doMock("@/lib/legal", async (orig: () => Promise<Record<string, unknown>>) => {
      const mod = (await orig()) as { legalConfig: Record<string, string> };
      return { ...mod, legalConfig: { ...mod.legalConfig, contactEmail: "help@example.com" } };
    });
    const { SourceAttribution: Fresh } = await import("@/components/source-attribution");
    const html = renderToStaticMarkup(
      createElement(Fresh, { applyUrl: "https://jobs.lever.co/a/1", company: "Acme", slug: "ml-eng" }),
    );
    expect(html).toContain("mailto:help@example.com?subject=Removal%20request%3A%20ml-eng");
    vi.doUnmock("@/lib/legal");
  });
});

describe("copy", () => {
  it("site description does not overclaim", () => {
    expect(siteConfig.description).not.toMatch(/hand-?picked|curated/i);
  });
});
