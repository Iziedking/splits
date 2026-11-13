import { cn } from "@/lib/utils";

/**
 * A person as a round badge: their picture if they set one, otherwise two letters from their email
 * (or account) on a colour that is always the same for the same person, so people tell each other
 * apart at a glance. Every colour carries white letters at 4.5:1 or better.
 */
const COLOURS = ["#0F766E", "#6D28D9", "#C2410C", "#BE185D", "#1D4ED8", "#4D7C0F", "#A16207", "#0E7490", "#9333EA", "#B91C1C"];

/** "ada.lovelace@x.com" -> "AL", "lawfuldlaw@gmail.com" -> "LA", "u-3f9c.splits-app.testnet" -> "U3". */
export function initials(label: string): string {
  const base = label.includes("@") ? label.split("@")[0]! : label.replace(/\.(testnet|near)$/i, "").split(".")[0]!;
  const words = base.split(/[._\-+\s]+/).filter((w) => /[a-z\d]/i.test(w));
  const letters = words.length >= 2 ? words[0]!.replace(/[^a-z\d]/gi, "")[0]! + words[1]!.replace(/[^a-z\d]/gi, "")[0]! : base.replace(/[^a-z\d]/gi, "").slice(0, 2);
  return (letters || "?").toUpperCase();
}

/** The same seed always gets the same colour. */
export function colourFor(seed: string): string {
  let h = 2166136261;
  for (const ch of seed.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return COLOURS[(h >>> 0) % COLOURS.length]!;
}

const SIZES = { sm: "h-8 w-8 text-xs", md: "h-10 w-10 text-sm", lg: "h-24 w-24 text-3xl" } as const;

export function Avatar({ label, src, size = "sm", className }: { label: string; src?: string | null; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ring-2 ring-white/70 select-none", SIZES[size], className)}
      style={{ backgroundColor: colourFor(label) }}
    >
      {initials(label)}
      {src && (
        // A data URL the person uploaded; next/image adds nothing for it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </span>
  );
}
