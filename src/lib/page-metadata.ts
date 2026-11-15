import type { Metadata } from "next";
import { siteConfig } from "@/lib/site";

type PageMetadataInput = {
  title: string;
  description: string;
  /** Site-relative path, e.g. "/post-a-job". Used for canonical and og:url. */
  path: string;
};

/**
 * Child pages that set only `title`/`description` still inherit the root
 * layout's `openGraph`/`twitter` objects, so a share preview shows the home
 * page's title and URL. This sets all three consistently per page.
 */
export function pageMetadata({ title, description, path }: PageMetadataInput): Metadata {
  const socialTitle = `${title} · ${siteConfig.name}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: siteConfig.name, title: socialTitle, description, url: path },
    twitter: { card: "summary_large_image", title: socialTitle, description },
  };
}
