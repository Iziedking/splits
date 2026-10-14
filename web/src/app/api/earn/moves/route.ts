import { z } from "zod";
import { api, json, readJson, requireUser } from "@/server/http";
import { startMove } from "@/server/services/earn";
import { actionView, earnMoveView } from "@/server/views";

/** A move into or out of the Earning pocket, waiting for the PIN or passkey. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const body = await readJson(req, z.object({ kind: z.enum(["in", "out"]), amount: z.string() }));
  const { move, action } = await startMove(ctx, user, body.kind, body.amount);
  return json({ move: earnMoveView(ctx, move), action: actionView(action) }, 201);
});
