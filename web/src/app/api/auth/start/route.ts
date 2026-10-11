import { z } from "zod";
import { api, json, readJson } from "@/server/http";
import { startSignIn } from "@/server/services/signin";

export const POST = api(async ({ req, ctx }) => {
  const { email } = await readJson(req, z.object({ email: z.string() }));
  return json(await startSignIn(ctx, email));
});
