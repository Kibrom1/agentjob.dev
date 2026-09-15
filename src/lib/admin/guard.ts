import "server-only";
import { headers } from "next/headers";
import { isAuthorizedAdmin, readAdminConfig } from "@/lib/admin/auth";

export class AdminAuthError extends Error {
  override readonly name = "AdminAuthError";
}

/**
 * Re-checks Basic credentials inside every admin server action and page, so
 * access never depends on proxy.ts alone.
 */
export async function assertAdmin(): Promise<void> {
  const authorization = (await headers()).get("authorization");
  if (!(await isAuthorizedAdmin(authorization, readAdminConfig()))) {
    throw new AdminAuthError("Admin authentication required");
  }
}
