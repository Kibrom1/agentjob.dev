import { describe, expect, it } from "vitest";
import { buildApplyHref, companyInitials, formatRelativeTime, formatSalaryRange } from "@/lib/format";
import { buildJobSearchHref, hasActiveFilters, parseJobSearchParams } from "@/lib/search-params";

describe("format helpers", () => {
  it("formats salary ranges", () => {
    expect(formatSalaryRange(180_000, 240_000, "USD")).toBe("$180K – $240K");
    expect(formatSalaryRange(150_000, null, "EUR")).toBe("From €150K");
    expect(formatSalaryRange(null, 90_000, "GBP")).toBe("Up to £90K");
    expect(formatSalaryRange(100_000, 100_000, "USD")).toBe("$100K");
    expect(formatSalaryRange(null, null, "USD")).toBeNull();
    expect(formatSalaryRange(5_000, null, "ZZZ1")).toBe("From ZZZ1 5,000");
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-09-15T12:00:00Z");
    expect(formatRelativeTime("2026-09-15T11:59:30Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-09-15T09:00:00Z", now)).toBe("3h ago");
    expect(formatRelativeTime("2026-09-01T12:00:00Z", now)).toBe("2w ago");
    expect(formatRelativeTime("2026-09-16T12:00:00Z", now)).toBe("just now");
    expect(formatRelativeTime("garbage", now)).toBe("");
  });

  it("builds initials", () => {
    expect(companyInitials("Acme Agents Inc")).toBe("AA");
    expect(companyInitials("株式会社")).toBe("株");
    expect(companyInitials("   ")).toBe("?");
  });

  it("builds attributed apply links and refuses unsafe schemes", () => {
    expect(buildApplyHref("https://x.dev/apply?ref=1", "Role", "agentjob.dev")).toBe(
      "https://x.dev/apply?ref=1&utm_source=agentjob.dev&utm_medium=job_board",
    );
    expect(buildApplyHref("https://x.dev/a?utm_source=own", "Role", "agentjob.dev")).toBe("https://x.dev/a?utm_source=own");
    expect(buildApplyHref("mailto:jobs@x.dev", "Agent Eng", "agentjob.dev")).toBe(
      "mailto:jobs@x.dev?subject=Application%3A%20Agent%20Eng%20(via%20agentjob.dev)",
    );
    expect(buildApplyHref("javascript:alert(1)", "Role", "agentjob.dev")).toBeNull();
    expect(buildApplyHref("not a url", "Role", "agentjob.dev")).toBeNull();
  });
});

describe("search params", () => {
  it("drops invalid values instead of failing", () => {
    expect(parseJobSearchParams({ q: "  vllm ", category: "BAD!", workplace: "moon", tag: ["LangGraph", "x"], page: "0" })).toEqual({
      query: "vllm",
      category: undefined,
      workplace: undefined,
      tag: "LangGraph",
      page: 1,
    });
    expect(parseJobSearchParams({ page: "3", workplace: "remote" })).toMatchObject({ page: 3, workplace: "remote" });
    expect(parseJobSearchParams({ q: "x".repeat(500) }).query).toHaveLength(200);
  });

  it("builds hrefs and resets pagination on filter changes", () => {
    const current = { query: "agents", category: "tool-use-backends", page: 4 };
    expect(buildJobSearchHref(current, { category: undefined })).toBe("/?q=agents");
    expect(buildJobSearchHref(current, { page: 5 })).toBe("/?q=agents&category=tool-use-backends&page=5");
    expect(buildJobSearchHref({ page: 1 })).toBe("/");
    expect(hasActiveFilters({ page: 2 })).toBe(false);
    expect(hasActiveFilters({ page: 1, tag: "MCP" })).toBe(true);
  });
});
