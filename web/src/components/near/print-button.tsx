"use client";

import { Printer } from "lucide-react";

/** A clean printable receipt: the site's header and footer are hidden in print. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-text underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none print:hidden"
    >
      <Printer className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      Print or save as PDF
    </button>
  );
}
