import Link from "next/link";
import { InfoShell } from "@/components/app/info-shell";
import { MoneyNotice } from "@/components/app/money-notice";
import { ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/support";
import { userForSession } from "@/server/auth/sessions";
import { getCtx } from "@/server/context";
import { sessionToken } from "@/server/http";

export const metadata = { title: "Help", description: "Get help with a payment, and where the terms and privacy notice live." };

const ANSWERS = [
  {
    q: "A payment says Not sent",
    a: "Nobody was paid and nothing left your balance for it. You can check the list and pay again.",
  },
  {
    q: "Someone says they didn't get their part",
    a: "Open the payment and share their receipt. It shows their part, what it was for and when it was paid. Money sent to an email waits in their Splits balance until they sign in with that email.",
  },
  {
    q: "A payment is taking longer than usual",
    a: "Most payments land within a few seconds. The payment page updates by itself, and Splits keeps trying. Paying again before it finishes could pay everyone twice.",
  },
];

/**
 * Help (fintech face WP7): one way to reach a person, with the payment's reference filled in when
 * a payment page sent you here (?ref=). The support address is a setting; until it exists the page
 * says so instead of offering a route that goes nowhere.
 */
export default async function HelpPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const ctx = await getCtx();
  const user = await userForSession(ctx.db, await sessionToken(), ctx.now()).catch(() => null);
  const raw = (await searchParams).ref ?? "";
  const ref = /^[A-Z0-9]{6,32}$/i.test(raw) ? raw.toUpperCase() : null;

  return (
    <InfoShell signedIn={Boolean(user)}>
      <div className="enter space-y-6">
        <div>
          <h1 className="text-title leading-tight font-extrabold">Help</h1>
          <p className="mt-2 text-muted-foreground">Something wrong with a payment, or a question about your money.</p>
        </div>

        <section aria-labelledby="contact-heading" className="surface space-y-4 p-6">
          <h2 id="contact-heading" className="text-lg font-extrabold">
            Talk to us
          </h2>
          {ref && (
            <p className="text-sm">
              Payment reference <b className="font-mono tracking-wide">{ref}</b>. Include it so we can find the payment.
            </p>
          )}
          {SUPPORT_EMAIL ? (
            <>
              <ButtonLink href={supportMailto(SUPPORT_EMAIL, ref)} className="w-full">
                Email {SUPPORT_EMAIL}
              </ButtonLink>
              <p className="text-sm text-muted-foreground">Write from the email you use with Splits, so we know it is you.</p>
            </>
          ) : (
            <Notice>
              Our support address is being set up and will appear here. Until then, keep the reference{ref ? " above" : " from your payment page"}.
            </Notice>
          )}
        </section>

        <section aria-labelledby="answers-heading" className="surface p-6">
          <h2 id="answers-heading" className="text-lg font-extrabold">
            Quick answers
          </h2>
          <dl className="mt-3 divide-y divide-border">
            {ANSWERS.map((x) => (
              <div key={x.q} className="py-3">
                <dt className="font-semibold">{x.q}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{x.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <nav aria-label="Legal" className="flex flex-wrap gap-x-5 text-sm font-semibold text-primary-text">
          <Link href="/legal/terms" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
            Terms of use
          </Link>
          <Link href="/legal/privacy" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
            Privacy notice
          </Link>
          <Link href="/about" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
            About Splits
          </Link>
        </nav>
        <MoneyNotice />
      </div>
    </InfoShell>
  );
}
