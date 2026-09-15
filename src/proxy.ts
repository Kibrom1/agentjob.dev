import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_REALM, isAuthorizedAdmin, readAdminConfig } from "@/lib/admin/auth";

export async function proxy(request: NextRequest) {
  const config = readAdminConfig();

  if (!config.enabled) {
    return new NextResponse(config.reason, {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (!(await isAuthorizedAdmin(request.headers.get("authorization"), config))) {
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
