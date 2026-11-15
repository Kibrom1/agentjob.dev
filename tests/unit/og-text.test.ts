import { describe, expect, it } from "vitest";
import { cleanOgText, truncateOgText } from "@/lib/og-text";

const NUL = String.fromCharCode(0);
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);
const ELLIPSIS = String.fromCharCode(0x2026);
const EMOJI = String.fromCodePoint(0x1f600);

describe("og text helpers", () => {
  it("collapses whitespace and strips control and bidi characters", () => {
    expect(cleanOgText(`  Agent${NUL} ${RLO}Engineer${ZWSP}\n\tII  `)).toBe("Agent Engineer II");
  });

  it("leaves markup-like text as inert text", () => {
    expect(cleanOgText("<script>alert(1)</script> & Co")).toBe("<script>alert(1)</script> & Co");
  });

  it("returns short strings unchanged", () => {
    expect(truncateOgText("Short title", 90)).toBe("Short title");
  });

  it("truncates long strings to the cap with an ellipsis, at a word boundary", () => {
    const out = truncateOgText("word ".repeat(100), 40);
    expect(Array.from(out).length).toBeLessThanOrEqual(40);
    expect(out.endsWith(ELLIPSIS)).toBe(true);
    expect(out.endsWith(` ${ELLIPSIS}`)).toBe(false);
  });

  it("hard-cuts a single unbroken token", () => {
    const out = truncateOgText("x".repeat(500), 20);
    expect(Array.from(out)).toHaveLength(20);
  });

  it("does not split surrogate pairs", () => {
    const out = truncateOgText(EMOJI.repeat(50), 10);
    expect(Array.from(out)).toHaveLength(10);
  });

  it("handles empty input", () => {
    expect(truncateOgText("", 10)).toBe("");
  });
});
