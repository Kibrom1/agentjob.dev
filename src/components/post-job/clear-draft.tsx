"use client";

import { useEffect } from "react";
import { DRAFT_STORAGE_KEY } from "@/components/post-job/post-job-form";

/** Removes the saved posting draft once checkout has succeeded. */
export function ClearDraft() {
  useEffect(() => {
    try {
      window.sessionStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // storage unavailable; nothing to clear
    }
  }, []);
  return null;
}
