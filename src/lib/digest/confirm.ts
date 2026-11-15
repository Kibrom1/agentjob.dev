import "server-only";
import { z } from "zod";
import { getPublicDbClient } from "@/lib/supabase/server";

export const confirmTokenSchema = z.uuid();

export type ConfirmResult = "confirmed" | "invalid" | "error";

/** Uses the public key: confirm_digest_subscription is anon-callable by design. */
export async function confirmByToken(token: string): Promise<ConfirmResult> {
  if (!confirmTokenSchema.safeParse(token).success) return "invalid";
  try {
    const { data, error } = await getPublicDbClient().rpc("confirm_digest_subscription", { p_token: token });
    if (error) {
      console.error("[confirm] rpc failed", { code: error.code, message: error.message });
      return "error";
    }
    return data ? "confirmed" : "invalid";
  } catch (cause) {
    console.error("[confirm] request failed", cause);
    return "error";
  }
}
