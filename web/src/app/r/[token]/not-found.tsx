import { ButtonLink } from "@/components/ui/button";
import { Backdrop } from "@/components/app/backdrop";

/** A link that was mistyped, cut short, or never existed. Says so, and offers the way in. */
export default function ReceiptNotFound() {
  return (
    <div className="min-h-screen">
      <Backdrop />
      <main className="mx-auto max-w-md px-5 pt-24 pb-16">
        <h1 className="text-title leading-tight font-extrabold">This receipt link doesn&apos;t open.</h1>
        <p className="mt-2 text-muted-foreground">
          It may have been cut short when it was copied. Ask the sender to share it again from their payment in Splits.
        </p>
        <ButtonLink href="/" className="mt-8 w-full">
          Go to Splits
        </ButtonLink>
      </main>
    </div>
  );
}
