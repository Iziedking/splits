import { FileSpreadsheet, Link2, MessageSquareText, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { PurposeDot } from "@/components/app/purpose-dot";
import { ButtonLink } from "@/components/ui/button";
import { LandingPanel } from "@/components/near/split-card";
import { NEAR, accountUrl } from "@/lib/near/config";
import { purposeFill } from "@/lib/palette";

const link = "font-medium text-primary-text underline underline-offset-4";

export default function NearLanding() {
  return (
    <div className="space-y-24 sm:space-y-32">
      <section className="grid items-center gap-10 lg:min-h-[calc(100dvh-12rem)] lg:grid-cols-[1fr_1.05fr] lg:gap-14">
        <div className="enter max-w-xl">
          <h1 className="display-face text-[2.5rem] leading-[1.08] font-bold sm:text-6xl">Get paid once. It lands divided.</h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Auto-split your income into tax, savings and spending. Save the rule once, and every {NEAR.tokenSymbol} payment sent to your NEAR account divides itself on chain the moment it
            arrives, with a purpose and a receipt on every part.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/near/app">Open the app</ButtonLink>
            <ButtonLink href="/near#how" variant="secondary">
              See how it works
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
            Each person gets their own receipt: their amount, what it was for, who paid and the transaction on NEAR. It shows their part only, never the total or anyone else in the payment.
          </p>
          <p className="mt-4 text-muted-foreground">
            The rule lives in the splits router contract on NEAR, not on a Splits server, so a payment divides even if this website is down.
          </p>
        </div>
      </section>

      <section aria-labelledby="more-title">
        <h2 id="more-title" className="display-face text-3xl font-bold">
          Built for money that has to be shared
        </h2>
        <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Feature icon={FileSpreadsheet} title="Payroll from a CSV">
            Upload a list of people, amounts and what each payment is for. Check it, approve once, and get a CSV of what landed that an accountant can open.
          </Feature>
          <Feature icon={Users} title="A group fund set by a vote">
            A flat or a trip decides once, in its Sputnik DAO, how shared money divides. When the vote passes, every payment to the group follows the new rule.
          </Feature>
          <Feature icon={MessageSquareText} title="Say it in plain words">
            &ldquo;Thirty percent to tax, a fifth to savings, the rest is mine.&rdquo; NEAR AI reads it, and Splits only keeps accounts and numbers you actually wrote.
          </Feature>
          <Feature icon={Link2} title="A pay link for anyone">
            Share one link. Whoever pays you, from any NEAR wallet, the money arrives already divided by your saved split.
          </Feature>
        </ul>
      </section>

      <section id="how" aria-labelledby="try-title" className="scroll-mt-24">
        <h2 id="try-title" className="display-face text-3xl font-bold">
          Try it on {NEAR.network}
        </h2>
        <p className="mt-3 text-muted-foreground">Three steps, about five minutes. Testnet money has no value.</p>
        <ol className="surface mt-8 grid rounded-2xl md:grid-cols-3">
          <Step n={1} title="Get a wallet and test money">
            Connect any NEAR wallet on {NEAR.network}. Test NEAR for gas comes from{" "}
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
            , write how your income divides, check it and save it. It runs on NEAR from then on.
          </Step>
          <Step n={3} title="Get paid, or pay a split">
            Share your pay link, or{" "}
            <Link className={link} href="/near/send">
              pay a split
            </Link>{" "}
            yourself: a sample fills in three demo accounts. Approve once and watch each part land.
          </Step>
        </ol>
      </section>

      <section aria-labelledby="near-title" className="grid gap-8 lg:grid-cols-[1fr_2fr] lg:gap-14">
        <div>
          <h2 id="near-title" className="display-face text-3xl font-bold">
            What NEAR does here
          </h2>
          <p className="mt-3 text-muted-foreground">
            Three things you would have to build yourself elsewhere.{" "}
            <Link className={link} href="/near/how">
              How it works and its limits
            </Link>
          </p>
        </div>
        <dl className="divide-y divide-foreground/8 border-y border-foreground/8">
          <Fact term="tax.ada.testnet">People are paid by name. A named account is the address, so a split reads like the instruction you gave.</Fact>
          <Fact term="ft_transfer_call">The standard token call carries the split with the money, so one approval sends both, and the token refunds whatever the router doesn&apos;t use.</Fact>
          <Fact
            term={
              <a className="underline underline-offset-4" href={accountUrl(NEAR.router)} target="_blank" rel="noreferrer">
                {NEAR.router}
              </a>
            }
          >
            The splits router divides each payment by the receiver&apos;s saved split, on chain. It has no owner and no admin methods.
          </Fact>
        </dl>
      </section>

      <section id="proof" aria-labelledby="proof-title" className="scroll-mt-24 overflow-hidden rounded-[1.75rem] bg-[#0a1a22] px-6 py-10 text-white sm:px-12 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div>
            <h2 id="proof-title" className="display-face text-3xl font-bold">
              Check it yourself
            </h2>
            <p className="mt-4 leading-relaxed text-white/75">
              Two commands, no wallet and no keys. The second creates a fresh testnet account, deploys the live router&apos;s exact code, and proves each claim on this page with an explorer
              link for every step.
            </p>
          </div>
          <pre className="overflow-x-auto rounded-xl bg-white/6 p-5 font-mono text-[0.8125rem] leading-7 text-white/90 ring-1 ring-white/10">
            <code>
              <span className="text-white/45"># contract tests: unit and sandbox</span>
              {"\n"}bash near/proof/contract-tests.sh{"\n\n"}
              <span className="text-white/45"># a real payment run on NEAR testnet</span>
              {"\n"}cd near/proof && npm ci && node testnet-proof.mjs
            </code>
          </pre>
        </div>
      </section>

      <section className="flex flex-col items-start gap-6 rounded-[1.75rem] bg-primary-fill px-6 py-10 text-white sm:flex-row sm:items-center sm:justify-between sm:px-12">
        <div>
          <h2 className="display-face text-2xl font-bold sm:text-3xl">Save your split in two minutes</h2>
          <p className="mt-2 text-white/80">Connect a NEAR wallet on {NEAR.network}, write your rule, approve once.</p>
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
          <p className="text-sm text-primary-text">Receipt · NEAR {NEAR.network}</p>
          <p className="display-face mt-1 text-2xl font-bold">You were paid</p>
          <p className="figure mt-3 text-5xl tabular-nums">
            200.00 <span className="text-xl font-semibold text-muted-foreground">USDC</span>
          </p>
          <dl className="mt-6 space-y-3 text-sm">
            {[
              ["For", <span key="f" className="flex items-center gap-2"><PurposeDot index={1} />Savings</span>],
              ["To", <span key="t" className="font-mono text-[0.8125rem]">savings.ada.testnet</span>],
              ["From", <span key="p" className="font-mono text-[0.8125rem]">payroll.acme.testnet</span>],
              ["Divided by", <span key="d"><span className="font-mono text-[0.8125rem]">ada.testnet</span>&apos;s saved split</span>],
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

function Fact({ term, children }: { term: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-5 sm:grid-cols-[13rem_1fr] sm:gap-6">
      <dt className="truncate font-mono text-[0.8125rem] text-primary-text">{term}</dt>
      <dd className="text-sm leading-relaxed text-muted-foreground">{children}</dd>
    </div>
  );
}
