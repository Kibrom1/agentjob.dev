"use client";

import { useEffect } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/** Last-resort boundary for failures in the root layout itself. */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "4rem 1rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.5rem", margin: 0 }}>Something went wrong</h1>
        <p style={{ color: "#52525b" }}>The page failed to load. Please try again.</p>
        {error.digest && <p style={{ color: "#a1a1aa", fontFamily: "monospace", fontSize: 12 }}>Reference: {error.digest}</p>}
        <button
          type="button"
          onClick={reset}
          style={{ marginTop: "1rem", padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #d4d4d8", cursor: "pointer" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
