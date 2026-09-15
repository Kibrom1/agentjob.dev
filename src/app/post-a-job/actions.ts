"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { EnvConfigError } from "@/lib/env";
import { planFor } from "@/lib/posting/pricing";
import {
  firstStepWithError,
  parsePosting,
  postingInputFromFormData,
  toEmployerPayload,
  toJobPayload,
  type FieldErrors,
} from "@/lib/posting/schema";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { deploymentOrigin } from "@/lib/site";
import { createCheckoutSession } from "@/lib/stripe/checkout";
import { getAdminDbClient } from "@/lib/supabase/admin";

export type PostJobState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: FieldErrors; step: number };

const UNAVAILABLE = "Job posting is temporarily unavailable. Please try again shortly.";

function failure(message: string, fieldErrors: FieldErrors = {}, step?: number): PostJobState {
  return { status: "error", message, fieldErrors, step: step ?? firstStepWithError(fieldErrors) };
}

/**
 * Validates the posting, stores it as a draft, opens a Stripe Checkout
 * session and redirects the employer to pay. Nothing is published here — only
 * a verified payment (webhook or success-page check) activates the job.
 */
export async function startJobCheckout(_previous: PostJobState, formData: FormData): Promise<PostJobState> {
  const honeypot = formData.get("nickname");
  if (typeof honeypot === "string" && honeypot !== "") {
    return failure("Something went wrong. Please try again.", {}, 0);
  }

  const parsed = parsePosting(postingInputFromFormData(formData));
  if (!parsed.success) {
    return failure("Please fix the highlighted fields.", parsed.errors);
  }
  const posting = parsed.data;

  if (!(await consumeRateLimit(RATE_LIMITS.postJob))) {
    return failure("Too many attempts from your network. Please wait a few minutes and try again.", {}, 4);
  }

  let checkoutUrl: string;
  try {
    const db = getAdminDbClient();
    const { data: jobId, error: createError } = await db.rpc("create_job_posting", {
      p_employer: toEmployerPayload(posting),
      p_job: toJobPayload(posting),
    });

    if (createError) {
      if (createError.code === "23503") {
        return failure("Please fix the highlighted fields.", { category_slug: "Choose a category from the list" });
      }
      if (createError.code === "23514" || createError.code === "22P02" || createError.code === "22023") {
        console.warn("[post-job] database rejected validated posting", createError);
        return failure("Some details could not be saved. Please review the form and try again.", {}, 0);
      }
      console.error("[post-job] create_job_posting failed", createError);
      return failure(UNAVAILABLE, {}, 4);
    }

    const session = await createCheckoutSession({
      jobId,
      plan: planFor(posting.featured),
      jobTitle: posting.title,
      company: posting.company_name,
      customerEmail: posting.contact_email,
      origin: deploymentOrigin(),
    });

    const { error: attachError } = await db.rpc("attach_checkout_session", {
      p_job_id: jobId,
      p_session_id: session.id,
    });
    if (attachError) {
      console.error("[post-job] attach_checkout_session failed", attachError);
      return failure(UNAVAILABLE, {}, 4);
    }

    checkoutUrl = session.url;
  } catch (error) {
    console.error("[post-job] checkout could not be started", error);
    return failure(error instanceof EnvConfigError ? "Job posting is not configured yet." : UNAVAILABLE, {}, 4);
  }

  // External Stripe-hosted URL; typed routes only model internal paths.
  redirect(checkoutUrl as Route);
}
