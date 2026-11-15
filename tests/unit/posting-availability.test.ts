import { describe, expect, it } from "vitest";
import { isPostingEnabled } from "@/lib/posting/availability";

describe("isPostingEnabled", () => {
  it("is off by default", () => {
    expect(isPostingEnabled({})).toBe(false);
    expect(isPostingEnabled({ PAYMENTS_ENABLED: "" })).toBe(false);
  });
  it("is off for anything but true", () => {
    for (const value of ["false", "0", "1", "yes", "enabled"]) {
      expect(isPostingEnabled({ PAYMENTS_ENABLED: value })).toBe(false);
    }
  });
  it("is on for true, tolerant of case and whitespace", () => {
    expect(isPostingEnabled({ PAYMENTS_ENABLED: "true" })).toBe(true);
    expect(isPostingEnabled({ PAYMENTS_ENABLED: " TRUE " })).toBe(true);
  });
});
