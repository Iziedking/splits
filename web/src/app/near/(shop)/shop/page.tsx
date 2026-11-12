import { Coffee } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PurposeDot } from "@/components/app/purpose-dot";
import { buttonSnippet, buyPath } from "@/lib/near/button";
import { DEMO_SHOP } from "@/lib/near/demo-shop";
import { formatUnits } from "@/lib/near/payment";

export const metadata: Metadata = { title: "Demo shop" };

/**
 * A pretend merchant's page, built the way any shop would be: its own look, its own product, and
 * the "Pay with Splits" button pasted in as the plain HTML snippet the setup page hands out.
 */
export default function DemoShopPage() {
  // The exact snippet a merchant pastes, opening in this tab so the way back is "Back to the shop".
  const button = buttonSnippet(`${buyPath(DEMO_SHOP)}&back=/near/shop`, "Pay with Splits", false);
  const price = formatUnits(DEMO_SHOP.amount!);

  return (
    <div className="min-h-dvh w-full">
      <p className="bg-foreground px-4 py-2 text-center text-sm text-white">
        A demo shop, to show the &ldquo;Pay with Splits&rdquo; button. Payments use NEAR testnet money with no value.
      </p>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-8">
        <p className="display-face text-xl font-bold">Kofi &amp; Co.</p>
        <p className="text-sm text-muted-foreground">Roasted in Lagos</p>
      </header>

      <main className="mx-auto grid w-full max-w-5xl gap-8 px-4 pt-4 pb-16 sm:px-8 md:grid-cols-2 md:items-center md:gap-14">
        <div aria-hidden="true" className="enter relative flex aspect-square items-center justify-center overflow-hidden rounded-3xl bg-purpose-3/25 ring-1 ring-white">
          <div className="absolute -right-16 -bottom-16 h-72 w-72 rounded-full bg-purpose-4/40 blur-3xl" />
          <Coffee className="relative h-32 w-32 text-foreground/80" strokeWidth={1.25} />
        </div>

        <div className="enter" style={{ animationDelay: "80ms" }}>
          <h1 className="display-face text-4xl leading-tight font-bold">{DEMO_SHOP.item}</h1>
          <p className="mt-3 text-lg text-muted-foreground">Medium roast from beans grown in Ondo. Chocolate, orange, a little spice.</p>
          <p className="figure mt-6 text-figure tabular-nums">
            {price} <span className="text-base font-semibold text-muted-foreground">USDC</span>
          </p>

          {/* The pasted button. buttonSnippet escapes everything it writes. */}
          <div className="mt-6" dangerouslySetInnerHTML={{ __html: button }} />

          <section aria-labelledby="where-title" className="surface mt-8 rounded-2xl p-5">
            <h2 id="where-title" className="font-semibold">
              Where your {price} goes
            </h2>
            <ul className="mt-3 space-y-2.5 text-sm">
              {DEMO_SHOP.parts.map((p, i) => (
                <li key={p.account} className="flex items-center gap-3">
                  <PurposeDot index={i} />
                  <span className="flex-1 first-letter:uppercase">{p.purpose}</span>
                  <span className="font-semibold tabular-nums">{p.bps / 100}%</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">The sale divides the moment it is paid. Nobody has to move money afterwards.</p>
          </section>

          <p className="mt-6 text-sm text-muted-foreground">
            This shop pasted one line of HTML.{" "}
            <Link className="font-medium text-primary-text underline underline-offset-4" href="/near/button">
              Make a button for your shop
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
