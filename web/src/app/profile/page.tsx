"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AddMoneySheet } from "@/components/app/add-money-sheet";
import { AddressQr } from "@/components/app/address-qr";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { useSignOut } from "@/components/app/sign-out";
import { CopyAddress } from "@/components/app/copy-address";
import { MoneyNotice } from "@/components/app/money-notice";
import { PaymentDetails } from "@/components/app/payment-details";
import { Ribbon } from "@/components/app/ribbon";
import { Skeleton } from "@/components/app/skeleton";
import { ChangeTagSheet, TagBlock, TagQrSheet } from "@/components/app/tag-sheets";
import { Button, ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/field";
import { api, type SplitView } from "@/lib/api";

export default function ProfilePage() {
  return (
    <AppFrame>
      <Profile />
    </AppFrame>
  );
}

/**
 * Profile (fintech face WP5): the account first, then its limits, then what it does by itself. The
 * account address is for people paying from a crypto wallet, so it sits in a fold.
 */
function Profile() {
  const { me, refresh } = useMe();
  const [tagSheet, setTagSheet] = React.useState<"qr" | "change" | null>(null);
  // The tag's page link uses the address this page was opened at; it's only known in the browser.
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);
  const { signOut, signingOut, overlay } = useSignOut();
  const main = me.wallets.find((w) => w.kind === "main");
  const [adding, setAdding] = React.useState(false);
  /** undefined: loading; null: none set up; "error": unknown, so never offered as missing. */
  const [rule, setRule] = React.useState<SplitView | null | undefined | "error">(undefined);

  const loadRule = React.useCallback(() => {
    setRule(undefined);
    api<{ splits: SplitView[] }>("/api/splits")
      .then((r) => setRule(r.splits.find((s) => s.automatic && s.status !== "failed") ?? null))
      .catch(() => setRule("error"));
  }, []);
  React.useEffect(loadRule, [loadRule]);

  return (
    <div className="enter space-y-6 pt-4">
      <div className="space-y-6">
        <h1 className="text-title leading-tight font-extrabold">Profile</h1>

        <section aria-labelledby="account-heading" className="surface p-6">
          <h2 id="account-heading" className="text-lg font-extrabold">
            Your account
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="min-w-0 truncate font-medium">{me.user.email}</dd>
            </div>
            {(me.mode === "preview" || me.network === "arc-testnet") && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Money</dt>
                <dd className="font-medium">{me.mode === "preview" ? "Test money, simulated" : "Test money, no value"}</dd>
              </div>
            )}
          </dl>
          {me.user.tag && (
            <TagBlock tag={me.user.tag} changesLeft={me.user.tagChangesLeft} onChange={() => setTagSheet("change")} onQr={() => setTagSheet("qr")} />
          )}
          {main && (
            <>
              <Button variant="secondary" size="sm" className="mt-4" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add money
              </Button>
              <PaymentDetails summary="Show account address" className="mt-4" proofUrl={main.explorerUrl}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <AddressQr address={main.address} size={128} />
                  <div className="min-w-0 space-y-2">
                    <code className="block text-sm break-all">{main.address}</code>
                    <CopyAddress address={main.address} tone="dark" />
                  </div>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  People on Splits can pay your email. Anyone else can send USDC to this address on{" "}
                  {me.network === "arc" ? "Arc" : "Arc Testnet"}.
                </p>
              </PaymentDetails>
            </>
          )}
          <MoneyNotice className="mt-4" />
        </section>

        <section aria-labelledby="limits-heading" className="surface p-6">
          <h2 id="limits-heading" className="text-lg font-extrabold">
            Verification and limits
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Splits doesn&apos;t verify identity yet, so every account has the same limits.</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Each payment</dt>
              <dd className="font-medium tabular-nums">up to ${me.limits.perPayment}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Any 24 hours</dt>
              <dd className="font-medium tabular-nums">up to ${me.limits.daily}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">Both include the Splits fee.</p>
        </section>

        <section aria-labelledby="auto-heading" className="surface p-6">
          <h2 id="auto-heading" className="text-lg font-extrabold">
            Automatic split
          </h2>
          {rule === undefined ? (
            <Skeleton label="Loading your automatic split" className="mt-3 h-10" />
          ) : rule === "error" ? (
            <div className="mt-3 space-y-3">
              <Notice tone="error">Your automatic split didn&apos;t load.</Notice>
              <Button variant="secondary" size="sm" onClick={loadRule}>
                Try again
              </Button>
            </div>
          ) : rule ? (
            <>
              <p className="mt-1 text-muted-foreground">{rule.name}. Runs by itself on every payment you receive.</p>
              <Ribbon className="mt-4" parts={rule.legs.map((l) => ({ label: l.name, weight: l.percent ?? 0 }))} />
            </>
          ) : (
            <>
              <p className="mt-1 text-muted-foreground">Put part of every payment you receive into savings, automatically.</p>
              <ButtonLink href="/rules/new" variant="secondary" size="sm" className="mt-4">
                Set it up
              </ButtonLink>
            </>
          )}
        </section>

        {me.earn && (
          <section aria-labelledby="earn-heading" className="surface p-6">
            <h2 id="earn-heading" className="text-lg font-extrabold">
              Earning pocket
            </h2>
            <p className="mt-1 text-muted-foreground">Keep part of your money earning a variable return. Move it back whenever you like.</p>
            <ButtonLink href="/earn" variant="secondary" size="sm" className="mt-4">
              Open
            </ButtonLink>
          </section>
        )}
      </div>

      <div className="space-y-6">
        <section aria-label="Settings and sign out" className="surface p-6">
          <Link
            href="/settings"
            className="flex min-h-11 items-center justify-between rounded-sm bg-white/70 px-4 text-sm font-semibold ring-1 ring-border hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Settings
            <span className="text-xs font-normal text-muted-foreground">PIN, Face ID, email alerts</span>
          </Link>
          <Link
            href="/help"
            className="mt-3 flex min-h-11 items-center justify-between rounded-sm bg-white/70 px-4 text-sm font-semibold ring-1 ring-border hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Help
            <span className="text-xs font-normal text-muted-foreground">Questions, terms, privacy</span>
          </Link>
          <Button variant="secondary" className="mt-5 w-full" disabled={signingOut} onClick={() => void signOut()}>
            Sign out
          </Button>
        </section>
      </div>

      <Link
        href="/about"
        className="mx-auto flex min-h-11 w-fit items-center rounded-full px-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:col-span-2"
      >
        About Splits
      </Link>

      {main && <AddMoneySheet address={main.address} network={me.network} open={adding} onClose={() => setAdding(false)} />}
      {me.user.tag && origin && <TagQrSheet open={tagSheet === "qr"} onClose={() => setTagSheet(null)} tag={me.user.tag} origin={origin} />}
      {me.user.tag && (
        <ChangeTagSheet
          open={tagSheet === "change"}
          onClose={() => setTagSheet(null)}
          current={me.user.tag}
          changesLeft={me.user.tagChangesLeft}
          hasPasskey={me.user.hasPasskey}
          onChanged={refresh}
        />
      )}
      {overlay}
    </div>
  );
}
