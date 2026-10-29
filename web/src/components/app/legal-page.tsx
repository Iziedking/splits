import Link from "next/link";
import { MoneyNotice } from "@/components/app/money-notice";
import { Notice } from "@/components/ui/field";

/**
 * A legal document's page (fintech face WP7). The documents are the owner's to write; until one is
 * published, its page says so plainly and still resolves, so every link to it works today.
 */
export function LegalPage({ title, pending, children }: { title: string; pending: string; children?: React.ReactNode }) {
  return (
    <div className="enter space-y-6">
      <h1 className="text-title leading-tight font-extrabold">{title}</h1>
      {children ?? <Notice>{pending} Questions in the meantime go through Help.</Notice>}
      <MoneyNotice />
      <nav aria-label="More" className="flex flex-wrap gap-x-5 text-sm font-semibold text-primary-text">
        <Link href="/help" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
          Help
        </Link>
        <Link href="/legal/terms" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
          Terms of use
        </Link>
        <Link href="/legal/privacy" className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">
          Privacy notice
        </Link>
      </nav>
    </div>
  );
}
