"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmUnsubscribe, type UnsubscribeState } from "./actions";

const MESSAGES = {
  unsubscribed: {
    title: "You're unsubscribed",
    body: "You won't receive the weekly digest anymore. You can always subscribe again from the homepage.",
  },
  unknown_token: {
    title: "Link not recognised",
    body: "This unsubscribe link is invalid or has already been replaced. If you keep receiving emails, reply to one and we'll remove you manually.",
  },
  error: {
    title: "Something went wrong",
    body: "We couldn't process the request just now. Please try again in a minute.",
  },
  rate_limited: {
    title: "Too many attempts",
    body: "Please wait a little while and try again.",
  },
} as const;

const INITIAL: UnsubscribeState = { status: "idle" };

export function UnsubscribeForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmUnsubscribe, INITIAL);

  if (state.status === "done") {
    const message = MESSAGES[state.result];
    return (
      <div role="status">
        <h1 className="text-2xl font-semibold tracking-tight">{message.title}</h1>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">{message.body}</p>
        <Link
          href="/"
          className="mt-8 inline-flex h-10 items-center rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:border-zinc-500 dark:border-zinc-700"
        >
          Back to the job board
        </Link>
      </div>
    );
  }

  return (
    <form action={action}>
      <h1 className="text-2xl font-semibold tracking-tight">Unsubscribe from the weekly digest?</h1>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">
        You&apos;ll stop receiving the AgentJob weekly email. This takes effect immediately.
      </p>
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        className="mt-8 h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-70 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Unsubscribing…" : "Confirm unsubscribe"}
      </button>
    </form>
  );
}
