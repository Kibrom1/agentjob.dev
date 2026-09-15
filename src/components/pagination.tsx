import Link from "next/link";
import type { Route } from "next";

type PaginationProps = {
  page: number;
  pageCount: number;
  hrefForPage: (page: number) => Route;
};

const LINK_CLASSES =
  "inline-flex h-9 items-center rounded-lg border border-zinc-200 px-3 text-sm font-medium transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600";
const DISABLED_CLASSES =
  "inline-flex h-9 items-center rounded-lg border border-zinc-100 px-3 text-sm text-zinc-300 dark:border-zinc-900 dark:text-zinc-700";

export function Pagination({ page, pageCount, hrefForPage }: PaginationProps) {
  if (pageCount <= 1) return null;

  const hasPrevious = page > 1;
  const hasNext = page < pageCount;

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
      {hasPrevious ? (
        <Link href={hrefForPage(page - 1)} rel="prev" className={LINK_CLASSES}>
          ← Newer
        </Link>
      ) : (
        <span aria-hidden="true" className={DISABLED_CLASSES}>
          ← Newer
        </span>
      )}
      <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
        Page {page} of {pageCount}
      </p>
      {hasNext ? (
        <Link href={hrefForPage(page + 1)} rel="next" className={LINK_CLASSES}>
          Older →
        </Link>
      ) : (
        <span aria-hidden="true" className={DISABLED_CLASSES}>
          Older →
        </span>
      )}
    </nav>
  );
}
