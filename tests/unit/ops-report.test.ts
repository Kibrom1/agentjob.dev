import { describe, expect, it } from "vitest";
import type { AdminStats } from "@/lib/admin/jobs";
import { computeOpsFlags, renderOpsSummary } from "@/lib/ops/report";

const NOW = new Date("2026-09-15T12:00:00Z");

function baseStats(overrides: Partial<AdminStats> = {}): AdminStats {
  return {
    jobs_by_status: { active: 5 },
    jobs_by_source: { ingested: 5 },
    live_jobs: 5,
    featured_live: 1,
    subscribers_active: 10,
    subscribers_total: 12,
    paid_last_30d: 2,
    last_digest: {
      period_start: "2026-09-08",
      status: "completed",
      job_count: 20,
      sent_count: 10,
      started_at: "2026-09-08T14:00:00Z",
      completed_at: "2026-09-08T14:05:00Z",
    },
    ingestion_last_runs: [
      {
        source_name: "greenhouse:anthropic",
        status: "ok",
        fetched: 40,
        relevant: 3,
        inserted: 1,
        updated: 2,
        skipped: 0,
        failed: 0,
        closed: 0,
        error: null,
        started_at: "2026-09-15T06:00:00Z",
        finished_at: "2026-09-15T06:00:30Z",
      },
    ],
    ...overrides,
  };
}

describe("computeOpsFlags", () => {
  it("returns no flags for a healthy board", () => {
    expect(computeOpsFlags(baseStats(), NOW)).toEqual([]);
  });

  it("flags an empty board", () => {
    const flags = computeOpsFlags(baseStats({ live_jobs: 0 }), NOW);
    expect(flags).toContainEqual(expect.objectContaining({ code: "board_empty", level: "warning" }));
  });

  it("flags a source that has never logged a run", () => {
    const flags = computeOpsFlags(baseStats({ ingestion_last_runs: [] }), NOW);
    expect(flags).toContainEqual(expect.objectContaining({ code: "ingestion_never_run", level: "info" }));
  });

  it("flags a source whose last run failed", () => {
    const stats = baseStats({
      ingestion_last_runs: [
        {
          source_name: "lever:acme",
          status: "fetch_failed",
          fetched: 0,
          relevant: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          closed: 0,
          error: "connection reset",
          started_at: "2026-09-15T06:00:00Z",
          finished_at: "2026-09-15T06:00:05Z",
        },
      ],
    });
    const flags = computeOpsFlags(stats, NOW);
    expect(flags).toContainEqual(
      expect.objectContaining({ code: "ingestion_failed", message: expect.stringContaining("connection reset") }),
    );
  });

  it("flags a source that has gone quiet even though its last run succeeded", () => {
    const stats = baseStats({
      ingestion_last_runs: [
        {
          source_name: "ashby:cohere",
          status: "ok",
          fetched: 10,
          relevant: 1,
          inserted: 1,
          updated: 0,
          skipped: 0,
          failed: 0,
          closed: 0,
          error: null,
          started_at: "2026-09-10T06:00:00Z",
          finished_at: "2026-09-10T06:00:05Z", // 5 days before NOW
        },
      ],
    });
    expect(computeOpsFlags(stats, NOW)).toContainEqual(expect.objectContaining({ code: "ingestion_stale" }));
  });

  it("does not flag no_relevant_jobs or dry_run as failures", () => {
    const stats = baseStats({
      ingestion_last_runs: [
        {
          source_name: "lever:acme",
          status: "no_relevant_jobs",
          fetched: 4,
          relevant: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          closed: 0,
          error: null,
          started_at: "2026-09-15T06:00:00Z",
          finished_at: "2026-09-15T06:00:05Z",
        },
      ],
    });
    expect(computeOpsFlags(stats, NOW)).toEqual([]);
  });

  it("flags a digest run stuck in sending", () => {
    const stats = baseStats({
      last_digest: {
        period_start: "2026-09-08",
        status: "sending",
        job_count: 20,
        sent_count: 3,
        started_at: "2026-09-15T04:00:00Z", // 8h before NOW
        completed_at: null,
      },
    });
    expect(computeOpsFlags(stats, NOW)).toContainEqual(expect.objectContaining({ code: "digest_stuck" }));
  });

  it("flags an overdue digest", () => {
    const stats = baseStats({
      last_digest: {
        period_start: "2026-08-25",
        status: "completed",
        job_count: 20,
        sent_count: 20,
        started_at: "2026-08-25T14:00:00Z", // 21 days before NOW
        completed_at: "2026-08-25T14:05:00Z",
      },
    });
    expect(computeOpsFlags(stats, NOW)).toContainEqual(expect.objectContaining({ code: "digest_overdue" }));
  });

  it("flags a board that has never sent a digest", () => {
    expect(computeOpsFlags(baseStats({ last_digest: null }), NOW)).toContainEqual(
      expect.objectContaining({ code: "digest_never_run", level: "info" }),
    );
  });

  it("nudges about zero paid listings and zero subscribers as info, not warnings", () => {
    const flags = computeOpsFlags(baseStats({ paid_last_30d: 0, subscribers_active: 0 }), NOW);
    expect(flags).toContainEqual(expect.objectContaining({ code: "no_paid_listings_30d", level: "info" }));
    expect(flags).toContainEqual(expect.objectContaining({ code: "no_subscribers", level: "info" }));
  });
});

describe("renderOpsSummary", () => {
  it("renders a plain-text summary including stats and flags", () => {
    const stats = baseStats({ live_jobs: 0 });
    const flags = computeOpsFlags(stats, NOW);
    const summary = renderOpsSummary(stats, flags, NOW);
    expect(summary).toContain("Live jobs: 0");
    expect(summary).toContain("Needs attention:");
    expect(summary).toContain("board will look empty");
  });

  it("says nothing needs attention when there are no flags", () => {
    const summary = renderOpsSummary(baseStats(), [], NOW);
    expect(summary).toContain("Nothing needs attention.");
  });
});
