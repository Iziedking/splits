import Link from "next/link";
import { Backdrop } from "@/components/app/backdrop";

/** A link that was mistyped, cut short, or never existed. Says so, and offers the way in. */
export default function ReceiptNotFound() {
  return (
    <div className="min-h-screen">
      <Backdrop />
      <main className="mx-auto max-w-md px-5 pt-24 pb-16">
        <h1 className="text-[2rem] leading-tight font-extrabold">This receipt link doesn&apos;t open.</h1>
        <p className="mt-2 text-muted-foreground">
          It may have been cut short when it was copied. Ask the sender to share it again from their payment in Splits.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex min-h-[52px] w-full items-center justify-center rounded-full bg-primary px-6 text-[15px] font-semibold text-primary-foreground hover:bg-primary-deep focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          Go to Splits
        </Link>
      </main>
    </div>
  );
}
