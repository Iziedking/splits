"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { cn } from "@/lib/utils";

const backClass =
  "-ml-2 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export interface BackLinkProps {
  /** Go to this page. */
  href?: string;
  /** Run this instead of navigating, for a step inside one page. */
  onClick?: () => void;
  /** With neither: back in this tab's history, or here in a fresh tab. */
  fallback?: string;
  label?: string;
  className?: string;
}

/**
 * The one back control. With `href` it is a link; with `onClick`, a button for the steps of one page;
 * with neither, back to the previous page in this tab (so About opened from Profile returns to
 * Profile) and, in a fresh tab opened on this page, to `fallback`.
 */
export function BackLink({ href, onClick, fallback = "/", label = "Back", className }: BackLinkProps) {
  const body = (
    <>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(backClass, className)}>
        {body}
      </button>
    );
  }
  if (href) {
    return (
      <Link href={href} className={cn(backClass, className)}>
        {body}
      </Link>
    );
  }
  return (
    <HistoryBack fallback={fallback} className={className}>
      {body}
    </HistoryBack>
  );
}

function HistoryBack({ fallback, className, children }: { fallback: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();
  return (
    <a
      href={fallback}
      onClick={(e) => {
        // In-app navigation never updates document.referrer, so the tab's own history decides.
        if (window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
      className={cn(backClass, className)}
    >
      {children}
    </a>
  );
}
