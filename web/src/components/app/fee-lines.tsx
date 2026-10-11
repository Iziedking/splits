import { cn } from "@/lib/utils";

/** The fee and what the sender pays in all. Shown before approval, never on recipients' receipts. */
export function FeeLines({ fee, percent, total, className }: { fee: string; percent: number; total: string; className?: string }) {
  if (fee === "0.00") return null;
  return (
    <dl className={cn("space-y-1 text-sm", className)}>
      <div className="flex justify-between gap-4">
        <dt className="text-muted-foreground">Splits fee ({percent}%)</dt>
        <dd className="tabular-nums">${fee}</dd>
      </div>
      <div className="flex justify-between gap-4 font-semibold">
        <dt>You pay</dt>
        <dd className="tabular-nums">${total}</dd>
      </div>
    </dl>
  );
}
