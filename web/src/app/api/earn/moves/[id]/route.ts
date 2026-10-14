import { notFound } from "@/server/errors";
import { api, json, requireUser } from "@/server/http";
import { advanceMove, getMove } from "@/server/services/earn";
import { earnMoveView } from "@/server/views";

/** Polling a move also pushes it forward; every step is safe to repeat. */
export const GET = api(async ({ ctx, params }) => {
  const user = await requireUser(ctx);
  const move = await getMove(ctx, params.id!);
  if (move.userId !== user.id) throw notFound("Move not found");
  return json({ move: earnMoveView(ctx, await advanceMove(ctx, move.id)) });
});
