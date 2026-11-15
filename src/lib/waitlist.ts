import { z } from "zod";
import { emailSchema } from "@/lib/validation";

export const WAITLIST_LIMITS = { company: 120, roleNote: 1000 } as const;

/** Mirrors the CHECK constraints on public.employer_waitlist. */
export const waitlistSchema = z.object({
  email: emailSchema,
  company: z
    .string()
    .trim()
    .min(1, "Enter your company name")
    .max(WAITLIST_LIMITS.company, `Keep the company name under ${WAITLIST_LIMITS.company} characters`),
  roleNote: z
    .string()
    .trim()
    .max(WAITLIST_LIMITS.roleNote, `Keep the note under ${WAITLIST_LIMITS.roleNote} characters`)
    .transform((value) => (value === "" ? null : value)),
});

export type WaitlistInput = z.infer<typeof waitlistSchema>;
export type WaitlistFieldErrors = Partial<Record<keyof WaitlistInput, string>>;
