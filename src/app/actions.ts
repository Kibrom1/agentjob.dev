"use server";

import { z } from "zod";
import { requestDigestSignup } from "@/lib/digest/signup";
import { createSignupDeps } from "@/lib/digest/signup-deps";
import { getEmailEnv, isEmailConfigured } from "@/lib/env";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { siteConfig } from "@/lib/site";
import { emailSchema } from "@/lib/validation";

export type SubscribeState =
  | { status: "idle" }
  | { status: "success"; message: string; /** False for honeypot hits so analytics ignore bots. */ countable: boolean }
  | { status: "error"; message: string; email: string };

const SUCCESS_MESSAGE =
  "We sent a confirmation link to that address. Click it and the weekly digest starts. If it doesn't arrive in a few minutes, check spam or submit the form again.";
const GENERIC_ERROR = "We couldn't save your email right now. Please try again in a minute.";

const sourceSchema = z.enum(["website", "job-page"]).catch("website");

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Newsletter signup (double opt-in). The address is stored as pending and a
 * confirmation email with the newest roles is sent; only a click on its link
 * makes the address eligible for the digest. Resubmitting resends the email
 * (per-address cooldown in the database, per-network limit here). The answer
 * is identical for new, pending, confirmed and unsubscribed addresses, so the
 * form cannot be used to probe who is on the list. Submissions that fill the
 * honeypot field are silently accepted so bots get no signal.
 */
export async function subscribeToDigest(_previous: SubscribeState, formData: FormData): Promise<SubscribeState> {
  const rawEmail = readString(formData, "email");

  if (readString(formData, "website") !== "") {
    return { status: "success", message: SUCCESS_MESSAGE, countable: false };
  }

  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Enter a valid email address",
      email: rawEmail,
    };
  }

  const source = sourceSchema.parse(readString(formData, "source"));

  if (!(await consumeRateLimit(RATE_LIMITS.subscribe))) {
    return { status: "error", message: "Too many signups from your network. Please try again later.", email: rawEmail };
  }

  if (!isEmailConfigured()) {
    console.error("[subscribe] email is not configured; cannot send confirmation");
    return { status: "error", message: GENERIC_ERROR, email: rawEmail };
  }

  try {
    await requestDigestSignup(
      createSignupDeps(),
      { siteUrl: siteConfig.url.toString(), postalAddress: getEmailEnv().POSTAL_ADDRESS },
      { email: parsed.data, source },
    );
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "22023") {
      return { status: "error", message: "Enter a valid email address", email: rawEmail };
    }
    // Missing configuration, network failure, timeout or a provider error.
    console.error("[subscribe] request failed", cause);
    return { status: "error", message: GENERIC_ERROR, email: rawEmail };
  }

  return { status: "success", message: SUCCESS_MESSAGE, countable: true };
}
