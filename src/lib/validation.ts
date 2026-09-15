import { z } from "zod";
import { Constants } from "@/lib/database.types";

/** Mirrors public.is_valid_slug() in the database. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 160;

/** Mirrors the per-tag rule in public.are_valid_tags(). */
export const TAG_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9 .+#/-]{0,30}[A-Za-z0-9+#])?$/;

export const SEARCH_QUERY_MAX_LENGTH = 200;

export function isValidSlug(value: string): boolean {
  return value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value);
}

export const slugSchema = z.string().max(SLUG_MAX_LENGTH).regex(SLUG_PATTERN);
export const tagSchema = z.string().regex(TAG_PATTERN);
export const workplaceSchema = z.enum(Constants.public.Enums.workplace_type);

/** Mirrors public.is_valid_email(): the DB receives the normalised value. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Enter your email address")
  .max(254, "That email address is too long")
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email address");
