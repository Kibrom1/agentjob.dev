"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-checks payment status every few seconds, for at most two minutes. */
export function RefreshWhilePending({ intervalMs = 4000, maxAttempts = 30 }: { intervalMs?: number; maxAttempts?: number }) {
  const router = useRouter();

  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts > maxAttempts) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [router, intervalMs, maxAttempts]);

  return null;
}
