import { purposeFill } from "@/lib/palette";
import { cn } from "@/lib/utils";

/** The colour dot that ties a person to their part of the ribbon. Decoration only: the name says who. */
export function PurposeDot({ index, size = "sm", className }: { index: number; size?: "sm" | "md"; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("shrink-0 rounded-full", size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3", className)}
      style={{ backgroundColor: purposeFill(index) }}
    />
  );
}
