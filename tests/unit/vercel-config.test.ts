import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

describe("vercel-ignore-build.sh", () => {
  const script = resolve("vercel-ignore-build.sh");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.email=t@t.test", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();

  function commit(cwd: string, file: string, content: string) {
    mkdirSync(join(cwd, file, ".."), { recursive: true });
    writeFileSync(join(cwd, file), content);
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "-m", file);
    return git(cwd, "rev-parse", "HEAD");
  }

  function run(cwd: string, env: Record<string, string>) {
    const result = spawnSync("bash", [script], {
      cwd,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env } as unknown as NodeJS.ProcessEnv,
    });
    return result.status;
  }

  function repo() {
    const cwd = mkdtempSync(join(tmpdir(), "vercel-ignore-"));
    git(cwd, "init", "-q", "-b", "feature");
    commit(cwd, "src/app.ts", "base");
    return cwd;
  }

  it("always builds on main", () => {
    const cwd = repo();
    commit(cwd, "docs/a.md", "x");
    expect(run(cwd, { VERCEL_GIT_COMMIT_REF: "main" })).toBe(1);
  });

  it("skips a docs-only commit and builds an app commit", () => {
    const cwd = repo();
    commit(cwd, "docs/a.md", "x");
    expect(run(cwd, { VERCEL_GIT_COMMIT_REF: "feature" })).toBe(0);
    commit(cwd, "src/app.ts", "changed");
    expect(run(cwd, { VERCEL_GIT_COMMIT_REF: "feature" })).toBe(1);
  });

  it("builds a multi-commit push whose tip is docs-only when an earlier commit changed the app", () => {
    const cwd = repo();
    const previous = git(cwd, "rev-parse", "HEAD");
    commit(cwd, "src/app.ts", "changed");
    commit(cwd, "docs/a.md", "x");
    // HEAD^..HEAD alone would wrongly skip; the previous-SHA range must build.
    expect(run(cwd, { VERCEL_GIT_COMMIT_REF: "feature" })).toBe(0);
    expect(run(cwd, { VERCEL_GIT_COMMIT_REF: "feature", VERCEL_GIT_PREVIOUS_SHA: previous })).toBe(1);
  });

  it("skips a multi-commit push that only touched non-app files", () => {
    const cwd = repo();
    const previous = git(cwd, "rev-parse", "HEAD");
    commit(cwd, "docs/a.md", "x");
    commit(cwd, "tests/b.test.ts", "y");
    expect(run(cwd, { VERCEL_GIT_COMMIT_REF: "feature", VERCEL_GIT_PREVIOUS_SHA: previous })).toBe(0);
  });

  it("falls back safely when the previous SHA is unknown or git cannot answer", () => {
    const cwd = repo();
    commit(cwd, "docs/a.md", "x");
    const bogus = "0123456789abcdef0123456789abcdef01234567";
    // Unknown previous SHA: falls back to HEAD^..HEAD (docs-only: skip).
    expect(run(cwd, { VERCEL_GIT_COMMIT_REF: "feature", VERCEL_GIT_PREVIOUS_SHA: bogus })).toBe(0);
    // A root commit has no HEAD^, so git cannot answer: build.
    const root = mkdtempSync(join(tmpdir(), "vercel-ignore-root-"));
    git(root, "init", "-q", "-b", "feature");
    commit(root, "docs/a.md", "x");
    expect(run(root, { VERCEL_GIT_COMMIT_REF: "feature" })).toBe(1);
    // Not a git repo at all: build.
    expect(run(mkdtempSync(join(tmpdir(), "vercel-ignore-none-")), { VERCEL_GIT_COMMIT_REF: "feature" })).toBe(1);
  });
});
