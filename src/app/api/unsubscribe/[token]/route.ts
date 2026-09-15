import { unsubscribeByToken } from "@/lib/unsubscribe";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

/** RFC 8058 one-click unsubscribe (List-Unsubscribe-Post). */
export async function POST(_request: Request, { params }: Context) {
  const { token } = await params;
  const result = await unsubscribeByToken(token);
  const status = result === "error" ? 500 : 200;
  return Response.json({ result }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Humans who open the header URL directly get the confirmation page. */
export async function GET(request: Request, { params }: Context) {
  const { token } = await params;
  return Response.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}`, request.url), 303);
}
