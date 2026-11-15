"use server";

import { confirmByToken, type ConfirmResult } from "@/lib/digest/confirm";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export type ConfirmState = { status: "idle" } | { status: "done"; result: ConfirmResult | "rate_limited" };

export async function confirmSubscription(_previous: ConfirmState, formData: FormData): Promise<ConfirmState> {
  if (!(await consumeRateLimit(RATE_LIMITS.digestConfirm))) {
    return { status: "done", result: "rate_limited" };
  }
  const token = formData.get("token");
  const result = await confirmByToken(typeof token === "string" ? token : "");
  return { status: "done", result };
}
