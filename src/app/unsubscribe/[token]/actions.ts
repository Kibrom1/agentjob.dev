"use server";

import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { unsubscribeByToken, type UnsubscribeResult } from "@/lib/unsubscribe";

export type UnsubscribeState = { status: "idle" } | { status: "done"; result: UnsubscribeResult | "rate_limited" };

export async function confirmUnsubscribe(_previous: UnsubscribeState, formData: FormData): Promise<UnsubscribeState> {
  if (!(await consumeRateLimit(RATE_LIMITS.unsubscribe))) {
    return { status: "done", result: "rate_limited" };
  }
  const token = formData.get("token");
  const result = await unsubscribeByToken(typeof token === "string" ? token : "");
  return { status: "done", result };
}
