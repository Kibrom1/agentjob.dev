import type { AdminStats } from "@/lib/admin/jobs";

export type OpsFlagLevel = "warning" | "info";

export type OpsFlag = {
  level: OpsFlagLevel;
  code: string;
  message: string;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Sources that have not logged a run in this long are probably not running at all. */
const INGESTION_STALE_AFTER_MS = 2 * DAY_MS;
/** A digest run still "sending" after this long has almost certainly crashed mid-batch. */
const DIGEST_STUCK_AFTER_MS = 6 * HOUR_MS;
/** The digest is meant to run weekly; give it two extra days of slack before flagging. */
const DIGEST_OVERDUE_AFTER_MS = 9 * DAY_MS;

/**
 * Pure, unit-testable rules over `admin_stats()` output. No I/O — this is
 * what turns a snapshot of the database into the handful of things a human
 * (or the scheduled ops agent) actually needs to act on.
 */
export function computeOpsFlags(stats: AdminStats, now: Date = new Date()): OpsFlag[] {
  const flags: OpsFlag[] = [];
  const nowMs = now.getTime();

  if (stats.live_jobs === 0) {
    flags.push({
      level: "warning",
      code: "board_empty",
      message: "Zero live job listings. The public board will look empty to visitors right now.",
    });
  }

  if (stats.ingestion_last_runs.length === 0) {
    flags.push({
      level: "info",
      code: "ingestion_never_run",
      message: "No ingestion run has ever been logged. Either the scheduled workflow hasn't run yet, or it predates this observability migration.",
    });
  }

  for (const run of stats.ingestion_last_runs) {
    const finishedMs = Date.parse(run.finished_at);
    const ageMs = Number.isFinite(finishedMs) ? nowMs - finishedMs : Number.NaN;

    if (run.status === "fetch_failed" || run.status === "db_failed" || run.status === "not_found") {
      flags.push({
        level: "warning",
        code: "ingestion_failed",
        message: `${run.source_name}: last run ${run.status}${run.error ? ` — ${run.error}` : ""}.`,
      });
    } else if (Number.isFinite(ageMs) && ageMs > INGESTION_STALE_AFTER_MS) {
      flags.push({
        level: "warning",
        code: "ingestion_stale",
        message: `${run.source_name}: no successful run in over ${Math.floor(ageMs / DAY_MS)} day(s) (last run: ${run.status} at ${run.finished_at}).`,
      });
    }
  }

  const digest = stats.last_digest;
  if (!digest) {
    flags.push({ level: "info", code: "digest_never_run", message: "The weekly digest has never run." });
  } else {
    const startedMs = Date.parse(digest.started_at);
    if (digest.status === "sending" && Number.isFinite(startedMs) && nowMs - startedMs > DIGEST_STUCK_AFTER_MS) {
      flags.push({
        level: "warning",
        code: "digest_stuck",
        message: `Digest run for week of ${digest.period_start} has been "sending" since ${digest.started_at} — likely a crashed cron invocation. Re-running is safe (deliveries are deduplicated).`,
      });
    } else if (Number.isFinite(startedMs) && nowMs - startedMs > DIGEST_OVERDUE_AFTER_MS) {
      flags.push({
        level: "warning",
        code: "digest_overdue",
        message: `No digest has started since ${digest.started_at} (week of ${digest.period_start}) — the weekly cron may not be firing.`,
      });
    }
  }

  if (stats.subscribers_active === 0) {
    flags.push({ level: "info", code: "no_subscribers", message: "No active newsletter subscribers yet." });
  }

  if (stats.paid_last_30d === 0) {
    flags.push({
      level: "info",
      code: "no_paid_listings_30d",
      message: "No paid employer listings in the last 30 days — worth a round of outreach to target employers.",
    });
  }

  return flags;
}

/** Renders a short, human-readable digest of stats + flags (used by the ops report route and the scheduled ops agent). */
export function renderOpsSummary(stats: AdminStats, flags: OpsFlag[], now: Date = new Date()): string {
  const lines: string[] = [];
  lines.push(`AgentJobs.dev ops report — ${now.toISOString()}`);
  lines.push("");
  lines.push(
    `Live jobs: ${stats.live_jobs} (${stats.featured_live} featured) · Paid listings (30d): ${stats.paid_last_30d} · Subscribers: ${stats.subscribers_active}/${stats.subscribers_total}`,
  );

  if (stats.ingestion_last_runs.length > 0) {
    const runLines = stats.ingestion_last_runs
      .map((run) => `  - ${run.source_name}: ${run.status} (${run.relevant} relevant of ${run.fetched} fetched, ${run.finished_at})`)
      .join("\n");
    lines.push("Ingestion sources:", runLines);
  }

  if (stats.last_digest) {
    lines.push(
      `Last digest: week of ${stats.last_digest.period_start}, ${stats.last_digest.status} (${stats.last_digest.sent_count}/${stats.last_digest.job_count})`,
    );
  }

  const warnings = flags.filter((flag) => flag.level === "warning");
  const infos = flags.filter((flag) => flag.level === "info");
  if (warnings.length > 0) {
    lines.push("", "Needs attention:", ...warnings.map((flag) => `  ⚠ ${flag.message}`));
  }
  if (infos.length > 0) {
    lines.push("", "For information:", ...infos.map((flag) => `  · ${flag.message}`));
  }
  if (warnings.length === 0 && infos.length === 0) {
    lines.push("", "Nothing needs attention.");
  }

  return lines.join("\n");
}
