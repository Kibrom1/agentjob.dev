"use client";

import Link from "next/link";
import { useEffect } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
      <p className="font-mono text-sm text-accent-700 dark:text-accent-400">503</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">We couldn&apos;t load the job board</h1>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">
        Something went wrong while fetching listings. This is usually temporary — please try again.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-zinc-400">
          Reference: <span className="select-all">{error.digest}</span>
        </p>
      )}
      <div className="mt-8 flex justify-center gap-3">
        <button
          type="button"
          onClick={reset}
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
