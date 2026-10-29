"use client";

import { ExternalLink, Wallet } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { AddMoney, AddressQr } from "@/components/app/add-money";
import { AppFrame, useMe } from "@/components/app/app-frame";
import { useSignOut } from "@/components/app/sign-out";
import { CopyAddress } from "@/components/app/copy-address";
import { Ribbon } from "@/components/app/ribbon";
import { Skeleton } from "@/components/app/skeleton";
import { Button, ButtonLink } from "@/components/ui/button";
import { api, type SplitView } from "@/lib/api";

export default function ProfilePage() {
  return (
    <AppFrame>
      <Profile />
    </AppFrame>
  );
}

function Profile() {
  const { me } = useMe();
  const { signOut, signingOut, overlay } = useSignOut();
  const main = me.wallets.find((w) => w.kind === "main");
  const [adding, setAdding] = React.useState(false);
  const [rule, setRule] = React.useState<SplitView | null | undefined>(undefined);

  React.useEffect(() => {
    api<{ splits: SplitView[] }>("/api/splits")
      .then((r) => setRule(r.splits.find((s) => s.automatic && s.status !== "failed") ?? null))
      .catch(() => setRule(null));
  }, []);

  return (
    <div className="enter space-y-6 pt-4">
      <div className="space-y-6">
        <h1 className="text-title leading-tight font-extrabold">Profile</h1>

        {main && (
          <section aria-labelledby="address-heading" className="surface p-6">
            <h2 id="address-heading" className="text-lg font-extrabold">
              Your wallet address
            </h2>
            <p className="mt-1 text-muted-foreground">
              Anyone can pay you here with USDC on {me.network === "arc" ? "Arc" : "Arc Testnet"}. Your email works too, for
              people using Splits.
            </p>
            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
              <AddressQr address={main.address} size={160} />
              <div className="min-w-0 space-y-3">
                <code className="block text-sm break-all">{main.address}</code>
                <div className="flex flex-wrap gap-2">
                  <CopyAddress address={main.address} tone="dark" />
                  <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                    <Wallet className="h-4 w-4" aria-hidden="true" />
                    Add money
                  </Button>
                </div>
                {main.explorerUrl && (
                  <a
                    href={main.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold underline underline-offset-4"
                  >
                    See it on the Arc explorer
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}
              </div>
            </div>
          </section>
        )}

        <section aria-labelledby="auto-heading" className="surface p-6">
          <h2 id="auto-heading" className="text-lg font-extrabold">
            Automatic split
          </h2>
          {rule === undefined ? (
            <Skeleton label="Loading your automatic split" className="mt-3 h-10" />
          ) : rule ? (
            <>
              <p className="mt-1 text-muted-foreground">{rule.name}. Runs by itself on every payment that reaches your wallet.</p>
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
            <p className="mt-1 text-muted-foreground">
              Keep part of your money earning a variable return through a vetted vault on Arc. Move it back whenever you like.
            </p>
            <ButtonLink href="/earn" variant="secondary" size="sm" className="mt-4">
              Open
            </ButtonLink>
          </section>
        )}
      </div>

      <div className="space-y-6">
        <section aria-labelledby="account-heading" className="surface p-6">
          <h2 id="account-heading" className="text-lg font-extrabold">
            Account
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate font-medium">{me.user.email}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Network</dt>
              <dd className="font-medium">
                {me.mode === "preview" ? "Preview (simulated)" : me.network === "arc" ? "Arc" : "Arc Testnet, test money with no value"}
              </dd>
            </div>
          </dl>
          <Link
            href="/settings"
            className="mt-4 flex min-h-11 items-center justify-between rounded-sm bg-white/70 px-4 text-sm font-semibold ring-1 ring-border hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Settings
            <span className="text-xs font-normal text-muted-foreground">PIN, Face ID, email alerts</span>
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

      {main && <AddMoney address={main.address} network={me.network} open={adding} onClose={() => setAdding(false)} />}
      {overlay}
    </div>
  );
}
