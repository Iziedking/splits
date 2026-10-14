import { after } from "next/server";
import { api, json, readJson, requireUser } from "@/server/http";
import { confirmBody, proofFrom } from "@/server/schemas";
import { advanceMove, confirmMove } from "@/server/services/earn";
import { earnMoveView } from "@/server/views";

/** Approves a move and answers straight away; the move runs after the response, then the sweeper. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const body = await readJson(req, confirmBody);
  const move = await confirmMove(ctx, user, body.actionId, proofFrom(body));
  after(() => advanceMove(ctx, move.id).catch((err) => console.error(`[earn] advancing ${move.id}`, err)));
  return json({ move: earnMoveView(ctx, move) });
});
