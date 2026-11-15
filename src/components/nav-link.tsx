"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavLinkProps = {
  href: Route;
  children: ReactNode;
  /** Classes for the link in every state. */
  className: string;
  /** Extra classes applied only while the link points at the current page. */
  activeClassName?: string;
};

/** Primary-nav link that sets `aria-current="page"` when it matches the path. */
export function NavLink({ href, children, className, activeClassName = "" }: NavLinkProps) {
  const pathname = usePathname();
  const current = pathname === href;
  return (
    <Link href={href} aria-current={current ? "page" : undefined} className={current ? `${className} ${activeClassName}` : className}>
      {children}
    </Link>
  );
}
