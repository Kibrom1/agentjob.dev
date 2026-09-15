import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
      <p className="font-mono text-sm text-accent-700 dark:text-accent-400">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">This role isn&apos;t available</h1>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">
        The listing may have been filled or expired, or the link is mistyped.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex h-10 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Browse open roles
      </Link>
    </div>
  );
}
