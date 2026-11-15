"use client";

import type { ReactNode } from "react";
import { track, type AnalyticsEvents } from "@/lib/analytics";

type ApplyLinkProps = {
  href: string;
  className: string;
  slug: string;
  placement: AnalyticsEvents["apply_click"]["placement"];
  children: ReactNode;
};

/** Outbound apply link that records an `apply_click` event (no personal data). */
export function ApplyLink({ href, className, slug, placement, children }: ApplyLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={() => track("apply_click", { placement, slug })}
    >
      {children}
    </a>
  );
}
