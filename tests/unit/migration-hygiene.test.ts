import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));

describe("supabase migrations hygiene", () => {
  it("has migrations", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("uses <14-digit timestamp>_<snake_name>.sql filenames", () => {
    for (const f of files) expect(f).toMatch(/^[0-9]{14}_[a-z0-9_]+\.sql$/);
  });

  it("has unique timestamps", () => {
    const ts = files.map((f) => f.slice(0, 14));
    expect(new Set(ts).size).toBe(ts.length);
  });

  it("contains no psql meta-commands", () => {
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(join(dir, f), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*\\[a-zA-Z]/.test(line)) offenders.push(`${f}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
