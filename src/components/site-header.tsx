import Link from "next/link";
import { Logo } from "@/components/logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70 dark:border-zinc-800/80 dark:bg-zinc-950/85 dark:supports-[backdrop-filter]:bg-zinc-950/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
          <Link
            href="/"
            className="hidden rounded-md px-3 py-1.5 whitespace-nowrap text-zinc-600 sm:inline-flex transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            Browse jobs
          </Link>
          <Link
            href={{ pathname: "/", hash: "subscribe" }}
            className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium whitespace-nowrap text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Weekly digest
          </Link>
        </nav>
      </div>
    </header>
  );
}
