import { EnvConfigError } from "@/lib/env";
import { checkDatabaseHealth } from "@/lib/jobs";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Liveness + database reachability probe for uptime monitors. */
export async function GET() {
  try {
    const db = await checkDatabaseHealth();
    return Response.json(
      { status: db.ok ? "ok" : "degraded", database: db.ok ? "ok" : "error", latencyMs: db.latencyMs },
      { status: db.ok ? 200 : 503, headers: NO_STORE },
    );
  } catch (error) {
    const reason = error instanceof EnvConfigError ? "misconfigured" : "unreachable";
    console.error("[health] database check threw", error);
    return Response.json({ status: "degraded", database: reason }, { status: 503, headers: NO_STORE });
  }
}
