import { api, json, requireUser } from "@/server/http";
import { earnStatus, listMoves } from "@/server/services/earn";
import { earnMoveView } from "@/server/views";

/** The Earning pocket: whether it's on, the vault and its rate, what the pocket holds, recent moves. */
export const GET = api(async ({ ctx }) => {
  const user = await requireUser(ctx);
  const status = await earnStatus(ctx, user.id);
  const moves = status.available ? (await listMoves(ctx, user.id)).map((m) => earnMoveView(ctx, m)) : [];
  return json({ status, moves });
});
