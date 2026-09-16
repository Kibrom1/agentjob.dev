import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getCronEnv } from "@/lib/env";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Throws EnvConfigError if CRON_SECRET is unset/weak. */
export function isAuthorizedCron(request: Request): boolean {
  const { CRON_SECRET } = getCronEnv();
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${CRON_SECRET}`);
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Gates a cron/ops route: runs the auth check in isolation, before any
 * business logic or other env-dependent validation, and returns a generic
 * 401 for every unauthenticated/misconfigured case. `getCronEnv()` (called
 * inside `isAuthorizedCron`) throws `EnvConfigError` with the missing/invalid
 * var name and a hint when `CRON_SECRET` is unset — that detail must never
 * reach an unauthenticated caller, so it is caught and logged here rather
 * than allowed to propagate into a route's own try/catch (which would
 * otherwise surface it as a 503 response body before auth has "passed").
 * Returns `null` when the caller is authorized and the route should proceed.
 */
export function requireCronAuth(request: Request): Response | null {
  let authorized: boolean;
  try {
    authorized = isAuthorizedCron(request);
  } catch (error) {
    console.error("[cron-auth] CRON_SECRET misconfigured", error);
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  if (!authorized) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  return null;
}
