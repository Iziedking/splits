import { cn } from "@/lib/utils";

/**
 * The Splits logo (mark and wordmark) from the brand suite in public/Splits Logo Suite, trimmed
 * copies in public/brand. Teal on light screens, white on teal or night ones. Plain <img>: an SVG
 * needs no resizing, and it must not wait for script to show.
 */
export function Logo({ tone = "teal", className }: { tone?: "teal" | "white"; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={tone === "white" ? "/brand/logo-white.svg" : "/brand/logo.svg"}
      alt="Splits"
      width={90}
      height={28}
      className={cn("h-7 w-auto", className)}
    />
  );
}
