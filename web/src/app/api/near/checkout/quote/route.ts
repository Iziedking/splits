import { z } from "zod";
import { nearEnabled } from "@/lib/near/config";
import { isAccountId, parseCents, CENT } from "@/lib/near/payment";
import { allowCheckout, CheckoutError, quoteCheckout } from "@/server/near/oneclick";

const body = z.object({
  to: z.string().refine(isAccountId),
  amount: z.string().max(20),
  assetId: z.string().min(3).max(200),
  refundTo: z.string().trim().min(10).max(128),
  dry: z.boolean(),
});

/** A price (dry) or a deposit address (not dry) for paying a saved split from another chain. */
export async function POST(req: Request) {
  if (!nearEnabled()) return new Response("Not found", { status: 404 });
  const visitor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allowCheckout(visitor, "quote")) return Response.json({ error: "Too many quotes. Try again in a while." }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send the account, an amount, a coin and your refund address" }, { status: 400 });
  const cents = parseCents(parsed.data.amount);
  if (cents === null) return Response.json({ error: "Type the amount in USDC, like 25 or 12.50" }, { status: 400 });
  try {
    return Response.json(await quoteCheckout({ ...parsed.data, units: cents * CENT }));
  } catch (e) {
    if (e instanceof CheckoutError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[checkout] quote", e);
    return Response.json({ error: "Could not reach NEAR or NEAR Intents. Try again in a minute." }, { status: 502 });
  }
}
