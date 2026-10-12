import Link from "next/link";
import { BackLink } from "@/components/app/back-link";
import { Backdrop } from "@/components/app/backdrop";
import { Ribbon } from "@/components/app/ribbon";
import { VisitorHeader } from "@/components/app/visitor-header";
import { purposeFill } from "@/lib/palette";

export const metadata = {
  title: "About Splits",
  description: "Send money home in one payment and it arrives divided between the people it is for, each part with its purpose.",
};

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

/**
 * What Splits is and the problem it solves, readable without signing in (linked quietly from the
 * welcome screen and from the bottom of Profile). Leads with money sent home by the diaspora; the
 * other uses of the same engine come after.
 */
export default function AboutPage() {
  return (
    <>
      <Backdrop />
      <VisitorHeader />
      <main className="mx-auto max-w-md space-y-6 px-5 pt-4 pb-[max(3rem,env(safe-area-inset-bottom))]">
        <section className="enter">
          <BackLink />
          <p className="mt-3 text-sm font-semibold text-primary">About Splits</p>
          <h1 className="mt-2 text-[2.4rem] leading-[1.08] font-extrabold">
            Money home,
            <br />
            already divided.
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            Splits is for people who send money home. You send one payment, and it arrives split between the people it
            is for, each part labelled with what it pays for.
          </p>
        </section>

        <section aria-labelledby="problem-heading" className="surface space-y-3 p-6">
          <h2 id="problem-heading" className="text-xl font-extrabold">
            The problem
          </h2>
          <p className="leading-relaxed">
            If you live in London and support family in Lagos, you rarely send money for one thing. This month it is rent,
            your sister&apos;s school fees and something for upkeep.
          </p>
          <p className="leading-relaxed">
            Today you either send one lump sum and trust someone to share it out the way you meant, or you make three
            transfers and pay a fee on each. Once it has gone, nobody can see which part was meant for what, including
            you.
          </p>
        </section>

        <section aria-labelledby="how-heading" className="surface space-y-4 p-6">
          <h2 id="how-heading" className="text-xl font-extrabold">
            How Splits fixes it
          </h2>
          <p className="leading-relaxed">
            You set it up once: who gets paid, how much and what for. Then every payment you send lands already divided.
          </p>
          <figure className="rounded-[18px] bg-white/60 p-4 ring-1 ring-white">
            <Ribbon parts={EXAMPLE} height={14} />
            <figcaption className="mt-3 space-y-1.5 text-sm">
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
          <p className="leading-relaxed">
            Splits pays everyone in a single transaction on Arc, a network that settles in seconds and charges its fees in
            dollars. Either everyone is paid or nobody is, so a payment never lands half done.
          </p>
          <p className="leading-relaxed">
            Your family doesn&apos;t need an app or a crypto wallet. Their email address is their wallet, and the money is
            waiting when they sign in. Each person gets a private receipt showing their part and what it was for.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            Splits charges 1.5% on top of what you send, or 2% when you pay ten people or more. You see it before you
            approve, next to exactly what each person gets.
          </p>
        </section>

        <section aria-labelledby="also-heading" className="surface p-6">
          <h2 id="also-heading" className="text-xl font-extrabold">
            The same engine splits other things
          </h2>
          <dl className="mt-4 space-y-4">
            {ALSO.map(([title, text]) => (
              <div key={title}>
                <dt className="font-bold">{title}</dt>
                <dd className="mt-0.5 leading-relaxed text-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="safe-heading" className="surface space-y-3 p-6">
          <h2 id="safe-heading" className="text-xl font-extrabold">
            How your money stays safe
          </h2>
          <p className="leading-relaxed">
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
          <p className="leading-relaxed">
            Every payment needs your PIN, or Face ID or a fingerprint if you turn it on, and Splits checks the result on Arc before it tells you the money
            arrived.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            Accounts made with an email use wallets that Splits manages for you through Circle. If you&apos;d rather keep
            your own keys, pay from your own wallet. While we add identity checks, nobody can send more than 500 USDC a
            day.
          </p>
        </section>

        <section aria-labelledby="next-heading" className="surface space-y-3 p-6">
          <h2 id="next-heading" className="text-xl font-extrabold">
            Coming next
          </h2>
          <p className="leading-relaxed">
            Paying by card, Apple Pay, Google Pay or bank transfer. Cashing out to a bank account or mobile money in
            Nigeria. And an optional pocket that earns on money you leave in Splits, which you can switch off any time.
          </p>
        </section>

        <div className="space-y-3 pt-2">
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
      </main>
    </>
  );
}
