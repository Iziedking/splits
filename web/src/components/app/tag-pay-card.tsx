"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { Qr } from "@/components/app/address-qr";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { tagPayHref } from "@/lib/prefill";

/** A Split tag's page: who you're paying, how much and what for, then on to the right pay screen. */
export function TagPayCard({ tag, signedIn, pageUrl }: { tag: string; signedIn: boolean; pageUrl: string }) {
  const router = useRouter();
  const [amount, setAmount] = React.useState("");
  const [why, setWhy] = React.useState("");
  return (
    <form
      className="surface space-y-5 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(tagPayHref(tag, signedIn, amount, why));
      }}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <Qr value={pageUrl} size={168} label={`QR code of the page for @${tag}`} />
        <h1 className="text-title leading-tight font-extrabold break-all">@{tag}</h1>
        <p className="text-sm text-muted-foreground">Pay @{tag} on Splits{signedIn ? " from your balance." : ", with or without an account."}</p>
      </div>
      <Field label="Amount ($)" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
      <Field label="What's it for? (optional)" maxLength={31} value={why} onChange={(e) => setWhy(e.target.value)} />
      <Button type="submit" className="w-full">
        Pay @{tag}
      </Button>
    </form>
  );
}
