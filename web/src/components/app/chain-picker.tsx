"use client";

import { Check, ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { CROSS_WALLET_TEXT } from "@/lib/wallet/crossFlow";
import { unitsToUsd } from "@/lib/wallet/flow";
import type { ChainFunds } from "@/lib/wallet/sourceChains";

export type ChainOption = { key: string; name: string; gas: string; fast: boolean };

/** Each chain's own logo, served from /public/chains (official marks, stored with the app). */
function ChainLogo({ chain, className }: { chain: string; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  if (failed) {
    return (
      <span aria-hidden="true" className={cn("grid shrink-0 place-items-center rounded-full bg-muted text-xs font-bold uppercase", className)}>
        {chain.slice(0, 1)}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- tiny static icons; next/image adds nothing here
  return <img src={`/chains/${chain}.webp`} alt="" aria-hidden="true" className={cn("shrink-0 rounded-full object-cover", className)} onError={() => setFailed(true)} />;
}

type Row = { option: ChainOption; funds: ChainFunds | undefined; disabled: boolean; note: string | null };

function rowsFor(options: ChainOption[], funds: ChainFunds[] | null, needOf: (key: string) => bigint): Row[] {
  return options.map((o) => {
    const f = funds?.find((x) => x.key === o.key);
    const need = needOf(o.key);
    const short = Boolean(f && !f.error && f.usdc < need);
    const noGas = Boolean(f && !f.error && !short && f.gas === 0n);
    const note = !f
      ? null
      : f.error
        ? CROSS_WALLET_TEXT.unreadable(o.name)
        : short
          ? CROSS_WALLET_TEXT.short(unitsToUsd(f.usdc), o.name, unitsToUsd(need + 9_999n))
          : noGas
            ? CROSS_WALLET_TEXT.noGas(o.gas, o.name)
            : null;
    return { option: o, funds: f, disabled: !f || f.error || short || noGas, note };
  });
}

const balanceOf = (r: Row) => (!r.funds ? "…" : r.funds.error ? "—" : `$${unitsToUsd(r.funds.usdc)}`);
const timingOf = (o: ChainOption) => (o.key === "arc" ? "Pays directly on Arc" : o.fast ? "Lands on Arc in seconds" : "Lands on Arc in about a minute");

/**
 * Where the payer's USDC is: Arc, or one of the chains cross-chain pay is on, as a dropdown with
 * each chain's logo and what the connected wallet holds there. A chain that can't cover the payment
 * (or its network fee) is listed but can't be picked, and says what's missing.
 */
export function ChainPicker({
  options,
  funds,
  needOf,
  value,
  onChange,
}: {
  options: ChainOption[];
  funds: ChainFunds[] | null;
  /** What the payment needs on each chain (fees differ by chain). */
  needOf: (key: string) => bigint;
  value: string | null;
  onChange: (key: string) => void;
}) {
  const rows = rowsFor(options, funds, needOf);
  const selected = rows.find((r) => r.option.key === value) ?? null;
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!listRef.current?.contains(e.target as Node) && !buttonRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    listRef.current?.focus();
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function openList() {
    setActive(Math.max(0, rows.findIndex((r) => r.option.key === value)));
    setOpen(true);
  }

  function choose(i: number) {
    const r = rows[i];
    if (!r || r.disabled) return;
    onChange(r.option.key);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onListKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + rows.length) % rows.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      if (e.key === "Escape") buttonRef.current?.focus();
    }
  }

  return (
    <div className="space-y-2">
      <span id={`${listId}-label`} className="block text-sm font-semibold">
        Pay from
      </span>
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${listId}-label ${listId}-value`}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              openList();
            }
          }}
          className="flex min-h-[60px] w-full items-center gap-3 rounded-[14px] bg-white/80 px-4 py-3 text-left ring-1 ring-white hover:bg-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {selected ? (
            <>
              <ChainLogo chain={selected.option.key} className="h-8 w-8" />
              <span id={`${listId}-value`} className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{selected.option.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{timingOf(selected.option)}</span>
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">{balanceOf(selected)}</span>
            </>
          ) : (
            <span id={`${listId}-value`} className="flex-1 text-muted-foreground">
              {funds ? "Choose a chain" : "Reading your balances…"}
            </span>
          )}
          <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <ul
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={`${listId}-label`}
            aria-activedescendant={`${listId}-${active}`}
            onKeyDown={onListKey}
            className="absolute inset-x-0 top-full z-20 mt-2 max-h-[min(26rem,60vh)] overflow-y-auto rounded-[14px] bg-white p-1 shadow-lg ring-1 ring-black/5 focus:outline-none"
          >
            {rows.map((r, i) => (
              <li
                key={r.option.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={r.option.key === value}
                aria-disabled={r.disabled}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-[10px] px-3 py-2.5",
                  i === active && !r.disabled && "bg-primary/10",
                  r.disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <ChainLogo chain={r.option.key} className={cn("mt-0.5 h-7 w-7", r.disabled && "grayscale")} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-semibold">{r.option.name}</span>
                    <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{balanceOf(r)}</span>
                  </span>
                  <span className="block text-xs text-muted-foreground">{r.note ?? timingOf(r.option)}</span>
                </span>
                <Check aria-hidden="true" className={cn("mt-1 h-4 w-4 shrink-0 text-primary", r.option.key === value ? "visible" : "invisible")} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected?.option.key === "eth" && <p className="text-xs text-muted-foreground">Ethereum&apos;s network fee can run to a few dollars.</p>}
    </div>
  );
}
