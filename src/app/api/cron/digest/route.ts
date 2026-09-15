import { isAuthorizedCron } from "@/lib/cron-auth";
import { createDigestDeps } from "@/lib/digest/deps";
import { runWeeklyDigest } from "@/lib/digest/run";
import { EnvConfigError, getEmailEnv } from "@/lib/env";
import { siteConfig } from "@/lib/site";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;
const SEND_WEEKDAY_MONDAY = 1;

/**
 * Daily Vercel Cron. Starts the weekly digest on Monday (or the first run
 * after it) and resumes an unfinished run on later days. `?force=1` starts
 * the current week's digest immediately.
 */
export async function GET(request: Request) {
  try {
    if (!isAuthorizedCron(request)) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }

    const email = getEmailEnv();
    const force = new URL(request.url).searchParams.get("force") === "1";
    const result = await runWeeklyDigest(createDigestDeps(), {
      siteUrl: siteConfig.url.toString(),
      postalAddress: email.POSTAL_ADDRESS,
      sendWeekday: SEND_WEEKDAY_MONDAY,
      timeBudgetMs: (maxDuration - 15) * 1000,
      force,
    });

    console.info("[cron:digest]", result);
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    const status = error instanceof EnvConfigError ? 503 : 500;
    console.error("[cron:digest] failed", error);
    return Response.json(
      { error: error instanceof EnvConfigError ? error.message : "Digest run failed" },
      { status, headers: NO_STORE },
    );
  }
}
