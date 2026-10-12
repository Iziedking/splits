import { purposeFill } from "@/lib/palette";

const LEGS = [
  { name: "Landlord", purpose: "Rent", share: 40, amount: "320.00" },
  { name: "School", purpose: "School fees", share: 35, amount: "280.00" },
  { name: "Sister", purpose: "Upkeep", share: 25, amount: "200.00" },
];

/**
 * The left half of the desktop welcome (UI_BRIEF.md v5, frames "MacBook Air - 1/2"). The designer
 * left an image slot here; until that image arrives it shows the product itself: one payment,
 * landing divided. Decorative, so hidden from screen readers (the right half says the same).
 */
export function WelcomePanel() {
  return (
    <aside aria-hidden="true" className="relative hidden overflow-hidden bg-[#0A7A73] lg:flex lg:items-center lg:justify-center">
      <div className="absolute -top-32 -left-24 h-[30rem] w-[30rem] rounded-full bg-[#2BC4BA]/60 blur-[100px]" />
      <div className="absolute -right-32 bottom-0 h-[28rem] w-[28rem] rounded-full bg-[#9B8CF2]/45 blur-[110px]" />
      <div className="absolute bottom-1/3 left-1/4 h-[18rem] w-[18rem] rounded-full bg-[#F2896D]/30 blur-[100px]" />

      <div className="relative w-[min(26rem,80%)]">
        <p className="text-sm font-semibold tracking-wide text-white">London → Lagos</p>
        <div className="mt-3 rounded-[24px] bg-white/95 p-6 text-foreground shadow-[0_30px_60px_-20px_rgb(14_28_43/0.45)]">
          <p className="text-sm text-muted-foreground">One payment</p>
          <p className="figure mt-1 text-[2.4rem] leading-none">$800.00</p>
          <div className="mt-5 flex h-2.5 gap-1.5">
            {LEGS.map((leg, i) => (
              <span key={leg.name} className="block h-full rounded-full" style={{ flexGrow: leg.share, backgroundColor: purposeFill(i) }} />
            ))}
          </div>
          <ul className="mt-5 space-y-3">
            {LEGS.map((leg, i) => (
              <li key={leg.name} className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: purposeFill(i) }} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{leg.name}</span>
                  <span className="block text-sm text-muted-foreground">{leg.purpose}</span>
                </span>
                <span className="font-semibold tabular-nums">${leg.amount}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-5 text-white">Lands divided on Arc in seconds. Everyone gets a receipt.</p>
      </div>
    </aside>
  );
}
