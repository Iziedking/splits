import { NextResponse, type NextRequest } from "next/server";
import { nearHosts } from "@/lib/near/config";

/**
 * near.mysplits.xyz opens straight into NEAR mode: "/" shows /near, "/send" shows /near/send, and
 * so on. The same server also serves mysplits.xyz, so once NEAR hosts are set, NEAR pages and APIs
 * answer only on those hosts: mysplits.xyz/near is a 404 and the Arc app is unchanged.
 * The /near pages themselves still 404 unless NEAR_ENABLED=1.
 */
/**
 * Next runs the proxy again on its own rewrite, and by then the host reads as the server's own
 * (localhost). The first pass marks its rewrite with this value so the second pass lets it through.
 * It is random per server process, so a client cannot send it to open /near on mysplits.xyz.
 */
export const REWRITE_HEADER = "x-splits-near-rewrite";
const REWRITE_MARK = globalThis.crypto.randomUUID();

export function proxy(req: NextRequest) {
  const hosts = nearHosts();
  if (hosts.length === 0) return NextResponse.next();
  const host = (req.headers.get("host") ?? "").split(":")[0]!.toLowerCase();
  const { pathname } = req.nextUrl;
  const nearPath = pathname === "/near" || pathname.startsWith("/near/");
  const nearApi = pathname.startsWith("/api/near/");

  if (!hosts.includes(host)) {
    if (req.headers.get(REWRITE_HEADER) === REWRITE_MARK) return NextResponse.next();
    if (nearPath || nearApi) return new NextResponse("Not found", { status: 404 });
    return NextResponse.next();
  }
  if (nearPath || pathname.startsWith("/api/")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = pathname === "/" ? "/near" : `/near${pathname}`;
  const headers = new Headers(req.headers);
  headers.set(REWRITE_HEADER, REWRITE_MARK);
  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  // Pages, plus the NEAR APIs (to keep them off other hosts). Never other APIs, Next's own files or
  // static assets. Account names contain dots (/pay/ada.testnet), so only real file extensions are skipped.
  matcher: [
    "/api/near/:path*",
    "/((?!api/|_next/|brand/|chains/|Splits%20Logo%20Suite/|favicon|icon\\.svg|apple-icon|opengraph-image|twitter-image|robots\\.txt|sitemap|.*\\.(?:png|jpe?g|svg|webp|ico|txt|xml|webmanifest|js|css|map|woff2?)$).*)",
  ],
};
