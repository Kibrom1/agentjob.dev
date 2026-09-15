import "server-only";
import { getEmailEnv } from "@/lib/env";
import type { DigestDeps } from "@/lib/digest/run";
import { sendEmailBatch } from "@/lib/email/resend";
import { getAdminDbClient } from "@/lib/supabase/admin";

export function createDigestDeps(): DigestDeps {
  const db = getAdminDbClient();
  const email = getEmailEnv();

  return {
    now: () => new Date(),

    async findRun(periodStart) {
      const { data, error } = await db
        .from("digest_runs")
        .select("id, status, started_at")
        .eq("period_start", periodStart)
        .maybeSingle();
      if (error) throw new Error(`findRun failed: ${error.message}`, { cause: error });
      return data;
    },

    async beginRun(periodStart) {
      const { data, error } = await db.rpc("begin_digest_run", { p_period_start: periodStart });
      if (error) throw new Error(`begin_digest_run failed: ${error.message}`, { cause: error });
      return { id: data.id, status: data.status, started_at: data.started_at };
    },

    async listJobs(publishedFromIso, publishedBeforeIso, limit) {
      // Service role bypasses RLS, so apply the public-visibility rule here.
      const nowIso = new Date().toISOString();
      const { data, error } = await db
        .from("jobs")
        .select(
          "slug, title, company, location, workplace_type, job_type, salary_min, salary_max, salary_currency, is_featured, featured_until",
        )
        .eq("status", "active")
        .gt("expires_at", nowIso)
        .gte("published_at", publishedFromIso)
        .lt("published_at", publishedBeforeIso)
        .order("is_featured", { ascending: false })
        .order("published_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`listJobs failed: ${error.message}`, { cause: error });
      return data.map(({ featured_until, ...job }) => ({
        ...job,
        is_featured: job.is_featured && featured_until !== null && featured_until > nowIso,
      }));
    },

    async nextRecipients(runId, limit) {
      const { data, error } = await db.rpc("next_digest_recipients", { p_run_id: runId, p_limit: limit });
      if (error) throw new Error(`next_digest_recipients failed: ${error.message}`, { cause: error });
      return data;
    },

    sendBatch(emails, idempotencyKey) {
      return sendEmailBatch(
        emails,
        {
          apiKey: email.RESEND_API_KEY,
          from: email.EMAIL_FROM,
          replyTo: email.EMAIL_REPLY_TO,
          baseUrl: email.RESEND_API_BASE_URL,
        },
        idempotencyKey,
      );
    },

    async recordDeliveries(runId, deliveries) {
      const { data, error } = await db.rpc("record_digest_deliveries", { p_run_id: runId, p_deliveries: deliveries });
      if (error) throw new Error(`record_digest_deliveries failed: ${error.message}`, { cause: error });
      return data;
    },

    async finishRun(runId, status, jobCount) {
      const { error } = await db.rpc("finish_digest_run", { p_run_id: runId, p_status: status, p_job_count: jobCount });
      if (error) throw new Error(`finish_digest_run failed: ${error.message}`, { cause: error });
    },
  };
}
