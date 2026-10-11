import { api, json, readJson, requireUser } from "@/server/http";
import { quoteTransfer, transferInput, transfersFor } from "@/server/services/transfers";
import { actionView, transferView } from "@/server/views";

export const GET = api(async ({ ctx }) => {
  const user = await requireUser(ctx);
  return json({ transfers: (await transfersFor(ctx, user.id)).map((t) => transferView(ctx, t)) });
});

/** Quotes a payment. Nothing moves until the returned action is confirmed. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const { transfer, action } = await quoteTransfer(ctx, user, await readJson(req, transferInput));
  return json({ transfer: transferView(ctx, transfer), action: actionView(action) }, 201);
});
