import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/server/db/schema";
import { api, json, readJson, requireUser } from "@/server/http";

const settings = z.object({ emailAlerts: z.boolean() });

/** "Email me about my money" in Profile. */
export const POST = api(async ({ req, ctx }) => {
  const user = await requireUser(ctx);
  const { emailAlerts } = await readJson(req, settings);
  await ctx.db.update(users).set({ emailAlerts }).where(eq(users.id, user.id));
  return json({ emailAlerts });
});
