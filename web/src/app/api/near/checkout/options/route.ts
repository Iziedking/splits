import { checkoutEnabled } from "@/lib/near/checkout";
import { nearEnabled } from "@/lib/near/config";
import { CheckoutError, getPayOptions } from "@/server/near/oneclick";

/** The coins a payer can pay a split with, from NEAR Intents' live list. */
export async function GET() {
  if (!nearEnabled() || !checkoutEnabled()) return new Response("Not found", { status: 404 });
  try {
    return Response.json({ options: await getPayOptions() });
  } catch (e) {
    const status = e instanceof CheckoutError ? e.status : 502;
    return Response.json({ error: e instanceof CheckoutError ? e.message : "NEAR Intents is not answering. Try again in a minute." }, { status });
  }
}
