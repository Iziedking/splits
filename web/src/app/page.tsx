import { redirect } from "next/navigation";
import { Landing } from "@/components/landing/landing";
import { userForSession } from "@/server/auth/sessions";
import { getCtx } from "@/server/context";
import { sessionToken } from "@/server/http";

/**
 * The public landing page. Someone already signed in goes straight to Home, as / did before the
 * landing page existed; sign-in itself lives at /signin. The session is checked on the server so
 * the page never draws and then jumps.
 */
export default async function Page() {
  const ctx = await getCtx();
  const user = await userForSession(ctx.db, await sessionToken(), ctx.now()).catch(() => null);
  if (user) redirect("/home");
  return <Landing />;
}
