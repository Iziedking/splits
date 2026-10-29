"use client";

import * as React from "react";
import { AddressQr } from "@/components/app/address-qr";
import { CopyAddress, CopyButton } from "@/components/app/copy-address";
import { PaymentDetails } from "@/components/app/payment-details";
import { Sheet } from "@/components/app/sheet";

/**
 * Receive money (fintech face WP5): people on Splits pay your email, so that comes first. The
 * account address is for people paying from a crypto wallet, so it waits in a fold of its own.
 */
export function ReceiveSheet({ email, address, open, onClose }: { email: string; address: string; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Receive money" description="People on Splits can pay your email.">
      <div className="mt-5 rounded-md bg-white/70 p-4 ring-1 ring-border">
        <p className="text-xs font-semibold text-muted-foreground">Your email</p>
        <p className="mt-1 truncate text-lg font-bold">{email}</p>
        <CopyButton value={email} shown="Copy email" what="your email" className="mt-3" />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Share it with whoever is paying you. If they don&apos;t have Splits yet, they can pay without an account.
      </p>

      <PaymentDetails summary="Receive from a crypto wallet" className="mt-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <AddressQr address={address} size={128} />
          <div className="min-w-0 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">Your account address</p>
            <code className="block text-sm break-all">{address}</code>
            <CopyAddress address={address} tone="dark" />
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Only USDC, from the networks listed under Add money.</p>
      </PaymentDetails>
    </Sheet>
  );
}
