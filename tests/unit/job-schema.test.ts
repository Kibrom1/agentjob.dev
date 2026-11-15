/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-LD assertions walk untyped trees */
import { describe, expect, it } from "vitest";
import { resolveCountry, resolvePlace } from "@/lib/geo";
import { buildBreadcrumbJsonLd, buildJobMetaDescription, buildJobPostingJsonLd, buildWebSiteJsonLd } from "@/lib/job-schema";
import { markdownToHtml, markdownToPlainText } from "@/lib/markdown-html";
import { pageMetadata } from "@/lib/page-metadata";
import type { JobDetail } from "@/lib/types";

const NOW = Date.parse("2026-11-15T12:00:00Z");

function job(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    slug: "agent-engineer-acme",
    title: "Agent Engineer",
    company: "Acme",
    company_logo_url: null,
    company_url: "https://acme.example",
    location: "San Francisco, CA",
    workplace_type: "onsite",
    job_type: "full_time",
    category_slug: "agents",
    tags: ["LangGraph", "Python", "MCP"],
    description: "## About Acme\n\nWe build **agents**.\n\n- Own orchestration\n- Ship evals\n\nApply <script>alert(1)</script> now.",
    apply_url: "https://jobs.example/1",
    salary_min: null,
    salary_max: null,
    salary_currency: "USD",
    is_featured: false,
    published_at: "2026-11-01T00:00:00Z",
    expires_at: "2026-12-15T00:00:00Z",
    category: null,
    ...overrides,
  };
}

describe("markdownToHtml", () => {
  it("renders the Google-supported subset and shifts headings down", () => {
    const html = markdownToHtml(job().description);
    expect(html).toContain("<h3>About Acme</h3>");
    expect(html).toContain("<strong>agents</strong>");
    expect(html).toContain("<ul><li>Own orchestration</li><li>Ship evals</li></ul>");
    expect(html).not.toMatch(/##|\*\*/);
  });
  it("drops raw HTML, images and link targets, and escapes text", () => {
    const html = markdownToHtml('<script>x</script>\n\n![i](http://t/p.png) [go](javascript:alert(1)) a < b & "c"');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("href");
    expect(html).toContain("a &lt; b &amp; &quot;c&quot;");
  });
  it("produces plain text for meta descriptions", () => {
    expect(markdownToPlainText("## Hi\n\n- **a** & b")).toBe("Hi a & b");
  });
});

describe("geo", () => {
  it("resolves US states, countries and cities", () => {
    expect(resolveCountry("San Francisco, CA")?.code).toBe("US");
    expect(resolveCountry("Kuwait City, Kuwait")?.code).toBe("KW");
    expect(resolveCountry("Remote (US)")?.code).toBe("US");
    expect(resolveCountry("Toronto, ON")?.code).toBe("CA");
    expect(resolveCountry("London")?.code).toBe("GB");
    expect(resolveCountry("Remote-Friendly (Travel-Required)")).toBeNull();
  });
  it("splits a place into locality, region and country", () => {
    expect(resolvePlace("Austin, TX")).toEqual({ locality: "Austin", region: "TX", country: { code: "US", name: "United States" } });
    expect(resolvePlace("Nowhereville")).toBeNull();
  });
});

describe("buildJobPostingJsonLd", () => {
  it("emits a valid on-site posting with HTML description and country", () => {
    const data = buildJobPostingJsonLd(job(), { now: NOW }) as Record<string, any>;
    expect(data["@type"]).toBe("JobPosting");
    expect(data.description).toContain("<ul>");
    expect(data.description).not.toContain("<script");
    expect(data.datePosted).toBe("2026-11-01T00:00:00.000Z");
    expect(data.employmentType).toBe("FULL_TIME");
    expect(data.jobLocation).toEqual({
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: "San Francisco", addressRegion: "CA", addressCountry: "US" },
    });
    expect(data.jobLocationType).toBeUndefined();
    expect(data.baseSalary).toBeUndefined();
    expect(data.directApply).toBe(false);
  });

  it("never invents validThrough from the rolling expires_at column", () => {
    const data = buildJobPostingJsonLd(job(), { now: NOW });
    expect("validThrough" in data).toBe(false);
    const withReal = buildJobPostingJsonLd(job(), { now: NOW, closesAt: "2026-12-31T00:00:00Z" });
    expect(withReal.validThrough).toBe("2026-12-31T00:00:00.000Z");
  });

  it("splits multiple locations into separate Places and skips non-place labels", () => {
    const data = buildJobPostingJsonLd(
      job({ location: "Remote-Friendly (Travel-Required) | San Francisco, CA | New York City, NY | Kuwait City, Kuwait", workplace_type: "hybrid" }),
      { now: NOW },
    ) as Record<string, any>;
    expect(Array.isArray(data.jobLocation)).toBe(true);
    expect(data.jobLocation).toHaveLength(3);
    expect(data.jobLocation.map((p: any) => p.address.addressCountry)).toEqual(["US", "US", "KW"]);
  });

  it("marks remote roles TELECOMMUTE with applicantLocationRequirements when the country is known", () => {
    const data = buildJobPostingJsonLd(job({ workplace_type: "remote", location: "Remote (US)" }), { now: NOW }) as Record<string, any>;
    expect(data.jobLocationType).toBe("TELECOMMUTE");
    expect(data.applicantLocationRequirements).toEqual([{ "@type": "Country", name: "US" }]);
    expect(data.jobLocation).toBeUndefined();
  });

  it("does not claim TELECOMMUTE when no country can be determined", () => {
    const data = buildJobPostingJsonLd(job({ workplace_type: "remote", location: "Remote" }), { now: NOW });
    expect(data.jobLocationType).toBeUndefined();
    expect(data.applicantLocationRequirements).toBeUndefined();
  });

  it("maps employment types and includes salary only when present", () => {
    expect(buildJobPostingJsonLd(job({ job_type: "contract" }), { now: NOW }).employmentType).toBe("CONTRACTOR");
    expect(buildJobPostingJsonLd(job({ job_type: "internship" }), { now: NOW }).employmentType).toBe("INTERN");
    const paid = buildJobPostingJsonLd(job({ salary_min: 150000, salary_max: 200000 }), { now: NOW }) as Record<string, any>;
    expect(paid.baseSalary.value).toEqual({ "@type": "QuantitativeValue", unitText: "YEAR", minValue: 150000, maxValue: 200000 });
    expect(paid.baseSalary.currency).toBe("USD");
  });

  it("omits a future datePosted", () => {
    const data = buildJobPostingJsonLd(job({ published_at: "2027-01-01T00:00:00Z" }), { now: NOW });
    expect("datePosted" in data).toBe(false);
  });
});

describe("site and breadcrumb schema", () => {
  it("builds a BreadcrumbList with absolute URLs and 1-based positions", () => {
    const data = buildBreadcrumbJsonLd([{ name: "Jobs", path: "/" }, { name: "Role", path: "/jobs/x" }]) as Record<string, any>;
    expect(data["@type"]).toBe("BreadcrumbList");
    expect(data.itemListElement.map((i: any) => i.position)).toEqual([1, 2]);
    expect(data.itemListElement[1].item).toMatch(/^https?:\/\/.+\/jobs\/x$/);
  });
  it("builds a WebSite with a SearchAction", () => {
    const data = buildWebSiteJsonLd() as Record<string, any>;
    expect(data["@type"]).toBe("WebSite");
    expect(data.potentialAction.target.urlTemplate).toContain("?q={search_term_string}");
  });
});

describe("meta descriptions", () => {
  it("includes company, location, workplace, salary and stack, within 160 chars", () => {
    const d = buildJobMetaDescription(job({ salary_min: 150000, salary_max: 200000 }));
    expect(d).toContain("Agent Engineer at Acme");
    expect(d).toContain("San Francisco, CA");
    expect(d).toContain("On-site");
    expect(d).toContain("$150K");
    expect(d).toContain("LangGraph");
    expect(d.length).toBeLessThanOrEqual(160);
  });
  it("differs between roles at the same company", () => {
    const a = buildJobMetaDescription(job({ description: "About Acme. Acme builds things for everyone in the world.\n\nYou will own agent orchestration across teams." }));
    const b = buildJobMetaDescription(job({ title: "Eval Engineer", tags: ["Evals"], description: "About Acme. Acme builds things for everyone in the world.\n\nYou will design evaluation harnesses." }));
    expect(a).not.toBe(b);
  });
});

describe("pageMetadata", () => {
  it("sets page-specific openGraph url and title instead of inheriting the root", () => {
    const m = pageMetadata({ title: "Post a job", description: "d", path: "/post-a-job" });
    expect(m.openGraph?.url).toBe("/post-a-job");
    expect(m.openGraph?.title).toContain("Post a job");
    expect(m.alternates?.canonical).toBe("/post-a-job");
  });
});
