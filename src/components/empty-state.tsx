import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description: ReactNode;
  action?: { label: string; href: Route };
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 px-6 py-14 text-center dark:border-zinc-700">
      <p aria-hidden="true" className="font-mono text-2xl text-zinc-300 dark:text-zinc-700">
        {"{ }"}
      </p>
      <h2 className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      <div className="mx-auto mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">{description}</div>
      {action && (
        <Link
          href={action.href}
          className="mt-5 inline-flex h-9 items-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
