import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <p className="font-mono text-xs tracking-wider text-accent-700 uppercase dark:text-accent-400">Admin console</p>
        <nav aria-label="Admin" className="flex gap-2 text-sm">
          <Link href="/admin" className="rounded-md px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            Jobs
          </Link>
          <Link
            href="/admin/jobs/new"
            className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            New listing
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
