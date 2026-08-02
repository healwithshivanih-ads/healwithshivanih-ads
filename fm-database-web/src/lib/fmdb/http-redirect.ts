/**
 * Relative redirects for route handlers behind a proxy.
 *
 * THE BUG THIS EXISTS FOR: `NextResponse.redirect(new URL(path, req.url))`
 * looks correct and is wrong on Fly. The app binds localhost and fly-proxy
 * fronts it, so `req.url` is the INTERNAL address — the handler emitted
 * `location: https://localhost:3002/m` and the browser, quite reasonably,
 * tried to reach the coach's own machine. Sign-in was unusable from the phone.
 *
 * The gate in proxy.ts never hit this because Next normalises that layer's
 * same-app redirects down to a path; route handlers do not get that.
 *
 * A relative Location is explicitly allowed (RFC 7231 §7.1.2) and the browser
 * resolves it against the URL it actually requested — so it is correct behind
 * any proxy, on any host, with no host-detection and nothing to configure.
 *
 * Paths must be root-relative and must not start with `//`, which a browser
 * would read as protocol-relative and send off-site.
 */
import { NextResponse } from "next/server";

export function relativeRedirect(path: string, status = 303): NextResponse {
  const safe = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return new NextResponse(null, { status, headers: { Location: safe } });
}
