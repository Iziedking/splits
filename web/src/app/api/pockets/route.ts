import { z } from "zod";
import { api, json, readJson, requireUser } from "@/server/http";
import { createPocket } from "@/server/services/users";
import { walletView } from "@/server/views";

export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const { label } = await readJson(req, z.object({ label: z.string() }));
  return json({ wallet: walletView(ctx, await createPocket(ctx, user, label)) }, 201);
});
