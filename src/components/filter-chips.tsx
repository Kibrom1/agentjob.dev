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
 * state shareable, crawlable and usable without JavaScript. The active chip
 * carries a check mark and heavier weight so it differs by more than colour.
 */
export function FilterChips({ label, chips }: FilterChipsProps) {
  return (
    <div className="relative -mx-4 sm:mx-0">
      <nav aria-label={label} className="overflow-x-auto px-4 scrollbar-none sm:px-0">
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
                    ? "border-zinc-900 bg-zinc-900 font-medium text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
                }`}
              >
                {chip.active && (
                  <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className="mr-1 -ml-0.5 size-3.5">
                    <path
                      fillRule="evenodd"
                      d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
                {chip.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {/* Right-edge fade hints that the row scrolls; chips wrap (no scroll) from sm up. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent sm:hidden dark:from-zinc-950"
      />
    </div>
  );
}
