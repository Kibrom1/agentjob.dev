"use client";

import { useActionState, useEffect } from "react";
import { joinEmployerWaitlist, type WaitlistState } from "@/app/post-a-job/waitlist-actions";
import { track } from "@/lib/analytics";
import { WAITLIST_LIMITS } from "@/lib/waitlist";

const INITIAL: WaitlistState = { status: "idle" };

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm placeholder:text-zinc-400 focus:border-accent-500 focus:ring-4 focus:ring-accent-500/15 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900";

/** Employer waitlist for the "coming soon" posting page. */
export function WaitlistForm({ mailtoHref }: { mailtoHref: string | null }) {
  const [state, formAction, isPending] = useActionState(joinEmployerWaitlist, INITIAL);

  const counted = state.status === "success" && state.countable;
  useEffect(() => {
    if (counted) track("post_job_interest", { action: "waitlist_submit" });
  }, [counted]);

  if (state.status === "success") {
    return (
      <p role="status" className="mt-8 rounded-lg bg-accent-50 px-4 py-3 text-sm text-accent-700 dark:bg-accent-950 dark:text-accent-400">
        You&apos;re on the employer waitlist. We&apos;ll email you the moment posting opens.
      </p>
    );
  }

  const errors = state.status === "error" ? state.fieldErrors : {};
  const values = state.status === "error" ? state.values : { email: "", company: "", roleNote: "" };

  return (
    <form action={formAction} className="mt-8 space-y-4" noValidate>
      {/* Honeypot: invisible to people, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="waitlist-nickname">Nickname</label>
        <input id="waitlist-nickname" name="nickname" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div>
        <label htmlFor="waitlist-email" className="text-sm font-medium">
          Work email
        </label>
        <input
          id="waitlist-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="you@company.com"
          defaultValue={values.email}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? "waitlist-email-error" : undefined}
          className={`mt-1 h-10 ${inputClass}`}
        />
        {errors.email && (
          <p id="waitlist-email-error" role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
            {errors.email}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="waitlist-company" className="text-sm font-medium">
          Company
        </label>
        <input
          id="waitlist-company"
          name="company"
          type="text"
          autoComplete="organization"
          required
          maxLength={WAITLIST_LIMITS.company}
          defaultValue={values.company}
          aria-invalid={errors.company ? true : undefined}
          aria-describedby={errors.company ? "waitlist-company-error" : undefined}
          className={`mt-1 h-10 ${inputClass}`}
        />
        {errors.company && (
          <p id="waitlist-company-error" role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
            {errors.company}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="waitlist-note" className="text-sm font-medium">
          What role are you hiring for? <span className="font-normal text-zinc-500">(optional)</span>
        </label>
        <textarea
          id="waitlist-note"
          name="roleNote"
          rows={3}
          maxLength={WAITLIST_LIMITS.roleNote}
          defaultValue={values.roleNote}
          aria-invalid={errors.roleNote ? true : undefined}
          aria-describedby={errors.roleNote ? "waitlist-note-error" : undefined}
          className={`mt-1 py-2 ${inputClass}`}
        />
        {errors.roleNote && (
          <p id="waitlist-note-error" role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
            {errors.roleNote}
          </p>
        )}
      </div>

      {state.status === "error" && Object.keys(errors).length === 0 && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="submit"
          disabled={isPending}
          className="h-10 rounded-lg bg-accent-700 px-4 text-sm font-medium text-white transition-colors hover:bg-accent-800 disabled:cursor-wait disabled:opacity-70"
        >
          {isPending ? "Joining…" : "Join the waitlist"}
        </button>
        {mailtoHref && (
          <a
            href={mailtoHref}
            onClick={() => track("post_job_interest", { action: "mailto_click" })}
            className="text-sm text-zinc-600 underline underline-offset-2 dark:text-zinc-400"
          >
            or email us instead
          </a>
        )}
      </div>
      <p className="text-xs text-zinc-500">We only use these details to tell you when posting opens.</p>
    </form>
  );
}
