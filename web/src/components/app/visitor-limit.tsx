import Link from "next/link";
import { Notice } from "@/components/ui/field";

/** A SEND_LIMIT refusal, with the way up for people who don't have an account yet. */
export function VisitorLimit({ message, signedIn }: { message: string; signedIn: boolean }) {
  return (
    <Notice tone="error">
      <span className="block">{message}</span>
      {!signedIn && (
        <span className="mt-2 block">
          <Link href="/" className="font-semibold underline underline-offset-4">
            Create an account to raise your limit
          </Link>
          . Verified accounts will be able to send more once identity checks arrive.
        </span>
      )}
    </Notice>
  );
}
