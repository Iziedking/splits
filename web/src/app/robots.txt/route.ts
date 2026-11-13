/** Crawlers may read every page; pages that should not be listed say so themselves (noindex). */
export function GET() {
  return new Response("User-agent: *\nAllow: /\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
