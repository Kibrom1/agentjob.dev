import { describe, expect, it } from "vitest";
import { splitTags } from "@/components/tag-list";

const tags = ["a", "b", "c", "d", "e", "f", "g"];

describe("splitTags", () => {
  it("returns all tags when max is omitted", () => {
    expect(splitTags(tags)).toEqual({ visible: tags, hidden: 0 });
  });
  it("caps and reports overflow", () => {
    expect(splitTags(tags, 5)).toEqual({ visible: tags.slice(0, 5), hidden: 2 });
  });
  it("shows everything when at or under the cap", () => {
    expect(splitTags(tags.slice(0, 5), 5).hidden).toBe(0);
    expect(splitTags(tags.slice(0, 3), 5).visible).toHaveLength(3);
  });
  it("handles empty input and invalid caps", () => {
    expect(splitTags([], 5)).toEqual({ visible: [], hidden: 0 });
    expect(splitTags(tags, -1).hidden).toBe(0);
    expect(splitTags(tags, Number.NaN).hidden).toBe(0);
  });
});
