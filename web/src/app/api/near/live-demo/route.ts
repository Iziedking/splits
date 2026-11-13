import { json } from "@/server/http";
import { emailAccountApi } from "@/server/near/http";
import { runLiveDemo } from "@/server/near/live-demo";

/** "Watch a payment divide": sends a real $1.00 of test USDC on NEAR testnet, no sign-in. */
export const POST = emailAccountApi(async ({ req, ctx }) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return json(await runLiveDemo(ctx, ip));
});
