import { describe, expect, it, vi } from "vitest";
import { batchIdempotencyKey, isDue, isoWeekStart, runWeeklyDigest, weekLabel, type DigestDeps, type DigestRecipient, type DigestRun } from "@/lib/digest/run";
import type { DigestJob } from "@/lib/email/templates";

const MONDAY = new Date("2026-09-14T14:00:00Z");
const SUNDAY = new Date("2026-09-13T14:00:00Z");

const JOB: DigestJob = {
  slug: "agent-engineer-at-orbit-1",
  title: "Agent Engineer",
  company: "Orbit",
  location: "Remote",
  workplace_type: "remote",
  job_type: "full_time",
  salary_min: 150_000,
  salary_max: null,
  salary_currency: "USD",
  is_featured: true,
};

function recipients(count: number): DigestRecipient[] {
  return Array.from({ length: count }, (_, i) => ({
    subscriber_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    email: `dev${i}@example.com`,
    unsubscribe_token: `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`,
  }));
}

function fakeDeps(opts: { existing?: DigestRun | null; jobs?: DigestJob[]; audience?: DigestRecipient[]; clock?: () => Date } = {}) {
  const pending = [...(opts.audience ?? recipients(250))];
  const run: DigestRun = { id: "run-1", status: "sending", started_at: MONDAY.toISOString() };
  const deps = {
    now: vi.fn(opts.clock ?? (() => MONDAY)),
    findRun: vi.fn(async () => (opts.existing === undefined ? null : opts.existing)),
    beginRun: vi.fn(async () => run),
    listJobs: vi.fn(async () => opts.jobs ?? [JOB]),
    nextRecipients: vi.fn(async (_run: string, limit: number) => pending.slice(0, limit)),
    sendBatch: vi.fn(async (emails: { to: string }[], _idempotencyKey: string) => emails.map((e) => `msg-${e.to}`)),
    recordDeliveries: vi.fn(async (_run: string, deliveries: { subscriber_id: string }[]) => {
      const sent = new Set(deliveries.map((d) => d.subscriber_id));
      for (let i = pending.length - 1; i >= 0; i--) {
        if (sent.has(pending[i]!.subscriber_id)) pending.splice(i, 1);
      }
      return deliveries.length;
    }),
    finishRun: vi.fn(async () => undefined),
  } satisfies DigestDeps;
  return deps;
}

const config = { siteUrl: "https://agentjob.dev/", postalAddress: "1 Main St, Springfield, USA", sendWeekday: 1, timeBudgetMs: 45_000 };

describe("week helpers", () => {
  it("computes the ISO week start (Monday, UTC)", () => {
    expect(isoWeekStart(new Date("2026-09-14T00:00:00Z"))).toBe("2026-09-14");
    expect(isoWeekStart(new Date("2026-09-20T23:59:59Z"))).toBe("2026-09-14");
    expect(isoWeekStart(SUNDAY)).toBe("2026-09-07");
  });

  it("is due from the send weekday until the end of the ISO week", () => {
    expect(isDue(MONDAY, 1)).toBe(true);
    expect(isDue(new Date("2026-09-16T00:00:00Z"), 1)).toBe(true);
    expect(isDue(SUNDAY, 1)).toBe(true);
    expect(isDue(MONDAY, 3)).toBe(false);
  });

  it("labels the week and derives stable idempotency keys", () => {
    expect(weekLabel("2026-09-14")).toBe("Week of September 14, 2026");
    expect(batchIdempotencyKey("run", ["a", "b"])).toBe(batchIdempotencyKey("run", ["a", "b"]));
    expect(batchIdempotencyKey("run", ["a", "b"])).not.toBe(batchIdempotencyKey("run", ["a", "c"]));
    expect(batchIdempotencyKey("run", ["a"]).length).toBeLessThanOrEqual(256);
  });
});

describe("runWeeklyDigest", () => {
  it("sends in batches of 100 and completes the run", async () => {
    const deps = fakeDeps();
    const result = await runWeeklyDigest(deps, config);
    expect(result).toEqual({ status: "completed", periodStart: "2026-09-14", runId: "run-1", sent: 250, jobs: 1 });
    expect(deps.sendBatch.mock.calls.map((call) => call[0].length)).toEqual([100, 100, 50]);
    expect(deps.finishRun).toHaveBeenCalledWith("run-1", "completed", 1);
    expect(deps.listJobs).toHaveBeenCalledWith("2026-09-07T00:00:00.000Z", MONDAY.toISOString(), 25);
  });

  it("builds compliant emails per recipient", async () => {
    const deps = fakeDeps({ audience: recipients(1) });
    await runWeeklyDigest(deps, config);
    const [emails, key] = deps.sendBatch.mock.calls[0]!;
    const email = emails[0] as unknown as { to: string; headers: Record<string, string>; text: string; html: string };
    expect(email.to).toBe("dev0@example.com");
    expect(email.headers["List-Unsubscribe"]).toBe("<https://agentjob.dev/api/unsubscribe/aaaaaaaa-0000-4000-8000-000000000000>");
    expect(email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(email.text).toContain("https://agentjob.dev/unsubscribe/aaaaaaaa-0000-4000-8000-000000000000");
    expect(email.html).toContain("1 Main St, Springfield, USA");
    expect(key).toMatch(/^digest\/run-1\//);
  });

  it("does not start before the send weekday", async () => {
    const deps = fakeDeps();
    const result = await runWeeklyDigest(deps, { ...config, sendWeekday: 3 });
    expect(result.status).toBe("not_scheduled");
    expect(deps.beginRun).not.toHaveBeenCalled();
  });

  it("can be forced early", async () => {
    const deps = fakeDeps({ audience: recipients(1) });
    const result = await runWeeklyDigest(deps, { ...config, sendWeekday: 3, force: true });
    expect(result.status).toBe("completed");
  });

  it("resumes an unfinished run regardless of weekday", async () => {
    const deps = fakeDeps({ existing: { id: "run-1", status: "sending", started_at: MONDAY.toISOString() }, audience: recipients(3) });
    const result = await runWeeklyDigest(deps, { ...config, sendWeekday: 3 });
    expect(result.status).toBe("completed");
    expect(deps.beginRun).not.toHaveBeenCalled();
  });

  it("never re-sends a finished run", async () => {
    const deps = fakeDeps({ existing: { id: "run-1", status: "completed", started_at: MONDAY.toISOString() } });
    expect((await runWeeklyDigest(deps, config)).status).toBe("already_finished");
    expect(deps.sendBatch).not.toHaveBeenCalled();
  });

  it("skips the week when there are no new jobs", async () => {
    const deps = fakeDeps({ jobs: [] });
    expect((await runWeeklyDigest(deps, config)).status).toBe("skipped_no_jobs");
    expect(deps.finishRun).toHaveBeenCalledWith("run-1", "skipped", 0);
    expect(deps.sendBatch).not.toHaveBeenCalled();
  });

  it("stops at the time budget and reports a partial run", async () => {
    let tick = 0;
    const deps = fakeDeps({ clock: () => new Date(MONDAY.getTime() + tick++ * 20_000) });
    const result = await runWeeklyDigest(deps, config);
    expect(result.status).toBe("partial");
    expect(deps.finishRun).not.toHaveBeenCalled();
    if (result.status === "partial") expect(result.sent).toBeLessThan(250);
  });

  it("propagates send failures without recording deliveries", async () => {
    const deps = fakeDeps();
    deps.sendBatch.mockRejectedValueOnce(new Error("resend down"));
    await expect(runWeeklyDigest(deps, config)).rejects.toThrow("resend down");
    expect(deps.recordDeliveries).not.toHaveBeenCalled();
  });
});
