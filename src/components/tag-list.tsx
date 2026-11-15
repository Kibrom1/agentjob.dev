import Link from "next/link";
import type { Route } from "next";

type TagListProps = {
  tags: string[];
  activeTag?: string;
  /** Build the href for a tag; omit to render static (non-link) tags. */
  hrefForTag?: (tag: string) => Route;
  className?: string;
  /** Show at most this many tags, then a non-interactive "+N" chip. Default: all. */
  max?: number;
};

/** Split tags into the visible slice and the count hidden by `max`. */
export function splitTags(tags: string[], max?: number): { visible: string[]; hidden: number } {
  if (max === undefined || !Number.isFinite(max) || max < 0 || tags.length <= max) {
    return { visible: tags, hidden: 0 };
  }
  const cap = Math.floor(max);
  return { visible: tags.slice(0, cap), hidden: tags.length - cap };
}

const TAG_BASE = "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs leading-5 transition-colors";
const TAG_IDLE =
  "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400";
const TAG_ACTIVE = "border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-950 dark:text-accent-400";

export function TagList({ tags, activeTag, hrefForTag, className = "", max }: TagListProps) {
  if (tags.length === 0) return null;
  const { visible, hidden } = splitTags(tags, max);

  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`} aria-label="Tags">
      {visible.map((tag) => {
        const active = tag === activeTag;
        const classes = `${TAG_BASE} ${active ? TAG_ACTIVE : TAG_IDLE}`;
        return (
          <li key={tag}>
            {hrefForTag ? (
              <Link
                href={hrefForTag(tag)}
                className={`${classes} relative z-10 hover:border-zinc-400 hover:text-zinc-900 dark:hover:border-zinc-600 dark:hover:text-zinc-100`}
                aria-current={active ? "true" : undefined}
                prefetch={false}
              >
                {tag}
              </Link>
            ) : (
              <span className={classes}>{tag}</span>
            )}
          </li>
        );
      })}
      {hidden > 0 && (
        <li>
          <span className={`${TAG_BASE} ${TAG_IDLE}`} aria-label={`${hidden} more ${hidden === 1 ? "tag" : "tags"}`}>
            +{hidden}
          </span>
        </li>
      )}
    </ul>
  );
}
