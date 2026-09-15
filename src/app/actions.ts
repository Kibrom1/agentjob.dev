"use server";

import { z } from "zod";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getPublicDbClient } from "@/lib/supabase/server";
import { emailSchema } from "@/lib/validation";

export type SubscribeState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | { status: "error"; message: string; email: string };

const SUCCESS_MESSAGE = "You're on the list. Watch your inbox for the weekly digest.";
const GENERIC_ERROR = "We couldn't save your email right now. Please try again in a minute.";

const sourceSchema = z.enum(["website", "job-page"]).catch("website");

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Newsletter signup. Always answers the same way for new and existing
 * addresses (the RPC is enumeration-safe), and silently accepts submissions
 * that fill the honeypot field so bots get no signal.
 */
export async function subscribeToDigest(_previous: SubscribeState, formData: FormData): Promise<SubscribeState> {
  const rawEmail = readString(formData, "email");

  if (readString(formData, "website") !== "") {
    return { status: "success", message: SUCCESS_MESSAGE };
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

  try {
    const { error } = await getPublicDbClient().rpc("subscribe_to_digest", {
      p_email: parsed.data,
      p_source: source,
    });

    if (error) {
      if (error.code === "22023") {
        return { status: "error", message: "Enter a valid email address", email: rawEmail };
      }
      console.error("[subscribe] rpc failed", { code: error.code, message: error.message });
      return { status: "error", message: GENERIC_ERROR, email: rawEmail };
    }
  } catch (cause) {
    // Missing configuration, network failure or timeout.
    console.error("[subscribe] request failed", cause);
    return { status: "error", message: GENERIC_ERROR, email: rawEmail };
  }

  return { status: "success", message: SUCCESS_MESSAGE };
}
