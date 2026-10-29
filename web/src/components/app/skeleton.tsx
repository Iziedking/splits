import { cn } from "@/lib/utils";

/**
 * A placeholder while something loads: one look everywhere, and the label read out instead of the
 * shapes. `className` sets the height; `rows` repeats the shape for a list.
 */
export function Skeleton({ label, rows = 1, className }: { label: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={cn(rows > 1 && "space-y-3")}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className={cn("rounded-md bg-white/60 ring-1 ring-white motion-safe:animate-pulse", className)} />
      ))}
    </div>
  );
}
