import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getCronEnv } from "@/lib/env";

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
export function isAuthorizedCron(request: Request): boolean {
  const { CRON_SECRET } = getCronEnv();
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${CRON_SECRET}`);
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
