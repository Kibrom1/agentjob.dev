"use server";

import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { getAdminDbClient } from "@/lib/supabase/admin";
import { waitlistSchema, type WaitlistFieldErrors } from "@/lib/waitlist";

export type WaitlistState =
  | { status: "idle" }
  | { status: "success"; /** False for honeypot hits so analytics ignore bots. */ countable: boolean }
  | { status: "error"; message: string; fieldErrors: WaitlistFieldErrors; values: { email: string; company: string; roleNote: string } };

const GENERIC_ERROR = "We couldn't save your details right now. Please try again in a minute.";

function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Employer waitlist signup for the "coming soon" posting page. Stored with the
 * service role (the table has no client grants). Re-submitting the same email
 * updates the existing row, so the answer never reveals whether it was known.
 */
export async function joinEmployerWaitlist(_previous: WaitlistState, formData: FormData): Promise<WaitlistState> {
  // Honeypot: invisible to people; bots get the same success answer.
  if (readString(formData, "nickname") !== "") {
    return { status: "success", countable: false };
  }

  const values = {
    email: readString(formData, "email"),
    company: readString(formData, "company"),
    roleNote: readString(formData, "roleNote"),
  };

  const parsed = waitlistSchema.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: WaitlistFieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if ((key === "email" || key === "company" || key === "roleNote") && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, values };
  }

  if (!(await consumeRateLimit(RATE_LIMITS.waitlist))) {
    return { status: "error", message: "Too many requests from your network. Please try again later.", fieldErrors: {}, values };
  }

  try {
    const { error } = await getAdminDbClient()
      .from("employer_waitlist")
      .upsert(
        {
          email: parsed.data.email,
          company: parsed.data.company,
          role_note: parsed.data.roleNote,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "email" },
      );
    if (error) {
      console.error("[waitlist] upsert failed", { code: error.code, message: error.message });
      return { status: "error", message: GENERIC_ERROR, fieldErrors: {}, values };
    }
  } catch (cause) {
    console.error("[waitlist] request failed", cause);
    return { status: "error", message: GENERIC_ERROR, fieldErrors: {}, values };
  }

  return { status: "success", countable: true };
}
