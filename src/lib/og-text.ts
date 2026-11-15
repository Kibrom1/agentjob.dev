/**
 * Pure text helpers for generated share cards. Satori renders text nodes as
 * glyphs (never as HTML), so escaping is not required for safety; what matters
 * is stripping control/bidi characters and capping length so a hostile or
 * oversized title cannot break the layout or bloat the image.
 */

// C0/C1 controls, zero-width and bidi override/isolate characters, line/paragraph separators.
const UNSAFE_CHARS = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u206F\\uFEFF]", "g");

export function cleanOgText(raw: string): string {
  return raw.replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim();
}

/** Cleans then truncates to at most `max` characters (code points), preferring a word boundary. */
export function truncateOgText(raw: string, max: number): string {
  const chars = Array.from(cleanOgText(raw));
  if (chars.length <= max) return chars.join("");
  const cut = chars.slice(0, Math.max(1, max - 1)).join("");
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

export const OG_LIMITS = { title: 90, company: 50, location: 60 } as const;
