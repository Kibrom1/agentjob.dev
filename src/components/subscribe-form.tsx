"use client";

import { useActionState } from "react";
import { subscribeToDigest, type SubscribeState } from "@/app/actions";

type SubscribeFormProps = {
  source: "website" | "job-page";
  /** Unique per page so multiple forms never share element ids. */
  idPrefix: string;
};

const INITIAL_STATE: SubscribeState = { status: "idle" };

export function SubscribeForm({ source, idPrefix }: SubscribeFormProps) {
  const [state, formAction, isPending] = useActionState(subscribeToDigest, INITIAL_STATE);
  const emailId = `${idPrefix}-email`;
  const messageId = `${idPrefix}-message`;

  if (state.status === "success") {
    return (
      <p role="status" className="rounded-lg bg-accent-50 px-3 py-2.5 text-sm text-accent-700 dark:bg-accent-950 dark:text-accent-400">
        {state.message}
      </p>
    );
  }

  const hasError = state.status === "error";

  return (
    <form action={formAction} className="space-y-2" noValidate>
      <input type="hidden" name="source" value={source} />
      {/* Honeypot: invisible to people, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${idPrefix}-website`}>Website</label>
        <input id={`${idPrefix}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <label htmlFor={emailId} className="sr-only">
        Email address
      </label>
      <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
        <input
          id={emailId}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          placeholder="you@company.com"
          defaultValue={hasError ? state.email : ""}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? messageId : undefined}
          className={`h-10 w-full min-w-0 rounded-lg sm:flex-1 lg:flex-none border bg-white px-3 text-sm placeholder:text-zinc-400 focus:ring-4 focus:outline-none dark:bg-zinc-900 ${
            hasError
              ? "border-red-500 focus:border-red-500 focus:ring-red-500/15"
              : "border-zinc-300 focus:border-accent-500 focus:ring-accent-500/15 dark:border-zinc-700"
          }`}
        />
        <button
          type="submit"
          disabled={isPending}
          className="h-10 shrink-0 rounded-lg bg-accent-600 px-4 text-sm font-medium text-white transition-colors hover:bg-accent-700 disabled:cursor-wait disabled:opacity-70"
        >
          {isPending ? "Subscribing…" : "Subscribe"}
        </button>
      </div>
      {hasError && (
        <p id={messageId} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      )}
    </form>
  );
}
