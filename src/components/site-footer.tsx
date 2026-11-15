import Link from "next/link";
import { LegalValue } from "@/components/legal-page";
import { LEGAL_LINKS, legalConfig } from "@/lib/legal";
import { siteConfig } from "@/lib/site";

const linkClass = "hover:text-zinc-900 hover:underline dark:hover:text-zinc-100";

export function SiteFooter() {
  const year = new Date().getUTCFullYear();

  return (
    <footer className="border-t border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 text-sm text-zinc-600 sm:px-6 dark:text-zinc-400">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <p>
            <span className="font-mono text-zinc-700 dark:text-zinc-300">{siteConfig.domain}</span> — {siteConfig.tagline}.
          </p>
          <nav aria-label="Legal">
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <a href={`mailto:${legalConfig.contactEmail}`} className={linkClass}>
                  Contact
                </a>
              </li>
              <li>
                <Link href="/post-a-job" className={linkClass}>
                  Post a job
                </Link>
              </li>
            </ul>
          </nav>
        </div>
        <p className="text-xs">
          © {year} <LegalValue value={legalConfig.companyName} />
          {legalConfig.postalAddress && (
            <>
              {" "}
              · <LegalValue value={legalConfig.postalAddress} />
            </>
          )}{" "}
          · <LegalValue value={legalConfig.contactEmail} />
        </p>
      </div>
    </footer>
  );
}
