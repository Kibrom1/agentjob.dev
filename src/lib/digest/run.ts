import { createHash } from "node:crypto";
import { RESEND_BATCH_LIMIT, type OutboundEmail } from "@/lib/email/resend";
import { digestEmail, type DigestJob } from "@/lib/email/templates";

export type DigestRun = { id: string; status: string; started_at: string };
export type DigestRecipient = { subscriber_id: string; email: string; unsubscribe_token: string };

export type DigestDeps = {
  now(): Date;
  findRun(periodStart: string): Promise<DigestRun | null>;
  beginRun(periodStart: string): Promise<DigestRun>;
  listJobs(publishedFromIso: string, publishedBeforeIso: string, limit: number): Promise<DigestJob[]>;
  nextRecipients(runId: string, limit: number): Promise<DigestRecipient[]>;
  sendBatch(emails: OutboundEmail[], idempotencyKey: string): Promise<string[]>;
  recordDeliveries(runId: string, deliveries: Array<{ subscriber_id: string; provider_message_id: string }>): Promise<number>;
  finishRun(runId: string, status: "completed" | "skipped", jobCount: number): Promise<void>;
};

export type DigestConfig = {
  siteUrl: string;
  postalAddress: string;
  /** Digest is started on this UTC weekday (0 = Sunday … 6 = Saturday). */
  sendWeekday: number;
  batchSize?: number;
  maxJobs?: number;
  /** Stop starting new batches after this many ms (function time budget). */
  timeBudgetMs: number;
  force?: boolean;
};

export type DigestResult =
  | { status: "not_scheduled"; periodStart: string }
  | { status: "already_finished"; periodStart: string; runId: string }
  | { status: "skipped_no_jobs"; periodStart: string; runId: string }
  | { status: "completed" | "partial"; periodStart: string; runId: string; sent: number; jobs: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Monday of the ISO week containing `date`, as YYYY-MM-DD (UTC). */
export function isoWeekStart(date: Date): string {
  const day = date.getUTCDay();
  const offset = (day + 6) % 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset));
  return monday.toISOString().slice(0, 10);
}

export function weekLabel(periodStart: string): string {
  const start = new Date(`${periodStart}T00:00:00Z`);
  return `Week of ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(start)}`;
}

export function batchIdempotencyKey(runId: string, subscriberIds: string[]): string {
  const digest = createHash("sha256").update(subscriberIds.join(",")).digest("hex").slice(0, 40);
  return `digest/${runId}/${digest}`;
}

/** True once the configured send weekday has been reached in the ISO week. */
export function isDue(date: Date, sendWeekday: number): boolean {
  const offsetToday = (date.getUTCDay() + 6) % 7;
  const offsetSend = (sendWeekday + 6) % 7;
  return offsetToday >= offsetSend;
}

/**
 * Sends (or resumes) this week's digest. Safe to invoke repeatedly: the run
 * row is unique per week, deliveries are recorded per subscriber, and each
 * batch carries a deterministic idempotency key so a crash between "sent" and
 * "recorded" does not produce duplicates at the provider.
 */
export async function runWeeklyDigest(deps: DigestDeps, config: DigestConfig): Promise<DigestResult> {
  const startedAt = deps.now();
  const deadline = startedAt.getTime() + config.timeBudgetMs;
  const periodStart = isoWeekStart(startedAt);
  const batchSize = Math.max(1, Math.min(config.batchSize ?? RESEND_BATCH_LIMIT, RESEND_BATCH_LIMIT));
  const maxJobs = config.maxJobs ?? 25;

  let run = await deps.findRun(periodStart);
  if (!run) {
    if (!config.force && !isDue(startedAt, config.sendWeekday)) {
      return { status: "not_scheduled", periodStart };
    }
    run = await deps.beginRun(periodStart);
  }

  if (run.status !== "sending") {
    return { status: "already_finished", periodStart, runId: run.id };
  }

  const windowStart = new Date(Date.parse(`${periodStart}T00:00:00Z`) - 7 * DAY_MS).toISOString();
  const jobs = await deps.listJobs(windowStart, run.started_at, maxJobs);

  if (jobs.length === 0) {
    await deps.finishRun(run.id, "skipped", 0);
    return { status: "skipped_no_jobs", periodStart, runId: run.id };
  }

  const label = weekLabel(periodStart);
  const campaign = `digest-${periodStart}`;
  let sent = 0;

  while (deps.now().getTime() < deadline) {
    const recipients = await deps.nextRecipients(run.id, batchSize);
    if (recipients.length === 0) {
      await deps.finishRun(run.id, "completed", jobs.length);
      return { status: "completed", periodStart, runId: run.id, sent, jobs: jobs.length };
    }

    const emails = recipients.map((recipient) =>
      digestEmail({
        to: recipient.email,
        jobs,
        siteUrl: config.siteUrl,
        unsubscribePageUrl: new URL(`/unsubscribe/${recipient.unsubscribe_token}`, config.siteUrl).toString(),
        unsubscribePostUrl: new URL(`/api/unsubscribe/${recipient.unsubscribe_token}`, config.siteUrl).toString(),
        postalAddress: config.postalAddress,
        campaign,
        weekLabel: label,
      }),
    );

    const ids = recipients.map((recipient) => recipient.subscriber_id);
    const providerIds = await deps.sendBatch(emails, batchIdempotencyKey(run.id, ids));

    sent += await deps.recordDeliveries(
      run.id,
      recipients.map((recipient, index) => ({
        subscriber_id: recipient.subscriber_id,
        provider_message_id: providerIds[index] ?? "",
      })),
    );
  }

  return { status: "partial", periodStart, runId: run.id, sent, jobs: jobs.length };
}
