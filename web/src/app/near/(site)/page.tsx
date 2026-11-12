import { FileSpreadsheet, Link2, ShoppingBag, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { PurposeDot } from "@/components/app/purpose-dot";
import { ButtonLink } from "@/components/ui/button";
import { LandingPanel } from "@/components/near/split-card";
import { NEAR } from "@/lib/near/config";
import { purposeFill } from "@/lib/palette";

const link = "font-medium text-primary-text underline underline-offset-4";

export default function NearLanding() {
  return (
    <div className="space-y-24 sm:space-y-32">
      <section className="grid items-center gap-10 lg:min-h-[calc(100dvh-12rem)] lg:grid-cols-[1fr_1.05fr] lg:gap-14">
        <div className="enter max-w-xl">
          <h1 className="display-face text-display leading-[1.08] font-bold sm:text-6xl">Get paid once. It lands divided.</h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Auto-split your income into tax, savings and spending. Set your rule once, and every payment you receive divides itself the moment it arrives, with a purpose and a receipt
            for every part.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/near/app">Open the app</ButtonLink>
            <ButtonLink href="/near/shop" variant="secondary">
              Try the demo shop
            </ButtonLink>
          </div>
        </div>
        <LandingPanel />
      </section>

      <section aria-labelledby="receipt-title" className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <ReceiptPreview />
        <div className="max-w-lg">
          <h2 id="receipt-title" className="display-face text-3xl leading-tight font-bold">
            A purpose and a receipt on every part
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Each person gets their own receipt: their amount, what it was for and who paid. It shows their part only, never the total or anyone else in the payment.
          </p>
          <p className="mt-4 text-muted-foreground">
            Your rule runs on NEAR itself, not on our servers, so payments still divide even if this website is down.
          </p>
        </div>
      </section>

      <section aria-labelledby="more-title">
        <h2 id="more-title" className="display-face text-3xl font-bold">
          Built for money that has to be shared
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">Other apps move money when you tell them to. Splits keeps a rule that divides money as it arrives, and gives every part a purpose and a receipt.</p>
        <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Feature icon={ShoppingBag} title="A checkout button that divides the sale">
            Paste a &ldquo;Pay with Splits&rdquo; button into any shop. Each sale lands split between the supplier, the tax pot and the tip jar.{" "}
            <Link className="font-medium text-primary-text underline underline-offset-4" href="/near/shop">
              Try it
            </Link>
          </Feature>
          <Feature icon={Users} title="A group fund set by a vote">
            Flatmates or a trip vote once on how shared money divides. When the vote passes, every payment to the group follows the new rule.
          </Feature>
          <Feature icon={FileSpreadsheet} title="Payroll from a CSV">
            Upload a list of people, amounts and what each payment is for. Check it, approve once, and get a CSV of what landed that an accountant can open.
          </Feature>
          <Feature icon={Link2} title="A pay link for anyone">
            Share one link. Whoever pays you, the money arrives already divided by your rule. Say the rule in plain words; NEAR AI reads it.
          </Feature>
        </ul>
      </section>

      <section id="start" aria-labelledby="try-title" className="scroll-mt-24">
        <h2 id="try-title" className="display-face text-3xl font-bold">
          {NEAR.network === "testnet" ? "Try it in test mode" : "Get started"}
        </h2>
        <p className="mt-3 text-muted-foreground">Three steps, about five minutes. Test money has no value, so nothing real is at stake.</p>
        <ol className="surface mt-8 grid rounded-2xl md:grid-cols-3">
          <Step n={1} title="Get a wallet and test money">
            Connect a NEAR wallet in test mode. Free test NEAR for fees comes from{" "}
            <a className={link} href={NEAR.nearFaucet} target="_blank" rel="noreferrer">
              near-faucet.io
            </a>
            , test {NEAR.tokenSymbol} from{" "}
            <a className={link} href={NEAR.faucet} target="_blank" rel="noreferrer">
              faucet.circle.com
            </a>{" "}
            (choose NEAR Testnet).
          </Step>
          <Step n={2} title="Save your split">
            In{" "}
            <Link className={link} href="/near/split">
              Auto-split my income
            </Link>
            , say how your income divides, check it and save it. It works on its own from then on.
          </Step>
          <Step n={3} title="Get paid, or pay a split">
            Share your pay link, or{" "}
            <Link className={link} href="/near/send">
              pay a split
            </Link>{" "}
            yourself with the sample. Approve once and watch each part arrive.
          </Step>
        </ol>
      </section>

      <section className="flex flex-col items-start gap-6 rounded-[1.75rem] bg-primary-fill px-6 py-10 text-white sm:flex-row sm:items-center sm:justify-between sm:px-12">
        <div>
          <h2 className="display-face text-2xl font-bold sm:text-3xl">Save your split in two minutes</h2>
          <p className="mt-2 text-white/80">Connect a wallet, say your rule, approve once.</p>
        </div>
        <Link
          href="/near/app"
          className="inline-flex min-h-12 items-center rounded-full bg-white px-6 font-semibold text-primary-fill transition-colors hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-primary-fill focus-visible:outline-none"
        >
          Open the app
        </Link>
      </section>
    </div>
  );
}

/** A receipt the way a recipient sees it. Example names; decorative, the text beside it says the same. */
function ReceiptPreview() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-md">
      <div className="absolute inset-x-8 -bottom-4 h-full rounded-2xl bg-white/50 ring-1 ring-white" />
      <div className="relative overflow-hidden rounded-2xl bg-white/95 shadow-panel ring-1 ring-white">
        <span className="block h-1.5" style={{ backgroundColor: purposeFill(1) }} />
        <div className="p-7">
          <p className="text-sm text-primary-text">Receipt</p>
          <p className="display-face mt-1 text-2xl font-bold">You were paid</p>
          <p className="figure mt-3 text-5xl tabular-nums">
            200.00 <span className="text-xl font-semibold text-muted-foreground">USDC</span>
          </p>
          <dl className="mt-6 space-y-3 text-sm">
            {[
              ["For", <span key="f" className="flex items-center gap-2"><PurposeDot index={1} />Savings</span>],
              ["To", <span key="t" className="font-mono text-micro">savings.ada.testnet</span>],
              ["From", <span key="p" className="font-mono text-micro">payroll.acme.testnet</span>],
              ["Divided by", <span key="d"><span className="font-mono text-micro">ada.testnet</span>&apos;s saved split</span>],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between gap-4 border-b border-foreground/8 pb-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-xs text-muted-foreground">This receipt shows only your part.</p>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return (
    <li className="surface rounded-2xl p-6 sm:p-7">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-fill/10 text-primary-text">
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h3 className="mt-5 font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p>
    </li>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="border-foreground/8 p-6 not-first:border-t sm:p-7 md:not-first:border-t-0 md:not-first:border-l">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-fill text-sm font-semibold text-white tabular-nums">{n}</span>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p>
    </li>
  );
}
