import type { Route } from "next";
import { z } from "zod";
import { siteConfig } from "@/lib/site";
import type { JobSearchFilters } from "@/lib/types";
import { SEARCH_QUERY_MAX_LENGTH, slugSchema, tagSchema, workplaceSchema } from "@/lib/validation";

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}

const pageSchema = z.coerce.number().int().min(1).max(siteConfig.maxPage);

/**
 * Parses untrusted URL params into filters. Invalid values are dropped rather
 * than rejected so a hand-edited or stale URL still renders a useful page.
 */
export function parseJobSearchParams(params: RawSearchParams): JobSearchFilters {
  const query = first(params.q)?.slice(0, SEARCH_QUERY_MAX_LENGTH);
  const category = slugSchema.safeParse(first(params.category));
  const workplace = workplaceSchema.safeParse(first(params.workplace));
  const tag = tagSchema.safeParse(first(params.tag));
  const page = pageSchema.safeParse(first(params.page) ?? 1);

  return {
    query,
    category: category.success ? category.data : undefined,
    workplace: workplace.success ? workplace.data : undefined,
    tag: tag.success ? tag.data : undefined,
    page: page.success ? page.data : 1,
  };
}

export function hasActiveFilters(filters: JobSearchFilters): boolean {
  return Boolean(filters.query || filters.category || filters.workplace || filters.tag);
}

/**
 * Builds a feed URL from filters. Any change other than `page` resets
 * pagination to page 1.
 */
export function buildJobSearchHref(current: JobSearchFilters, changes: Partial<JobSearchFilters> = {}): Route {
  const next: JobSearchFilters = {
    ...current,
    ...changes,
    page: "page" in changes && changes.page !== undefined ? changes.page : 1,
  };

  const params = new URLSearchParams();
  if (next.query) params.set("q", next.query);
  if (next.category) params.set("category", next.category);
  if (next.workplace) params.set("workplace", next.workplace);
  if (next.tag) params.set("tag", next.tag);
  if (next.page > 1) params.set("page", String(next.page));

  const qs = params.toString();
  return (qs ? `/?${qs}` : "/") as Route;
}
