import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * What a Splits balance is, in one place. Draft wording (2026-10-29, fintech face WP5): the owner
 * approved the points it covers; change the sentence here and every surface follows.
 */
export const MONEY_NOTICE =
  "Splits is not a bank. Your balance is held as digital dollars issued by Circle, in an account Splits runs for you, and it isn't covered by deposit insurance. Money leaves only when you approve it with your PIN, or through an automatic split you set up.";

/** The money notice, shown on Add money, Profile, About and the landing footer. */
export function MoneyNotice({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-xs leading-relaxed text-muted-foreground", className)}>
      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{MONEY_NOTICE}</span>
    </p>
  );
}
