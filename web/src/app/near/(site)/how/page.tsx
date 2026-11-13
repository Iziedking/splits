import type { Metadata } from "next";
import { NEAR, accountUrl } from "@/lib/near/config";

export const metadata: Metadata = { title: "How it works" };

/** How it works in plain words first; the technical record for developers and judges below it. */
export default function NearHowPage() {
  return (
    <div className="enter mx-auto max-w-2xl space-y-6">
      <article className="surface rounded-3xl p-6 leading-relaxed sm:p-10">
        <h1 className="display-face text-3xl leading-tight font-bold sm:text-4xl">How it works</h1>

        <Part title="You set a rule once">
          Say how money you receive should divide: 30% for tax, 20% to savings, the rest to spend. Each part goes to its own account, with a purpose. You can change the rule any time.
        </Part>
        <Part title="Every payment follows it">
          When someone pays you, the money divides the moment it arrives. Nobody has to remember, and it works even if this website is down, because the rule runs on NEAR itself.
        </Part>
        <Part title="Everyone gets a receipt">
          Each person sees their own part: how much, what it was for and who paid. Never anyone else&apos;s.
        </Part>
        <Part title="Good to know">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Up to 10 people per payment. The smallest payment is 0.01.</li>
            <li>If one part can&apos;t be delivered, that part comes back to the payer and the others still arrive. The result screen says which.</li>
            <li>If you change your rule while someone is paying you, their payment is returned to them so they can pay again with the new rule.</li>
            <li>Nothing moves without the payer approving it.</li>
            {NEAR.network === "testnet" && <li>This is test mode: payments use test money with no value.</li>}
          </ul>
        </Part>
        <Part title="Signing in with an email">
          Splits makes you a NEAR account when you first sign in, and pays every fee for it. Splits holds that account&apos;s key and signs only what you approve on screen, so an
          email account is held for you, like a bank account. If you would rather hold your own key, sign in with a NEAR wallet instead; then nothing moves without your
          wallet&apos;s approval.
        </Part>
        <Part title="Plain words to a rule">
          &ldquo;Auto-split my income&rdquo; and &ldquo;Describe it&rdquo; turn your words into a rule or a list for you to check. Only accounts, amounts and percentages you typed can appear, and
          nothing is approved except by you.
        </Part>
      </article>

      <article id="developers" aria-labelledby="dev-title" className="scroll-mt-24 overflow-hidden rounded-3xl bg-night p-6 text-white sm:p-10">
        <h2 id="dev-title" className="display-face text-2xl font-bold">
          For developers
        </h2>
        <dl className="mt-6 divide-y divide-white/10 border-y border-white/10 text-sm">
          <Fact term="The router">
            <a className="font-mono text-micro underline underline-offset-4" href={accountUrl(NEAR.router)} target="_blank" rel="noreferrer">
              {NEAR.router}
            </a>{" "}
            divides each payment by the receiver&apos;s saved split (versioned, in basis points), on chain. No owner, no admin, no upgrade method; the token it accepts is fixed.
          </Fact>
          <Fact term="The call">
            The payer&apos;s wallet calls <code className="font-mono text-micro">ft_transfer_call</code> on {NEAR.tokenSymbol} with the split in <code className="font-mono text-micro">msg</code>; one
            approval sends both, and the token refunds whatever the router doesn&apos;t use. References are single-use per payer.
          </Fact>
          <Fact term="Named accounts">People are paid by name, so a split reads like the instruction it came from.</Fact>
          <Fact term="Group funds">A Sputnik DAO saves the group&apos;s split by a passed FunctionCall proposal to the router.</Fact>
          <Fact term="Any chain">Checkout uses NEAR Intents (1Click) on mainnet, delivering USDC to the router with the split as the transfer message.</Fact>
        </dl>
        <p className="mt-6 text-sm text-white/75">Check every claim yourself: two commands, no wallet and no keys. The second deploys the live router&apos;s exact code to a fresh testnet account and links each step.</p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-white/6 p-5 font-mono text-micro leading-7 text-white/90 ring-1 ring-white/10">
          <code>
            <span className="text-white/45"># contract tests: unit and sandbox</span>
            {"\n"}bash near/proof/contract-tests.sh{"\n\n"}
            <span className="text-white/45"># a real payment run on NEAR testnet</span>
            {"\n"}cd near/proof && npm ci && node testnet-proof.mjs
          </code>
        </pre>
      </article>
    </div>
  );
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-foreground/8 pt-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-2 text-muted-foreground">{children}</div>
    </section>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr] sm:gap-6">
      <dt className="font-semibold text-white">{term}</dt>
      <dd className="leading-relaxed text-white/75">{children}</dd>
    </div>
  );
}
