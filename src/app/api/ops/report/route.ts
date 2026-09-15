import { getAdminStats } from "@/lib/admin/jobs";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { EnvConfigError } from "@/lib/env";
import { computeOpsFlags, renderOpsSummary } from "@/lib/ops/report";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Machine-readable operations report: current stats, ingestion/digest
 * health, and a flat list of flags worth a human's attention. Reuses the
 * existing CRON_SECRET (Bearer auth) rather than introducing a new secret —
 * this is meant to be pulled by the same kind of caller as the other
 * /api/cron/* routes (a scheduled job), just read-only.
 */
export async function GET(request: Request) {
  try {
    if (!isAuthorizedCron(request)) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }

    const stats = await getAdminStats();
    const now = new Date();
    const flags = computeOpsFlags(stats, now);

    return Response.json(
      {
        generatedAt: now.toISOString(),
        stats,
        flags,
        summary: renderOpsSummary(stats, flags, now),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    const status = error instanceof EnvConfigError ? 503 : 500;
    console.error("[ops-report] failed", error);
    return Response.json(
      { error: error instanceof EnvConfigError ? error.message : "Failed to build ops report" },
      { status, headers: NO_STORE },
    );
  }
}
