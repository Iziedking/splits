import { nearEnabled } from "@/lib/near/config";
import { allowCheckout, CheckoutError, checkoutStatus } from "@/server/near/oneclick";

/** Where a checkout payment is: waiting, converting, delivered and divided, or refunded. */
export async function GET(req: Request) {
  if (!nearEnabled()) return new Response("Not found", { status: 404 });
  const visitor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowCheckout(visitor, "status")) return Response.json({ error: "Too many checks. Try again in a while." }, { status: 429 });
  const url = new URL(req.url);
  try {
    return Response.json(await checkoutStatus(url.searchParams.get("depositAddress") ?? "", url.searchParams.get("depositMemo") ?? undefined));
  } catch (e) {
    if (e instanceof CheckoutError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "NEAR Intents is not answering. Still checking." }, { status: 502 });
  }
}
