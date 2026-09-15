import "server-only";
import { revalidatePath } from "next/cache";
import { isEmailConfigured } from "@/lib/env";
import { sendPostingConfirmation } from "@/lib/email/notifications";
import type { FulfillmentDeps, FulfillmentJob } from "@/lib/stripe/fulfillment";
import { getAdminDbClient } from "@/lib/supabase/admin";

const JOB_COLUMNS = "id, slug, title, company, status" as const;

type Options = {
  /** revalidatePath is only allowed in route handlers and server actions. */
  revalidate: boolean;
  /** Only the webhook notifies, so a success-page fallback never double-sends. */
  notify: boolean;
};

export function createFulfillmentDeps({ revalidate, notify }: Options): FulfillmentDeps {
  const db = getAdminDbClient();

  return {
    async findJobBySession(sessionId) {
      const { data, error } = await db
        .from("jobs")
        .select(JOB_COLUMNS)
        .eq("stripe_checkout_session_id", sessionId)
        .maybeSingle();
      if (error) throw new Error(`findJobBySession failed: ${error.message}`, { cause: error });
      return data;
    },

    async activateJob(sessionId, featured) {
      const { data, error } = await db.rpc("activate_paid_job", {
        p_stripe_session_id: sessionId,
        p_featured: featured,
      });
      if (error) throw new Error(`activate_paid_job failed: ${error.message}`, { cause: error });
      const job: FulfillmentJob = {
        id: data.id,
        slug: data.slug,
        title: data.title,
        company: data.company,
        status: data.status,
      };
      return job;
    },

    async expireCheckout(sessionId) {
      const { data, error } = await db.rpc("mark_checkout_expired", { p_session_id: sessionId });
      if (error) throw new Error(`mark_checkout_expired failed: ${error.message}`, { cause: error });
      return data;
    },

    async saveCustomer(jobId, customerId) {
      const { data: job, error: jobError } = await db.from("jobs").select("employer_id").eq("id", jobId).single();
      if (jobError) throw new Error(`employer lookup failed: ${jobError.message}`, { cause: jobError });
      if (!job.employer_id) return;
      const { error } = await db
        .from("employers")
        .update({ stripe_customer_id: customerId })
        .eq("id", job.employer_id)
        .is("stripe_customer_id", null);
      if (error) throw new Error(`saving Stripe customer failed: ${error.message}`, { cause: error });
    },

    async onPublished(job, contactEmail) {
      if (revalidate) {
        revalidatePath("/");
        revalidatePath(`/jobs/${job.slug}`);
      }
      if (notify && contactEmail && isEmailConfigured()) {
        await sendPostingConfirmation({ to: contactEmail, job });
      }
    },

    log: console,
  };
}
