import { api, json, requireUser } from "@/server/http";
import { earnStatus, openEarningPocket } from "@/server/services/earn";

/** Turns the Earning pocket on (or returns the one the person has). */
export const POST = api(async ({ ctx }) => {
  const user = await requireUser(ctx);
  await openEarningPocket(ctx, user);
  return json({ status: await earnStatus(ctx, user.id) }, 201);
});
