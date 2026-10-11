import { api, json, readJson, requireUser } from "@/server/http";
import { draftSplit, splitInput, splitsFor } from "@/server/services/splits";
import { actionView, splitView } from "@/server/views";

export const GET = api(async ({ ctx }) => {
  const user = await requireUser(ctx);
  return json({ splits: (await splitsFor(ctx, user.id)).map(splitView) });
});

/** Drafts a split. It goes onchain after the user confirms the returned action. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const input = await readJson(req, splitInput);
  const { split, action } = await draftSplit(ctx, user, input);
  return json({ split: splitView(split), action: actionView(action) }, 201);
});
