import { InfoShell } from "@/components/app/info-shell";
import { LegalPage } from "@/components/app/legal-page";
import { userForSession } from "@/server/auth/sessions";
import { getCtx } from "@/server/context";
import { sessionToken } from "@/server/http";

export const metadata = { title: "Privacy notice", description: "What Splits keeps about you, and why." };

export default async function PrivacyPage() {
  const ctx = await getCtx();
  const user = await userForSession(ctx.db, await sessionToken(), ctx.now()).catch(() => null);
  return (
    <InfoShell signedIn={Boolean(user)}>
      <LegalPage title="Privacy notice" pending="The privacy notice for Splits is being written and will be published on this page." />
    </InfoShell>
  );
}
