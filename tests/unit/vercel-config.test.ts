import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("vercel config", () => {
  const config = JSON.parse(read("vercel.json")) as { ignoreCommand?: string };
  const ignored = read(".vercelignore")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/\/$/, ""));

  it("ignoreCommand runs a script that exists in the repo", () => {
    const script = config.ignoreCommand?.match(/(?:bash|sh)\s+(\S+)/)?.[1];
    expect(script, "ignoreCommand should run a script").toBeTruthy();
    expect(existsSync(script!)).toBe(true);
  });

  it("the ignoreCommand script is not removed by .vercelignore before it runs", () => {
    const script = config.ignoreCommand?.match(/(?:bash|sh)\s+(\S+)/)?.[1] ?? "";
    const removed = ignored.some((entry) => script === entry || script.startsWith(`${entry}/`));
    expect(removed, `${script} is excluded by .vercelignore`).toBe(false);
  });
});
