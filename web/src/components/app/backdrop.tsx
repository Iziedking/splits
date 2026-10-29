import { cn } from "@/lib/utils";

/**
 * The soft gradient behind every screen (UI_BRIEF.md v4): teal at the top right, lilac mid-right,
 * peach bottom-left over mist. "night" is the live settlement screen. The blobs never move.
 */
export function Backdrop({ tone = "day", className }: { tone?: "day" | "night"; className?: string }) {
  if (tone === "night") {
    return (
      <div aria-hidden="true" className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-night", className)}>
        <div className="absolute -top-24 -right-24 h-[26rem] w-[26rem] rounded-full bg-primary/35 blur-[90px]" />
        <div className="absolute top-1/3 -left-32 h-[22rem] w-[22rem] rounded-full bg-night-glow-teal/60 blur-[90px]" />
        <div className="absolute -bottom-24 left-1/4 h-[24rem] w-[24rem] rounded-full bg-night-glow-warm/45 blur-[100px]" />
      </div>
    );
  }
  return (
    <div aria-hidden="true" className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background", className)}>
      <div className="absolute -top-32 -right-24 h-[30rem] w-[30rem] rounded-full bg-haze-teal/70 blur-[90px]" />
      <div className="absolute top-[28%] -right-40 h-[26rem] w-[26rem] rounded-full bg-haze-lilac/70 blur-[100px]" />
      <div className="absolute -bottom-32 -left-28 h-[28rem] w-[28rem] rounded-full bg-haze-peach/70 blur-[100px]" />
    </div>
  );
}
