import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { NEAR, accountUrl } from "@/lib/near/config";

export default function NearHome() {
  return (
    <div className="space-y-8">
      <section className="enter max-w-2xl pt-6">
        <h1 className="display-face text-4xl leading-tight font-bold sm:text-5xl">Get paid once. It lands divided.</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          One {NEAR.tokenSymbol} payment on NEAR, divided between named accounts, with a purpose on every part. Save your own split once, and every payment sent to you divides itself on
          chain the moment it arrives: tax, savings and spending, with no backend in between.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/near/split">Auto-split my income</ButtonLink>
          <ButtonLink href="/near/send" variant="secondary">
            Pay a split
          </ButtonLink>
        </div>
      </section>

      <section aria-labelledby="try-title" className="grid gap-4 md:grid-cols-3">
        <h2 id="try-title" className="sr-only">
          Try it on testnet
        </h2>
        <Step n={1} title="Get a wallet and test money">
          Connect any NEAR wallet on {NEAR.network}. Get test NEAR for gas at{" "}
          <a className="underline" href={NEAR.nearFaucet} target="_blank" rel="noreferrer">
            near-faucet.io
          </a>{" "}
          and test {NEAR.tokenSymbol} at{" "}
          <a className="underline" href={NEAR.faucet} target="_blank" rel="noreferrer">
            faucet.circle.com
          </a>{" "}
          (choose NEAR Testnet).
        </Step>
        <Step n={2} title="Pay a sample split">
          On <Link className="underline" href="/near/send">Pay a split</Link>, press &ldquo;Fill a sample split&rdquo;: 1.00 {NEAR.tokenSymbol} to three demo accounts for tax, savings and upkeep. Check
          it, approve once, and watch each part land.
        </Step>
        <Step n={3} title="Save your own split">
          On <Link className="underline" href="/near/split">Auto-split my income</Link>, write how your income should divide, check it, and save it. Share your pay link: whoever pays you, it
          arrives divided.
        </Step>
      </section>

      <section className="surface rounded-lg p-5 text-sm leading-relaxed text-muted-foreground sm:p-6">
        <h2 className="text-base font-semibold text-foreground">What NEAR does here</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Recipients are named accounts like tax.ada.testnet, not long addresses.</li>
          <li>The standard token call (ft_transfer_call) carries the split, so one approval sends the money and the instructions together.</li>
          <li>
            The{" "}
            <a className="underline" href={accountUrl(NEAR.router)} target="_blank" rel="noreferrer">
              splits router
            </a>{" "}
            divides a payment by the receiver&apos;s saved split on chain. It has no owner and no admin methods.
          </li>
        </ul>
      </section>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="surface rounded-lg p-5">
      <p className="text-sm font-semibold text-primary-text">Step {n}</p>
      <h3 className="mt-1 font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}
