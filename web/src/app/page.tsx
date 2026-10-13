import { Landing } from "@/components/landing/landing";
import { userForSession } from "@/server/auth/sessions";
import { getCtx } from "@/server/context";
import { sessionToken } from "@/server/http";

/**
 * The public landing page, for everyone: the Splits logo anywhere in the app leads here. Someone
 * signed in sees Home where others see Sign in. Sign-in itself lives at /signin. The session is
 * checked on the server so the page never draws and then jumps.
 */
export default async function Page() {
  const ctx = await getCtx();
  const user = await userForSession(ctx.db, await sessionToken(), ctx.now()).catch(() => null);
  return <Landing signedIn={Boolean(user)} />;
}
