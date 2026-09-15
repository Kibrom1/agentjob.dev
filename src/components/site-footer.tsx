import { siteConfig } from "@/lib/site";

export function SiteFooter() {
  const year = new Date().getUTCFullYear();

  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:text-zinc-400">
        <p>
          <span className="font-mono text-zinc-700 dark:text-zinc-300">{siteConfig.domain}</span> — {siteConfig.tagline}.
        </p>
        <p>© {year} {siteConfig.name}</p>
      </div>
    </footer>
  );
}
