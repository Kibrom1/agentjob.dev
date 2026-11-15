import type { ReactNode } from "react";
import { isPlaceholder, legalConfig } from "@/lib/legal";

/** Renders a legal value; unfilled placeholders are visibly highlighted. */
export function LegalValue({ value }: { value: string }) {
  if (!isPlaceholder(value)) return <>{value}</>;
  return (
    <mark className="rounded bg-amber-100 px-1 font-mono text-[0.85em] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      {value}
    </mark>
  );
}

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Last updated: <LegalValue value={legalConfig.lastUpdated} />
      </p>
      <div className="prose prose-zinc mt-8 max-w-none prose-headings:tracking-tight prose-a:text-accent-700 prose-a:underline-offset-2 dark:prose-invert dark:prose-a:text-accent-400">
        {children}
      </div>
    </article>
  );
}

export function ContactLink({ email }: { email: string }) {
  if (isPlaceholder(email)) return <LegalValue value={email} />;
  return <a href={`mailto:${email}`}>{email}</a>;
}
