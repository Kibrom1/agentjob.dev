export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024;
const NO_STORE = { "Cache-Control": "no-store" } as const;

type Violation = Record<string, unknown>;

/** Strip query/fragment (may carry tokens or PII); keep origin + path only. */
function scrubUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!value.includes("://")) return value.slice(0, 40); // "inline", "eval", "data", ...
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`.slice(0, 200);
  } catch {
    return undefined;
  }
}

function pick(report: Violation) {
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : undefined);
  return {
    directive: str(report["effective-directive"] ?? report["effectiveDirective"] ?? report["violated-directive"]),
    blocked: scrubUrl(report["blocked-uri"] ?? report["blockedURL"]),
    document: scrubUrl(report["document-uri"] ?? report["documentURL"]),
    disposition: str(report["disposition"]),
  };
}

function violations(payload: unknown): Violation[] {
  // Legacy report-uri: { "csp-report": {...} }; Reporting API: [{ type, body: {...} }].
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => (entry && typeof entry === "object" ? (entry as { body?: unknown }).body : null))
      .filter((b): b is Violation => !!b && typeof b === "object")
      .slice(0, 5);
  }
  if (payload && typeof payload === "object") {
    const inner = (payload as Record<string, unknown>)["csp-report"];
    if (inner && typeof inner === "object") return [inner as Violation];
  }
  return [];
}

/**
 * CSP violation sink (report-only mode). Cheap and defensive: size-capped,
 * stores nothing, logs one structured line of scrubbed fields (no query
 * strings, no IPs, no user agents, no script samples), never throws, always 204.
 */
export async function POST(request: Request) {
  try {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) return new Response(null, { status: 413, headers: NO_STORE });

    // Bounded read: do not trust content-length (may be absent/chunked).
    const reader = request.body?.getReader();
    let received = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_BYTES) {
          await reader.cancel().catch(() => undefined);
          return new Response(null, { status: 413, headers: NO_STORE });
        }
        chunks.push(value);
      }
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    const reports = violations(JSON.parse(text));
    for (const report of reports) console.warn("[csp-report]", JSON.stringify(pick(report)));
  } catch {
    // Malformed body: ignore. A report endpoint must never error loudly.
  }
  return new Response(null, { status: 204, headers: NO_STORE });
}
