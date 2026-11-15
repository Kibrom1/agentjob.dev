import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/jobs", () => ({ listLiveJobSlugs: async () => [] }));

import sitemap from "@/app/sitemap";
import { SiteFooter } from "@/components/site-footer";
import { LEGAL_LINKS, hasPlaceholders, legalConfig } from "@/lib/legal";

const PAGES = [
  { path: "/terms", load: () => import("@/app/terms/page"), title: "Terms of service" },
  { path: "/privacy", load: () => import("@/app/privacy/page"), title: "Privacy policy" },
  { path: "/refund", load: () => import("@/app/refund/page"), title: "Refund policy" },
  { path: "/about", load: () => import("@/app/about/page"), title: "About" },
] as const;

describe("legalConfig", () => {
  it("has every required key as a visible placeholder", () => {
    for (const key of ["companyName", "contactEmail", "privacyEmail", "postalAddress", "jurisdiction", "lastUpdated"]) {
      expect(legalConfig).toHaveProperty(key);
    }
    expect(hasPlaceholders()).toBe(true);
    expect(hasPlaceholders({ a: "real value" })).toBe(false);
  });
});

describe.each(PAGES)("$path", ({ path, load, title }) => {
  it("exports metadata with title and canonical, and renders one h1", async () => {
    const mod = await load();
    expect(mod.metadata.title).toBe(title);
    expect(mod.metadata.alternates?.canonical).toBe(path);
    const html = renderToStaticMarkup(createElement(mod.default));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("[[PLACEHOLDER");
  });
});

describe("footer and sitemap", () => {
  it("links the four legal pages, a contact mailto and a Legal nav", () => {
    expect(LEGAL_LINKS.map((l) => l.href)).toEqual(["/terms", "/privacy", "/refund", "/about"]);
    const html = renderToStaticMarkup(createElement(SiteFooter));
    for (const link of LEGAL_LINKS) expect(html).toContain(`href="${link.href}"`);
    expect(html).toContain('href="mailto:');
    expect(html).toContain('aria-label="Legal"');
  });

  it("lists the legal pages in the sitemap", async () => {
    const urls = (await sitemap()).map((entry) => entry.url);
    for (const link of LEGAL_LINKS) expect(urls.some((u) => u.endsWith(link.href))).toBe(true);
  });
});
