import Link from "next/link";
import { Ribbon } from "@/components/app/ribbon";
import { purposeFill } from "@/lib/palette";

const EXAMPLE = [
  { label: "Rent", weight: 40, who: "the landlord" },
  { label: "School fees", weight: 35, who: "the school" },
  { label: "Upkeep", weight: 25, who: "your sister" },
];

const ALSO = [
  ["Giveaways and prizes", "Paste the winners, split a pot to the cent and pay all of them in one go."],
  ["Team and revenue shares", "Divide what comes in between partners the same way every time."],
  ["One person", "Pay anyone by email or Arc address. The receipt says what it was for."],
  ["Automatic splits", "Have a share of everything you receive moved to savings by itself."],
  ["Describe it, I split it", "Paste a rough note, or a screenshot of a chat or spreadsheet, and Splits fills in the list for you to check."],
  ["No account needed", "Pay straight from your own wallet, in your browser or with WalletConnect."],
] as const;

/** One topic of the page: heading beside its text on desktop, above it on a phone. */
function Topic({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="py-7 first:pt-0 last:pb-0 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12 lg:py-9">
      <h2 id={id} className="text-xl font-extrabold lg:text-lg">
        {title}
      </h2>
      <div className="mt-3 space-y-3 leading-relaxed lg:mt-0">{children}</div>
    </section>
  );
}

/**
 * What Splits is and the problem it solves (UI_BRIEF.md v5). Leads with money sent home by the
 * diaspora; the other uses of the same engine come after. One document, not a wall of cards: an
 * opening with the example split beside it, then one panel of topics divided by rules.
 * `top` is what sits above the eyebrow (a Back link for visitors); `cta` closes the page.
 */
export function AboutContent({ top, cta }: { top?: React.ReactNode; cta?: React.ReactNode }) {
  return (
    <div className="enter space-y-8 lg:space-y-12">
      <header className="lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end lg:gap-12">
        <div>
          {top}
          <p className="mt-3 text-sm font-semibold text-primary">About Splits</p>
          <h1 className="mt-2 text-[2.4rem] leading-[1.08] font-extrabold lg:text-[3rem]">
            Money home,
            <br />
            already divided.
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Splits is for people who send money home. You send one payment, and it arrives split between the people it
            is for, each part labelled with what it pays for.
          </p>
        </div>
        <figure className="surface mt-6 p-5 lg:mt-0">
          <p className="text-sm text-muted-foreground">One payment from London to Lagos</p>
          <Ribbon className="mt-4" parts={EXAMPLE} height={14} />
          <figcaption className="mt-4 space-y-2 text-sm">
            {EXAMPLE.map((part, i) => (
              <span key={part.label} className="flex items-center gap-2">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: purposeFill(i) }} />
                <span className="font-semibold tabular-nums">{part.weight}%</span>
                <span className="text-muted-foreground">
                  {part.label.toLowerCase()}, to {part.who}
                </span>
              </span>
            ))}
          </figcaption>
        </figure>
      </header>

      <div className="surface divide-y divide-border px-6 py-7 lg:px-10 lg:py-9">
        <Topic id="problem-heading" title="The problem">
          <p>
            If you live in London and support family in Lagos, you rarely send money for one thing. This month it is rent,
            your sister&apos;s school fees and something for upkeep.
          </p>
          <p>
            Today you either send one lump sum and trust someone to share it out the way you meant, or you make three
            transfers and pay a fee on each. Once it has gone, nobody can see which part was meant for what, including
            you.
          </p>
        </Topic>

        <Topic id="how-heading" title="How Splits fixes it">
          <p>You set it up once: who gets paid, how much and what for. Then every payment you send lands already divided.</p>
          <p>
            Splits pays everyone in a single transaction on Arc, a network that settles in seconds and charges its fees in
            dollars. Either everyone is paid or nobody is, so a payment never lands half done.
          </p>
          <p>
            Your family doesn&apos;t need an app or a crypto wallet. Their email address is their wallet, and the money is
            waiting when they sign in. Each person gets a private receipt showing their part and what it was for.
          </p>
          <p className="text-muted-foreground">
            Splits charges 1.5% on top of what you send, or 2% when you pay ten people or more. You see it before you
            approve, next to exactly what each person gets.
          </p>
        </Topic>

        <Topic id="also-heading" title="The same engine splits other things">
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {ALSO.map(([title, text]) => (
              <div key={title}>
                <dt className="font-bold">{title}</dt>
                <dd className="mt-0.5 text-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
        </Topic>

        <Topic id="safe-heading" title="How your money stays safe">
          <p>
            Payments go through a small contract on Arc that never holds money and has no owner who could redirect it.{" "}
            <a
              href="https://explorer.arc.io/address/0x8eDb15a372D3b691E2264fFc897EC53dFF4A64F2?tab=contract"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-primary underline underline-offset-4"
            >
              Its code is public and verified.
            </a>
          </p>
          <p>
            Every payment needs your PIN, or Face ID or a fingerprint if you turn it on, and Splits checks the result on
            Arc before it tells you the money arrived.
          </p>
          <p className="text-muted-foreground">
            Accounts made with an email use wallets that Splits manages for you through Circle. If you&apos;d rather keep
            your own keys, pay from your own wallet. While we add identity checks, nobody can send more than 500 USDC a
            day.
          </p>
        </Topic>

        <Topic id="next-heading" title="Coming next">
          <p>
            Paying by card, Apple Pay, Google Pay or bank transfer. Cashing out to a bank account or mobile money in
            Nigeria. And an optional pocket that earns on money you leave in Splits, which you can switch off any time.
          </p>
        </Topic>
      </div>

      {cta}
    </div>
  );
}

/** The close for visitors: start an account, or pay without one. */
export function AboutSignUp() {
  return (
    <div className="mx-auto w-full max-w-sm space-y-3">
      <Link
        href="/"
        className="flex min-h-[52px] items-center justify-center rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground shadow-[0_10px_24px_-12px_rgb(15_163_154/0.7)] hover:bg-primary-deep focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        Get started
      </Link>
      <Link
        href="/send"
        className="flex min-h-11 items-center justify-center rounded-full text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        Pay without an account
      </Link>
    </div>
  );
}
