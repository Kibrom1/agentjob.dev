import { describe, expect, it } from "vitest";
import { splitDomain } from "@/components/logo";
import { siteConfig } from "@/lib/site";

describe("brand consistency", () => {
  it("logo wordmark rebuilds exactly siteConfig.domain", () => {
    const { label, tld } = splitDomain(siteConfig.domain);
    expect(label + tld).toBe(siteConfig.domain);
    expect(tld).toBe(".dev");
  });
  it("splitDomain tolerates a bare label", () => {
    expect(splitDomain("example")).toEqual({ label: "example", tld: "" });
  });
  it("the site uses the new domain and no longer mentions the old one", () => {
    expect(siteConfig.domain).toBe("agenticroles.dev");
    expect(siteConfig.name).toBe("Agentic Roles");
  });
});
