"use client";

import { useState } from "react";
import { companyInitials } from "@/lib/format";

type CompanyLogoProps = {
  company: string;
  logoUrl: string | null;
  size?: "md" | "lg";
};

const SIZE_CLASSES = {
  md: "size-11 text-sm",
  lg: "size-16 text-lg",
} as const;

const PIXELS = { md: 44, lg: 64 } as const;

/**
 * Employer-supplied logos come from arbitrary HTTPS hosts. They are rendered
 * with a plain <img> (not next/image) so the app's image optimizer is never an
 * open proxy, and fall back to initials when missing or broken.
 */
export function CompanyLogo({ company, logoUrl, size = "md" }: CompanyLogoProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(logoUrl) && failedUrl !== logoUrl;
  const base = `${SIZE_CLASSES[size]} shrink-0 rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900`;

  if (showImage && logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- see component doc comment
      <img
        src={logoUrl}
        alt={`${company} logo`}
        width={PIXELS[size]}
        height={PIXELS[size]}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(logoUrl)}
        className={`${base} object-contain p-1`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${base} grid place-items-center font-mono font-semibold text-zinc-500 dark:text-zinc-400`}
    >
      {companyInitials(company)}
    </span>
  );
}
