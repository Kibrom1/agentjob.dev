import { requireCronAuth } from "@/lib/cron-auth";
import { EnvConfigError } from "@/lib/env";
import { getAdminDbClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Daily backstop for the pg_cron maintenance job. */
export async function GET(request: Request) {
  // Auth runs first and in isolation — see requireCronAuth.
  const unauthorized = requireCronAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const { data, error } = await getAdminDbClient().rpc("run_maintenance");
    if (error) {
      console.error("[cron:maintenance] rpc failed", error);
      return Response.json({ error: "Maintenance failed" }, { status: 500, headers: NO_STORE });
    }

    console.info("[cron:maintenance]", data);
    return Response.json({ ok: true, result: data }, { headers: NO_STORE });
  } catch (error) {
    const status = error instanceof EnvConfigError ? 503 : 500;
    console.error("[cron:maintenance] failed", error);
    return Response.json(
      { error: error instanceof EnvConfigError ? error.message : "Maintenance failed" },
      { status, headers: NO_STORE },
    );
  }
}
