import Link from "next/link";
import { siteConfig } from "@/lib/site";

/** Splits "agenticroles.dev" into the wordmark and its TLD so the logo always matches siteConfig.domain. */
export function splitDomain(domain: string): { label: string; tld: string } {
  const dot = domain.lastIndexOf(".");
  return dot === -1 ? { label: domain, tld: "" } : { label: domain.slice(0, dot), tld: domain.slice(dot) };
}

export function Logo() {
  const { label, tld } = splitDomain(siteConfig.domain);
  return (
    <Link
      href="/"
      className="group inline-flex items-center gap-2 font-mono text-sm font-semibold tracking-tight"
      aria-label={`${siteConfig.name} home`}
    >
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-md bg-zinc-900 text-[11px] text-accent-400 transition-colors group-hover:bg-accent-700 group-hover:text-white dark:bg-zinc-100 dark:text-accent-700"
      >
        {">_"}
      </span>
      <span>
        {label}
        <span className="text-zinc-400 dark:text-zinc-500">{tld}</span>
      </span>
    </Link>
  );
}
