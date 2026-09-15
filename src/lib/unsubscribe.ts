import "server-only";
import { z } from "zod";
import { getPublicDbClient } from "@/lib/supabase/server";

export const tokenSchema = z.uuid();

export type UnsubscribeResult = "unsubscribed" | "unknown_token" | "error";

/** Uses the public key: unsubscribe_from_digest is the one anon-callable write. */
export async function unsubscribeByToken(token: string): Promise<UnsubscribeResult> {
  if (!tokenSchema.safeParse(token).success) return "unknown_token";
  try {
    const { data, error } = await getPublicDbClient().rpc("unsubscribe_from_digest", { p_token: token });
    if (error) {
      console.error("[unsubscribe] rpc failed", { code: error.code, message: error.message });
      return "error";
    }
    return data ? "unsubscribed" : "unknown_token";
  } catch (cause) {
    console.error("[unsubscribe] request failed", cause);
    return "error";
  }
}
