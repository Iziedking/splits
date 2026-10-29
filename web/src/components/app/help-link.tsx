import Link from "next/link";
import { helpHref } from "@/lib/support";
import { cn } from "@/lib/utils";

/** "Something wrong with this payment?", leading to Help with the payment's reference filled in. */
export function HelpLink({ paymentId, className }: { paymentId: string; className?: string }) {
  return (
    <Link
      href={helpHref(paymentId)}
      className={cn("inline-flex min-h-11 items-center text-sm font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline", className)}
    >
      Something wrong with this payment?
    </Link>
  );
}
