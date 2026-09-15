// Scoped to the (board) group on purpose: a root-level loading boundary would
// make every route stream, so notFound() on job pages could only return a
// soft 404 (HTTP 200) instead of a real 404 status.
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6" role="status" aria-label="Loading jobs">
      <div className="h-4 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-4 h-10 w-full max-w-xl animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-8 h-12 w-full max-w-2xl animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      <ul className="mt-10 space-y-3">
        {Array.from({ length: 5 }, (_, index) => (
          <li
            key={index}
            className="flex gap-4 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
          >
            <div className="size-11 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            </div>
          </li>
        ))}
      </ul>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
