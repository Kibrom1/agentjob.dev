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

  const authorization = request.headers.get("authorization");
  if (!(await isAuthorizedAdmin(authorization, config))) {
    // Only requests that PRESENT wrong credentials consume the bucket. A request
    // with no Authorization header at all is just the browser's first visit
    // (before its credential prompt), not a guess, so it gets the 401 challenge
    // for free. Cached valid credentials are never throttled either.
    const allowed = authorization === null ? true : await consumeRateLimit(RATE_LIMITS.adminAuth, request.headers);
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
