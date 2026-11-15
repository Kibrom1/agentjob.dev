import { describe, expect, it } from "vitest";
import { formatLocationSummary as f, splitLocations } from "@/lib/format";

describe("splitLocations", () => {
  it("splits scraped multi-location strings into trimmed, deduped items", () => {
    expect(splitLocations("Remote-Friendly (Travel-Required) | San Francisco, CA | Seattle, WA | New York City, NY")).toEqual([
      "Remote-Friendly (Travel-Required)",
      "San Francisco, CA",
      "Seattle, WA",
      "New York City, NY",
    ]);
    expect(splitLocations("A | a ; B")).toEqual(["A", "B"]);
  });
  it("returns [] for empty input and keeps single locations whole", () => {
    expect(splitLocations(null)).toEqual([]);
    expect(splitLocations("  ")).toEqual([]);
    expect(splitLocations("Remote (US/Canada)")).toEqual(["Remote (US/Canada)"]);
  });
});

describe("formatLocationSummary", () => {
  it("returns an empty summary for null, undefined, empty and separator-only input", () => {
    for (const v of [null, undefined, "", "   ", "|", " ; | ; ", " / "]) {
      expect(f(v)).toEqual({ primary: "", extra: 0, full: "", display: "" });
    }
  });
  it("keeps a single location untouched", () => {
    expect(f("Berlin, Germany")).toEqual({
      primary: "Berlin, Germany",
      extra: 0,
      full: "Berlin, Germany",
      display: "Berlin, Germany",
    });
  });
  it("splits on pipes", () => {
    expect(f("London | Paris | Berlin").display).toBe("London +2 more");
    expect(f("London|Paris").display).toBe("London +1 more");
  });
  it("splits on semicolons", () => {
    expect(f("London; Paris;Berlin").display).toBe("London +2 more");
  });
  it("splits on spaced slashes only", () => {
    expect(f("San Francisco / Remote").display).toBe("San Francisco +1 more");
    expect(f("US/Canada").display).toBe("US/Canada");
    expect(f("Remote (US/Canada)").display).toBe("Remote (US/Canada)");
  });
  it("handles mixed separators", () => {
    expect(f("A | B; C / D").extra).toBe(3);
    expect(f("A | B; C / D").full).toBe("A · B · C · D");
  });
  it("keeps commas inside a location", () => {
    expect(f("New York, NY | Austin, TX").primary).toBe("New York, NY");
  });
  it("dedupes case-insensitively and collapses whitespace", () => {
    expect(f("Remote | remote |  REMOTE ").display).toBe("Remote");
    expect(f("New   York | new york | Boston").display).toBe("New York +1 more");
  });
  it("ignores empty segments", () => {
    expect(f("|| London ;; | Paris |").display).toBe("London +1 more");
  });
  it("handles Remote variants and the review example", () => {
    expect(f("Remote").display).toBe("Remote");
    expect(f("Remote - US | Remote - EU").display).toBe("Remote - US +1 more");
    expect(f("Remote-Friendly (Travel-Required) | NYC | SF | Austin").display).toBe(
      "Remote-Friendly +3 more",
    );
  });
  it("trims whitespace and newlines", () => {
    expect(f("\n London \t| Paris\n").display).toBe("London +1 more");
  });
  it("handles non-ASCII locations", () => {
    expect(f("Zürich | 東京").display).toBe("Zürich +1 more");
  });
  it("drops a long parenthetical from the card display but keeps it in primary/full", () => {
    const r = f("Remote-Friendly (Travel-Required) | San Francisco, CA | Seattle, WA | New York City, NY");
    expect(r.display).toBe("Remote-Friendly +3 more");
    expect(r.primary).toBe("Remote-Friendly (Travel-Required)");
    expect(r.full).toContain("(Travel-Required)");
    expect(f("Remote-Friendly (Travel-Required)").display).toBe("Remote-Friendly");
  });
  it("drops a short parenthetical only in multi-location strings", () => {
    expect(f("Remote (US)").display).toBe("Remote (US)");
    expect(f("Remote (US) | London").display).toBe("Remote +1 more");
  });
  it("never reduces a location to nothing", () => {
    expect(f("(Remote)").display).toBe("(Remote)");
  });
  it("handles very long input", () => {
    const raw = Array.from({ length: 100 }, (_, i) => `City${i}`).join(" | ");
    expect(raw.length).toBeGreaterThan(600);
    expect(f(raw).display).toBe("City0 +99 more");
    const one = "x".repeat(1000);
    expect(f(one).display).toBe(one);
  });
});
