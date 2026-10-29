import { InfoShell } from "@/components/app/info-shell";
import { LegalPage } from "@/components/app/legal-page";
import { userForSession } from "@/server/auth/sessions";
import { getCtx } from "@/server/context";
import { sessionToken } from "@/server/http";

export const metadata = { title: "Terms of use", description: "The terms for using Splits." };

export default async function TermsPage() {
  const ctx = await getCtx();
  const user = await userForSession(ctx.db, await sessionToken(), ctx.now()).catch(() => null);
  return (
    <InfoShell signedIn={Boolean(user)}>
      <LegalPage title="Terms of use" pending="The terms of use for Splits are being written and will be published on this page." />
    </InfoShell>
  );
}
