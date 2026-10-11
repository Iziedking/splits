import { after } from "next/server";
import { api, json, readJson, requireUser } from "@/server/http";
import { confirmBody, proofFrom } from "@/server/schemas";
import { advanceWithRules } from "@/server/services/rules";
import { confirmTransfer } from "@/server/services/transfers";
import { transferView } from "@/server/views";

/**
 * Confirms a payment and answers straight away, so the app can show progress live. The payment
 * is pushed forward after the response; the tracker's polling and the sweeper carry it the rest.
 */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const body = await readJson(req, confirmBody);
  const confirmed = await confirmTransfer(ctx, user, body.actionId, proofFrom(body));
  after(() =>
    advanceWithRules(ctx, confirmed.id).catch((err) => console.error(`[confirm] advancing ${confirmed.id}`, err)),
  );
  return json({ transfer: transferView(ctx, confirmed) });
});
