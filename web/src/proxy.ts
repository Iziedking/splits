import { NextResponse, type NextRequest } from "next/server";
import { nearHosts } from "@/lib/near/config";

/**
 * near.mysplits.xyz opens straight into NEAR mode: "/" shows /near, "/send" shows /near/send, and
 * so on. Every other host (mysplits.xyz) passes through untouched, so the Arc app is unchanged.
 * The /near pages themselves still 404 unless NEAR_ENABLED=1.
 */
export function proxy(req: NextRequest) {
  const hosts = nearHosts();
  if (hosts.length === 0) return NextResponse.next();
  const host = (req.headers.get("host") ?? "").split(":")[0]!.toLowerCase();
  if (!hosts.includes(host)) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname === "/near" || pathname.startsWith("/near/")) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = pathname === "/" ? "/near" : `/near${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Pages only: never APIs, Next's own files or static assets. Account names contain dots
  // (/pay/ada.testnet), so only real file extensions are skipped.
  matcher: [
    "/((?!api/|_next/|brand/|chains/|Splits%20Logo%20Suite/|favicon|icon\\.svg|apple-icon|opengraph-image|twitter-image|robots\\.txt|sitemap|.*\\.(?:png|jpe?g|svg|webp|ico|txt|xml|webmanifest|js|css|map|woff2?)$).*)",
  ],
};
