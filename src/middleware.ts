import { NextRequest, NextResponse } from "next/server";

const PUBLIC = ["/login", "/signup", "/api/auth", "/api/health"];

/** Internal-cron token for systemd timers (experiments-runner, etc.) to call admin
 *  endpoints without an interactive session. Set in /opt/ts-app/.env.local on prod;
 *  systemd services pass it via X-Internal-Token header. Without this bypass, the
 *  experiments runner has been silently failing every day with HTTP 307 since
 *  inception (verified 2026-04-30 — today's experiments report missing, yesterday's
 *  only existed because a human session triggered it). */
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN ?? "";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) return NextResponse.next();

  // Internal-cron header bypass — only valid when token is configured + matches.
  // Empty INTERNAL_API_TOKEN env disables the bypass entirely (fail-closed).
  if (INTERNAL_TOKEN.length >= 16) {
    const provided = req.headers.get("x-internal-token");
    if (provided && provided === INTERNAL_TOKEN) {
      return NextResponse.next();
    }
  }

  const session = req.cookies.get("ts_session")?.value;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};
