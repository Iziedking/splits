"use client";

import * as React from "react";
import { friendlyName } from "@/lib/near/names";
import { cn } from "@/lib/utils";
import { useMaybeNearWallet } from "./wallet";

/** An account address broken at its dots, so long names wrap cleanly. */
function Address({ id, className }: { id: string; className?: string }) {
  return (
    <span className={cn("block font-mono text-micro tracking-normal [overflow-wrap:anywhere]", className)}>
      {id.split(".").map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <>
              .<wbr />
            </>
          )}
          {part}
        </React.Fragment>
      ))}
    </span>
  );
}

/**
 * A person or pocket by name ("You", "Your tax pocket", an email they were paid by), with the
 * address one tap away. Accounts with no known name show the address itself.
 */
export function AccountName({ id, className }: { id: string; className?: string }) {
  const me = useMaybeNearWallet()?.accountId ?? null;
  const [name, setName] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  // Names come from this device, so they appear after the first render, never during it.
  React.useEffect(() => setName(friendlyName(id, me)), [id, me]);
  if (!name) return <Address id={id} className={className} />;
  return (
    <span className={cn("block", className)}>
      <button
        type="button"
        aria-expanded={open}
        title={open ? "Hide the address" : "Show the address"}
        onClick={() => setOpen((o) => !o)}
        className="rounded-sm text-left decoration-dotted underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
      >
        {name}
      </button>
      {open && <Address id={id} className="mt-0.5 font-normal text-muted-foreground" />}
    </span>
  );
}
