import "server-only";
import { getEmailEnv } from "@/lib/env";
import type { SignupDeps } from "@/lib/digest/signup";
import { sendEmail } from "@/lib/email/resend";
import { getAdminDbClient } from "@/lib/supabase/admin";

export function createSignupDeps(): SignupDeps {
  const db = getAdminDbClient();
  const email = getEmailEnv();

  return {
    async requestConfirmation(address, source) {
      const { data, error } = await db.rpc("request_digest_confirmation", { p_email: address, p_source: source });
      if (error) throw Object.assign(new Error(`request_digest_confirmation failed: ${error.message}`), { code: error.code });
      const row = data[0];
      if (!row?.should_send || !row.confirm_token || !row.unsubscribe_token) return { shouldSend: false };
      return { shouldSend: true, confirmToken: row.confirm_token, unsubscribeToken: row.unsubscribe_token };
    },

    async listNewestJobs(limit) {
      // Service role bypasses RLS, so apply the public-visibility rule here.
      const { data, error } = await db
        .from("jobs")
        .select("slug, title, company, location, workplace_type, job_type, salary_min, salary_max, salary_currency")
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString())
        .order("published_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`listNewestJobs failed: ${error.message}`, { cause: error });
      return data.map((job) => ({ ...job, is_featured: false }));
    },

    async send(message) {
      await sendEmail(message, {
        apiKey: email.RESEND_API_KEY,
        from: email.EMAIL_FROM,
        replyTo: email.EMAIL_REPLY_TO,
        baseUrl: email.RESEND_API_BASE_URL,
      });
    },

    async releaseConfirmation(address) {
      await db.from("subscribers").update({ confirmation_sent_at: null }).eq("email", address).is("confirmed_at", null);
    },
  };
}
