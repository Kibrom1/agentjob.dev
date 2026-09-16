import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_REALM, isAuthorizedAdmin, readAdminConfig } from "@/lib/admin/auth";
import { consumeRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export async function proxy(request: NextRequest) {
  const config = readAdminConfig();

  if (!config.enabled) {
    return new NextResponse(config.reason, {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (!(await isAuthorizedAdmin(request.headers.get("authorization"), config))) {
    // Only failed attempts consume the bucket, so a browser that has already
    // cached valid credentials (sent on every subsequent request) is never
    // throttled by its own normal use of the admin console — only a string of
    // wrong-credential requests (brute force / credential stuffing) is.
    const allowed = await consumeRateLimit(RATE_LIMITS.adminAuth, request.headers);
    if (!allowed) {
      return new NextResponse("Too many failed attempts. Try again later.", {
        status: 429,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "Retry-After": String(RATE_LIMITS.adminAuth.windowSeconds),
        },
      });
    }
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": `Basic realm="${ADMIN_REALM}", charset="UTF-8"`,
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
