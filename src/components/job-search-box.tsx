"use client";

import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition, type FormEvent } from "react";
import { SEARCH_QUERY_MAX_LENGTH } from "@/lib/validation";

const DEBOUNCE_MS = 300;

/** Params the search box carries along when it submits (without JS). */
type PreservedFilters = {
  category?: string;
  workplace?: string;
  tag?: string;
};

type JobSearchBoxProps = {
  preserved: PreservedFilters;
};

/**
 * Instant search: updates `?q=` as the user types (debounced) and replaces the
 * history entry so the back button isn't flooded. Without JavaScript it is a
 * plain GET form that keeps the other active filters.
 *
 * The input is uncontrolled so typing is never overwritten by a URL update
 * that lands mid-keystroke. When the URL changes for another reason (e.g.
 * "Clear filters"), the effect below re-syncs the field unless it has focus.
 */
export function JobSearchBox({ preserved }: JobSearchBoxProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const input = inputRef.current;
    if (input && document.activeElement !== input && input.value.trim() !== urlQuery) {
      input.value = urlQuery;
    }
  }, [urlQuery]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function navigate(rawValue: string) {
    const query = rawValue.trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
    // Read the live URL rather than a render-time snapshot: filters may have
    // changed while the debounce timer was pending.
    const params = new URLSearchParams(window.location.search);
    if (query === (params.get("q") ?? "")) return;

    if (query) params.set("q", query);
    else params.delete("q");
    params.delete("page");

    const qs = params.toString();
    const href = (qs ? `/?${qs}` : "/") as Route;
    startTransition(() => {
      router.replace(href, { scroll: false });
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearTimeout(timerRef.current);
    navigate(inputRef.current?.value ?? "");
  }

  function clear() {
    clearTimeout(timerRef.current);
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.focus();
    }
    navigate("");
  }

  return (
    <form role="search" action="/" method="get" onSubmit={handleSubmit} className="relative">
      <label htmlFor="job-search" className="sr-only">
        Search jobs
      </label>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-400"
      >
        <path
          fillRule="evenodd"
          d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.45 4.39l3.08 3.08a.75.75 0 1 1-1.06 1.06l-3.08-3.08A7 7 0 0 1 2 9Z"
          clipRule="evenodd"
        />
      </svg>
      <input
        ref={inputRef}
        id="job-search"
        name="q"
        type="search"
        defaultValue={urlQuery}
        maxLength={SEARCH_QUERY_MAX_LENGTH}
        placeholder="Search roles, companies or stacks — e.g. LangGraph, vLLM, MCP"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        onChange={(event) => {
          const value = event.currentTarget.value;
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => navigate(value), DEBOUNCE_MS);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && event.currentTarget.value) {
            event.preventDefault();
            clear();
          }
        }}
        className="peer h-12 w-full rounded-xl border border-zinc-300 bg-white pr-20 pl-10 text-[15px] shadow-sm transition-colors placeholder:text-zinc-400 hover:border-zinc-400 focus:border-accent-500 focus:ring-4 focus:ring-accent-500/15 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600"
      />
      {preserved.category && <input type="hidden" name="category" value={preserved.category} />}
      {preserved.workplace && <input type="hidden" name="workplace" value={preserved.workplace} />}
      {preserved.tag && <input type="hidden" name="tag" value={preserved.tag} />}

      {/* Direct sibling of the input so `peer-placeholder-shown` can hide it when empty. */}
      <button
        type="button"
        onClick={clear}
        className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-xs text-zinc-500 peer-placeholder-shown:hidden hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        Clear
      </button>
      {isPending && (
        <span
          role="status"
          aria-label="Updating results"
          className="absolute top-1/2 right-16 size-4 -translate-y-1/2 animate-spin rounded-full border-2 border-zinc-300 border-t-accent-600"
        />
      )}
      <button type="submit" className="sr-only">
        Search
      </button>
    </form>
  );
}
