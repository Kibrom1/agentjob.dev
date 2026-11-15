"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmSubscription, type ConfirmState } from "./actions";

const MESSAGES = {
  confirmed: {
    title: "You're subscribed",
    body: "Thanks for confirming. The weekly digest of new AI agent roles will land in your inbox every Monday. Every email has an unsubscribe link.",
  },
  invalid: {
    title: "Link not recognised or expired",
    body: "This confirmation link is invalid, has expired, or the address has unsubscribed. Submit your email on the homepage again to get a fresh link.",
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

const INITIAL: ConfirmState = { status: "idle" };

export function ConfirmForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmSubscription, INITIAL);

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
          Browse the job board
        </Link>
      </div>
    );
  }

  return (
    <form action={action}>
      <h1 className="text-2xl font-semibold tracking-tight">Confirm your subscription</h1>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">
        One click to start receiving the Agentic Roles weekly email with new roles for engineers building AI agents.
      </p>
      <input type="hidden" name="token" value={token} />
      <button
        type="submit"
        disabled={pending}
        className="mt-8 h-10 rounded-lg bg-accent-700 px-4 text-sm font-medium text-white transition-colors hover:bg-accent-800 disabled:opacity-70"
      >
        {pending ? "Confirming…" : "Confirm subscription"}
      </button>
    </form>
  );
}
