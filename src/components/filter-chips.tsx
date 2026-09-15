import Link from "next/link";
import type { Route } from "next";

export type FilterChip = {
  key: string;
  label: string;
  href: Route;
  active: boolean;
  title?: string;
};

type FilterChipsProps = {
  label: string;
  chips: FilterChip[];
};

/**
 * Horizontal, link-based filter row. Links (not buttons) keep every filter
 * state shareable, crawlable and usable without JavaScript.
 */
export function FilterChips({ label, chips }: FilterChipsProps) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
        {chips.map((chip) => (
          <li key={chip.key}>
            <Link
              href={chip.href}
              title={chip.title}
              aria-current={chip.active ? "page" : undefined}
              scroll={false}
              className={`inline-flex h-8 items-center rounded-full border px-3 text-sm whitespace-nowrap transition-colors ${
                chip.active
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
              }`}
            >
              {chip.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
