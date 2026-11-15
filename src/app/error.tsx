"use client";

import Link from "next/link";
import { useEffect } from "react";

type ErrorPageProps = {
  error: unknown;
  retry: () => void;
};

export default function ErrorPage({ error, retry }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : undefined;

  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">
        We hit an unexpected error loading this page. This is usually temporary — please try again.
      </p>
      {digest && (
        <p className="mt-2 font-mono text-xs text-zinc-500 dark:text-zinc-400">
          Reference: <span className="select-all">{digest}</span>
        </p>
      )}
      <div className="mt-8 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex h-10 items-center rounded-lg border border-zinc-300 px-4 text-sm font-medium transition-colors hover:border-zinc-500 dark:border-zinc-700"
        >
          Back to all jobs
        </Link>
      </div>
    </div>
  );
}
