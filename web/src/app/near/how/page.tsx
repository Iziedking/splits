import type { Metadata } from "next";
import { NEAR, accountUrl } from "@/lib/near/config";

export const metadata: Metadata = { title: "How it works" };

export default function NearHowPage() {
  return (
    <article className="surface mx-auto max-w-2xl rounded-lg p-6 text-sm leading-relaxed sm:p-8">
      <h1 className="display-face text-3xl font-bold">How it works, and its limits</h1>
      <h2 className="mt-6 text-base font-bold">The payment</h2>
      <p className="mt-2 text-muted-foreground">
        Your wallet calls ft_transfer_call on the {NEAR.tokenSymbol} contract, sending the total to the{" "}
        <a className="underline" href={accountUrl(NEAR.router)} target="_blank" rel="noreferrer">
          splits router
        </a>{" "}
        with the list of parts in the message. The router checks it (the parts add up, nobody twice, a reference you haven&apos;t used) and sends each part on. If anything is wrong it
        sends nothing and the token returns the whole amount to you.
      </p>
      <h2 className="mt-6 text-base font-bold">Saved splits</h2>
      <p className="mt-2 text-muted-foreground">
        Anyone can save their own split in the router: shares that add up to 100%, each with a purpose. A payment sent to them through the router is divided by it on chain. Each save gets a new
        version, and a payer whose page showed an older version is refused and refunded.
      </p>
      <h2 className="mt-6 text-base font-bold">Limits, stated plainly</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
        <li>NEAR contracts call each other asynchronously, so the parts are not all-or-nothing. If one can&apos;t be delivered, that part comes back to you and the others still land. The result screen says which.</li>
        <li>The router holds the money for a few blocks, between receiving it and paying it out.</li>
        <li>At most 10 people per payment, and the smallest payment is 0.01.</li>
        <li>Recipients must be registered with the token. If they aren&apos;t, your approval registers them for 0.00125 NEAR each.</li>
        <li>This runs on NEAR {NEAR.network}. Testnet money has no value.</li>
        <li>The router has no owner, no admin and no upgrade method; the token it accepts is fixed.</li>
      </ul>
      <h2 className="mt-6 text-base font-bold">Plain words to a split</h2>
      <p className="mt-2 text-muted-foreground">
        &ldquo;Describe it&rdquo; and &ldquo;Auto-split my income&rdquo; turn your words into a list or a split for you to check. Only accounts, amounts and percentages you typed can appear; the rest of a
        split is worked out by code, not by the model; nothing is signed except by you, in your wallet.
      </p>
    </article>
  );
}
