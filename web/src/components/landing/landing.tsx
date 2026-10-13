"use client";

import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Logo } from "@/components/app/logo";
import { cn } from "@/lib/utils";

/**
 * The public landing page at /. One pinned scroll scene: a single glass card ("one payment")
 * divides into three panes, the amounts count up and each part lands with its receipt. Then quiet
 * sections on the app's own mist backdrop, every claim about the live product as it works today,
 * and the roadmap marked "Planned". Motion follows the scroll only; reduced motion shows the end
 * state and turns the drifting haze off.
 */

const ROUTER = "0x8eDb15a372D3b691E2264fFc897EC53dFF4A64F2";
const EXPLORER = `https://explorer.arc.io/address/${ROUTER}?tab=contract`;
const LIMIT = 500;

/** The scene's payment: within the live 500 USDC limit, split the way the app would. */
const PANES = [
  { who: "Landlord", what: "Rent", share: 50, cents: 22500, color: "var(--purpose-1)" },
  { who: "School", what: "School fees", share: 30, cents: 13500, color: "var(--purpose-2)" },
  { who: "Mum", what: "Upkeep", share: 20, cents: 9000, color: "var(--purpose-3)" },
];

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Smoothstep of x between a and b. */
const sm = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const glass =
  "border border-white/70 bg-white/60 shadow-[inset_0_1px_0_rgb(255_255_255/0.8),0_10px_36px_rgb(14_28_43/0.10)] backdrop-blur-xl backdrop-saturate-150";

function Haze() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
      <i className="absolute -top-[10vw] -left-[12vw] h-[46vw] w-[46vw] rounded-full bg-[#8fe3dc] opacity-70 blur-[90px] will-change-transform animate-drift-a motion-reduce:animate-none" />
      <i className="absolute top-[18vh] -right-[10vw] h-[40vw] w-[40vw] rounded-full bg-[#c9c1f8] opacity-70 blur-[100px] will-change-transform animate-drift-b motion-reduce:animate-none" />
      <i className="absolute -bottom-[20vw] left-[12vw] h-[44vw] w-[44vw] rounded-full bg-[#f9cbb8] opacity-60 blur-[100px] will-change-transform animate-drift-c motion-reduce:animate-none" />
    </div>
  );
}

function Grain() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 opacity-[0.05]"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
      }}
    />
  );
}

function CtaLink({ href, children, tone = "primary", className }: { href: string; children: React.ReactNode; tone?: "primary" | "glass"; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-bold transition-[transform,box-shadow,background-color] duration-150 ease-out hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        tone === "primary"
          ? "bg-primary text-primary-foreground shadow-[0_10px_24px_-12px_rgb(15_163_154/0.7)] hover:bg-primary-deep hover:shadow-[0_14px_28px_-12px_rgb(15_163_154/0.75)]"
          : "border border-border bg-white/60 text-foreground backdrop-blur-md hover:bg-white/80 hover:shadow-[0_8px_24px_rgb(14_28_43/0.10)]",
        className,
      )}
    >
      {children}
    </Link>
  );
}

function Nav({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 bg-background/60 pt-[env(safe-area-inset-top)] backdrop-blur-[14px]">
      <div className="flex h-16 w-full px-[clamp(16px,5vw,72px)] items-center justify-between gap-4">
        <Link href="#top" aria-label="Splits home" className="inline-flex min-h-11 items-center rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <Logo />
        </Link>
        <nav aria-label="Sections" className="hidden items-center gap-7 text-[15px] font-semibold text-muted-foreground md:flex">
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="#try" className="hover:text-foreground">Try a split</a>
          <a href="#arc" className="hover:text-foreground">Built on Arc</a>
          <a href="#next" className="hover:text-foreground">Roadmap</a>
        </nav>
        <Link
          href={signedIn ? "/home" : "/signin"}
          className="inline-flex min-h-10 items-center rounded-full border border-border bg-white/60 px-5 text-[15px] font-bold text-foreground transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {signedIn ? "Home" : "Sign in"}
        </Link>
      </div>
    </header>
  );
}

/** The pinned scene: one card, then three panes, then three receipts. */
function Scene({ signedIn }: { signedIn: boolean }) {
  const sceneRef = React.useRef<HTMLElement>(null);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const wholeRef = React.useRef<HTMLDivElement>(null);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const statusRef = React.useRef<HTMLSpanElement>(null);
  const hintRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    const scene = sceneRef.current!, grid = gridRef.current!, whole = wholeRef.current!, frame = frameRef.current!;
    const status = statusRef.current!, hint = hintRef.current!;
    const panes = Array.from(grid.children) as HTMLElement[];
    const amounts = panes.map((p) => p.querySelector<HTMLElement>("[data-amt]")!);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stacked = window.matchMedia("(max-width: 640px)");
    const speeds = [0.9, 1, 1.1];
    let last = "", ticking = false;
    try {
      if (CSS.supports("backdrop-filter", "url(#water) blur(10px)")) grid.classList.add("has-water");
    } catch {}

    function render(p: number) {
      const stack = stacked.matches;
      const t = sm(0.08, 0.32, p), rv = sm(0.2, 0.36, p), ct = sm(0.45, 0.8, p), lv = sm(0.86, 0.95, p);
      const drift = sm(0.25, 0.55, p) - sm(0.65, 0.9, p), r = t * 24, o = 28;
      grid.style.gap = `${t * 16}px`;
      panes.forEach((el, i) => {
        el.style.borderRadius = stack
          ? i === 0 ? `${o}px ${o}px ${r}px ${r}px` : i === 2 ? `${r}px ${r}px ${o}px ${o}px` : `${r}px`
          : i === 0 ? `${o}px ${r}px ${r}px ${o}px` : i === 2 ? `${r}px ${o}px ${o}px ${r}px` : `${r}px`;
        const d = ((speeds[i] ?? 1) - 1) * drift * (stack ? 160 : 240);
        el.style.transform = stack ? `translateX(${d.toFixed(1)}px)` : `translateY(${d.toFixed(1)}px)`;
        el.style.setProperty("--rv", rv.toFixed(3));
        el.style.setProperty("--lv", lv.toFixed(3));
        el.style.setProperty("--bo", t.toFixed(3));
        const amount = amounts[i], pane = PANES[i];
        if (amount && pane) amount.textContent = usd(Math.round(pane.cents * ct));
      });
      // The single card's label and amount leave before the panes show theirs, so the two never overlap.
      whole.style.opacity = (1 - sm(0.1, 0.2, p)).toFixed(3);
      frame.style.opacity = (1 - sm(0.08, 0.2, p)).toFixed(3);
      hint.style.opacity = (1 - sm(0, 0.05, p)).toFixed(3);
      const s = p < 0.12 ? "One payment, ready to send" : p < 0.86 ? "Dividing it on Arc, in one transaction" : "Landed. Three people paid, three receipts.";
      if (s !== last) { status.textContent = s; last = s; }
    }
    function progress() {
      const rect = scene.getBoundingClientRect(), span = rect.height - window.innerHeight;
      return span > 0 ? Math.min(1, Math.max(0, -rect.top / span)) : 1;
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; render(reduced.matches ? 1 : progress()); });
    }
    render(reduced.matches ? 1 : progress());
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    stacked.addEventListener("change", onScroll);
    reduced.addEventListener("change", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      stacked.removeEventListener("change", onScroll);
      reduced.removeEventListener("change", onScroll);
    };
  }, []);

  return (
    <section ref={sceneRef} aria-labelledby="hero-title" className="relative h-[270vh] motion-reduce:h-auto">
      <div className="sticky top-0 flex h-svh min-h-[560px] flex-col justify-center gap-[clamp(16px,3vh,32px)] pt-[72px] pb-4 motion-reduce:static motion-reduce:h-auto motion-reduce:min-h-0 motion-reduce:py-24">
        <div className="mx-auto w-[min(1120px,calc(100%-2rem))]">
          <div className="flex max-w-[1000px] flex-col gap-[clamp(10px,2vh,16px)]">
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-accent px-3 py-1 text-[13px] font-bold text-primary-deep">
              <span className="h-2 w-2 rounded-full bg-primary" /> Live on Arc mainnet
            </span>
            <h1 id="hero-title" className="text-[clamp(2.25rem,min(6.2vw,8.5vh),4rem)] leading-[1.06] font-extrabold tracking-[-0.02em] text-balance">
              Send once. It lands divided.
            </h1>
            <p className="max-w-[56ch] text-[clamp(1rem,2vw,1.1875rem)] text-muted-foreground">
              One USDC payment on Arc, divided between everyone it is for: rent to the landlord, school fees to the school, upkeep to family. Each part lands with its purpose, in a single transaction, and the people you pay only need an email.
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <CtaLink href={signedIn ? "/home" : "/signin"}>
                Open Splits <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </CtaLink>
              <CtaLink href="/send" tone="glass" className="max-sm:hidden">
                Pay without an account
              </CtaLink>
            </div>
          </div>
        </div>

        <div className="mx-auto w-[min(1120px,calc(100%-2rem))]">
          <p className="sr-only">
            One payment of $450.00 in USDC splits into $225.00 for the landlord&apos;s rent, $135.00 for school fees and $90.00 for upkeep, in one transaction on Arc.
          </p>
          <div aria-hidden="true" className="w-[min(900px,100%)]">
            <div className="relative mt-5">
              <div ref={gridRef} className="grid grid-cols-3 max-sm:grid-cols-1">
                {PANES.map((p) => (
                  <div
                    key={p.who}
                    style={{ "--c": p.color, borderColor: "color-mix(in srgb, rgb(255 255 255 / 0.7) calc(var(--bo, 0) * 100%), transparent)" } as React.CSSProperties}
                    className="pane relative flex h-[clamp(170px,27vh,280px)] flex-col justify-between overflow-hidden border bg-white/60 p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.8),0_10px_36px_rgb(14_28_43/0.10)] backdrop-blur-[18px] backdrop-saturate-150 max-sm:h-[clamp(76px,11vh,96px)] max-sm:flex-row max-sm:items-center max-sm:gap-3 max-sm:px-[18px] max-sm:py-3.5"
                  >
                    <div className="absolute inset-x-0 top-0 h-1.5 bg-(--c)" style={{ opacity: "var(--rv, 0)" }} />
                    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(165deg,color-mix(in_srgb,var(--c)_24%,transparent),transparent_62%)]" style={{ opacity: "var(--rv, 0)" }} />
                    <div className="relative z-10 text-[17px] font-bold" style={{ opacity: "var(--rv, 0)" }}>
                      {p.who}
                      <small className="block text-sm font-medium text-muted-foreground max-sm:hidden">
                        {p.what} · {p.share}%
                      </small>
                    </div>
                    <div className="relative z-10" style={{ opacity: "var(--rv, 0)" }}>
                      <div data-amt className="text-[clamp(1.5rem,3.2vw,2.25rem)] leading-[1.1] font-extrabold tracking-[-0.02em] tabular-nums">
                        $0.00
                      </div>
                      <div className="mt-1.5 flex min-h-[1.3em] items-center gap-1.5 text-sm font-bold text-success max-sm:mt-0.5" style={{ opacity: "var(--lv, 0)" }}>
                        <Check aria-hidden="true" className="h-4 w-4" /> Landed · receipt
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div ref={frameRef} className="pointer-events-none absolute inset-0 rounded-[28px] border border-white/70 bg-white/80 shadow-[inset_0_1px_0_rgb(255_255_255/0.8),0_10px_36px_rgb(14_28_43/0.10)] backdrop-blur-[18px]" />
              <div ref={wholeRef} className="pointer-events-none absolute inset-0 flex flex-col items-start justify-between px-7 py-6 max-sm:px-[18px] max-sm:py-3.5">
                <div className="font-bold text-muted-foreground">Monthly support home</div>
                <div className="text-[clamp(2rem,6vw,3.5rem)] leading-[1.05] font-extrabold tracking-[-0.03em] tabular-nums max-sm:text-[2rem]">
                  $450.00
                  <span className="block text-[0.5em] font-bold tracking-[-0.01em] text-muted-foreground">USDC, sent once</span>
                </div>
              </div>
            </div>
            <div className="mt-4 flex min-h-[1.6em] justify-between gap-4 text-[15px] font-medium text-muted-foreground">
              <span ref={statusRef}>One payment, ready to send</span>
              <span ref={hintRef} className="transition-opacity duration-200 motion-reduce:hidden">
                Scroll to send
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Section({ id, children, className }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-20 py-[clamp(64px,10vw,120px)]", className)}>
      <div className="mx-auto w-[min(1120px,calc(100%-2rem))]">{children}</div>
    </section>
  );
}
const H2 = ({ children }: { children: React.ReactNode }) => (
  <h2 className="max-w-[22ch] text-[clamp(1.75rem,4vw,2.5rem)] leading-[1.08] font-extrabold tracking-[-0.02em] text-balance">{children}</h2>
);
const Lede = ({ children }: { children: React.ReactNode }) => <p className="mt-4 max-w-[58ch] text-[17px] text-muted-foreground">{children}</p>;

const STEPS = [
  { title: "Add USDC", body: "Hold it in your Splits balance, pay from your own wallet, or send it from Base, Arbitrum or Optimism. It moves to Arc by itself." },
  { title: "Say who, and what for", body: "An email or Arc address, an amount or a share, and a purpose for each part. Or paste a messy list and let Splits fill it in." },
  { title: "Approve once", body: "With your PIN, Face ID or fingerprint, or in your own wallet. You see each part, the fee and the total first." },
  { title: "It lands divided", body: "One transaction on Arc pays everyone, or nobody. Each person gets a receipt for their part." },
];

/** "Try a split": three shares of one amount, worked out the way the app does it. */
function Calculator() {
  const [amount, setAmount] = React.useState("400");
  const [a, setA] = React.useState(50);
  const [b, setB] = React.useState(30);
  const c = 100 - a - b;
  const value = Number.parseFloat(amount);
  const ok = Number.isFinite(value) && value >= 1 && value <= LIMIT;
  const total = ok ? Math.round(value * 100) : 0;
  // Each share is rounded down to the cent; the last share takes whatever cents are left.
  const pa = Math.floor((total * a) / 100), pb = Math.floor((total * b) / 100), pc = total - pa - pb;
  const fee = Math.round(total * 0.015);
  const rows = [
    { name: "Landlord", what: "Rent", pct: a, cents: pa, color: "var(--purpose-1)" },
    { name: "School", what: "School fees", pct: b, cents: pb, color: "var(--purpose-2)" },
    { name: "Mum", what: "Upkeep", pct: c, cents: pc, color: "var(--purpose-3)" },
  ];
  const error = !Number.isFinite(value) || value < 1 ? "Enter at least $1." : value > LIMIT ? `Splits sends up to ${LIMIT} USDC per payment for now.` : "";

  return (
    <div className={cn(glass, "flex min-w-0 flex-col gap-5 rounded-3xl p-[clamp(18px,3vw,28px)]")}>
      <div>
        <label htmlFor="try-amount" className="text-[15px] font-bold">You send</label>
        <div className="mt-2 flex items-center gap-2 rounded-2xl border border-input bg-background/70 px-4 focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-ring">
          <span aria-hidden="true" className="text-2xl font-extrabold text-muted-foreground">$</span>
          <input
            id="try-amount"
            type="number"
            inputMode="decimal"
            min={1}
            max={LIMIT}
            step={10}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="min-w-0 flex-1 bg-transparent py-3.5 text-[28px] leading-none font-extrabold tabular-nums outline-none"
          />
          <span className="text-sm font-bold text-muted-foreground">USDC</span>
        </div>
        <p role="status" className="mt-1.5 min-h-[1.2em] text-sm font-medium text-destructive">{error}</p>
      </div>
      {rows.map((r, i) => (
        <div key={r.name} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5" style={{ "--c": r.color } as React.CSSProperties}>
          <span className="h-3 w-3 rounded-full bg-(--c)" />
          {i < 2 ? (
            <label htmlFor={`try-${i}`} className="font-bold">
              {r.name} <span className="font-medium text-muted-foreground">· {r.what} · {r.pct}%</span>
            </label>
          ) : (
            <span className="font-bold">
              {r.name} <span className="font-medium text-muted-foreground">· {r.what} · {r.pct}%</span>
            </span>
          )}
          <span className="text-right font-extrabold tabular-nums">{usd(r.cents)}</span>
          {i === 0 && (
            <input id="try-0" type="range" min={0} max={100} value={a} onChange={(e) => { const v = +e.target.value; setA(v); if (b > 100 - v) setB(100 - v); }} className="col-span-3 h-7 w-full accent-primary" />
          )}
          {i === 1 && (
            <input id="try-1" type="range" min={0} max={100 - a} value={b} onChange={(e) => setB(+e.target.value)} className="col-span-3 h-7 w-full accent-primary" />
          )}
        </div>
      ))}
      <div aria-hidden="true" className="flex h-3 gap-1">
        {rows.map((r) => (
          <i key={r.name} className="block h-full min-w-0 rounded-md transition-[flex-grow] duration-150 motion-reduce:transition-none" style={{ background: r.color, flexGrow: r.pct }} />
        ))}
      </div>
      <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-3.5 font-bold">
        <span>Splits fee {ok ? usd(fee) : "–"}</span>
        <span>You pay {ok ? usd(total + fee) : "–"}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        The fee is 1.5% (2% from 10 people), shown exactly before you approve. Shares are rounded down to the cent and the last share takes what is left, so nobody is paid a fraction of a cent.
      </p>
    </div>
  );
}

const WAYS = [
  { title: "Pay without an account", body: "Open mysplits.xyz/send and pay from your own wallet. Keep a private link to follow the payment." },
  { title: "Describe it, Splits fills it in", body: "Paste a messy note or drop in up to three screenshots. Splits drafts the list; you check every line before anything moves." },
  { title: "Their email is the wallet", body: "People you pay sign in with a code sent to their email. No app to install, no seed phrase, no password." },
  { title: "A receipt for everyone", body: "Each person sees their part and what it was for, checked against the Arc transaction before it says Landed." },
];

const ARC = [
  { title: "Fees in USDC", body: "Gas on Arc is paid in USDC, so costs are small and in dollars. Paying ten people costs about a cent." },
  { title: "Final when it lands", body: "A payment is final once it is included. Senders see Landed seconds after they approve." },
  { title: "A contract, not a promise", body: "Dividing one payment between many people, each part with its purpose, is contract logic on Arc." },
];

const NEXT = [
  { title: "Pay by card or bank", body: "Card, Apple Pay, Google Pay or bank transfer through Circle's onramp, landing as USDC ready to split.", color: "var(--purpose-1)" },
  { title: "Cash out at home", body: "Turn a part into naira in a bank account or mobile money in Nigeria, through a licensed payout partner.", color: "var(--purpose-2)" },
  { title: "An earning pocket", body: "Optional yield on money you leave in Splits, with Arc Earn Kit. Off by default.", color: "var(--purpose-3)" },
  { title: "Splits for developers and agents", body: "A developer API and an MCP server, so fintech apps and AI agents can send divided payments too.", color: "var(--purpose-5)" },
];

export function Landing({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <div id="top" className="landing min-h-screen overflow-x-clip text-foreground">
      <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
        <filter id="water" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves={2} seed={4} result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale={18} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <Haze />
      <Grain />
      <Nav signedIn={signedIn} />

      <main>
        <Scene signedIn={signedIn} />

        <Section id="how">
          <H2>From your balance to everyone&apos;s, in one pass</H2>
          <Lede>Splits checks the list before anything moves, then pays every part in the same transaction on Arc.</Lede>
          <ol className="mt-12 grid grid-cols-4 gap-4 max-[860px]:grid-cols-2 max-sm:grid-cols-1">
            {STEPS.map((s, i) => (
              <li key={s.title} className={cn(glass, "flex min-w-0 flex-col gap-2.5 rounded-3xl p-[22px]")}>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-[15px] font-extrabold text-primary-foreground">{i + 1}</span>
                <h3 className="text-[19px] font-extrabold tracking-[-0.01em]">{s.title}</h3>
                <p className="text-[15px] text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="try">
          <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center gap-[clamp(24px,5vw,72px)] max-[860px]:grid-cols-1">
            <div>
              <H2>Try a split</H2>
              <Lede>Move the sliders. The last share takes whatever is left, so the parts always add up to what you send.</Lede>
            </div>
            <Calculator />
          </div>
        </Section>

        <Section>
          <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-center gap-[clamp(24px,5vw,72px)] max-[860px]:grid-cols-1">
            <div aria-label="Example of an automatic split" className={cn(glass, "order-1 flex flex-col gap-4 rounded-3xl p-[clamp(18px,3vw,28px)] max-[860px]:order-2")}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="font-semibold">Money received</span>
                <b className="text-[32px] font-extrabold tracking-[-0.02em] tabular-nums">$200.00</b>
              </div>
              <div aria-hidden="true" className="flex h-3 gap-1">
                <i className="block h-full rounded-md bg-purpose-1" style={{ flexGrow: 30 }} />
                <i className="block h-full rounded-md bg-purpose-2" style={{ flexGrow: 70 }} />
              </div>
              <ul className="flex flex-col gap-2.5">
                <li className="grid grid-cols-[auto_1fr_auto] items-center gap-3"><span className="h-3 w-3 rounded-full bg-purpose-1" /><span>Savings · 30%</span><b className="tabular-nums">$60.00</b></li>
                <li className="grid grid-cols-[auto_1fr_auto] items-center gap-3"><span className="h-3 w-3 rounded-full bg-purpose-2" /><span>Spending · 70%</span><b className="tabular-nums">$140.00</b></li>
              </ul>
              <p className="text-sm text-muted-foreground">Your rule divided it the moment it arrived.</p>
            </div>
            <div className="order-2 max-[860px]:order-1">
              <H2>Money you receive can divide itself</H2>
              <Lede>Set a rule once, like 30% of everything into savings. It runs by itself whenever money arrives, deposits from other chains included.</Lede>
            </div>
          </div>
        </Section>

        <Section>
          <H2>More than one way to pay</H2>
          <div className="mt-12 grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            {WAYS.map((w) => (
              <div key={w.title} className={cn(glass, "min-w-0 rounded-3xl p-6")}>
                <h3 className="text-[19px] font-extrabold tracking-[-0.01em]">{w.title}</h3>
                <p className="mt-2 text-[15px] text-muted-foreground">{w.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="arc">
          <H2>Built on Arc</H2>
          <Lede>Arc is Circle&apos;s network with USDC as its gas. These are the parts that matter for divided payments.</Lede>
          <div className="mt-12 grid grid-cols-3 gap-4 max-[860px]:grid-cols-1">
            {ARC.map((x) => (
              <div key={x.title} className={cn(glass, "min-w-0 rounded-3xl p-6")}>
                <h3 className="text-[19px] font-extrabold tracking-[-0.01em]">{x.title}</h3>
                <p className="mt-2 text-[15px] text-muted-foreground">{x.body}</p>
              </div>
            ))}
          </div>
          <div className={cn(glass, "mt-4 flex flex-wrap items-center justify-between gap-4 rounded-3xl p-6")}>
            <p className="max-w-[62ch] text-[15px] text-muted-foreground">
              <b className="text-foreground">The contract never holds money.</b> USDC goes straight from the payer to each person. It has no owner and no admin key, and it is verified on Sourcify and the Arc explorer.
            </p>
            <a href={EXPLORER} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[15px] font-bold text-primary-deep underline-offset-4 hover:underline">
              See the contract <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </a>
          </div>
        </Section>

        <Section id="next">
          <H2>What comes next</H2>
          <Lede>Splits today is a working proof of concept on mainnet. These are planned, not live yet.</Lede>
          <div className="mt-12 grid grid-cols-4 gap-4 max-[1000px]:grid-cols-2 max-sm:grid-cols-1">
            {NEXT.map((n, i) => (
              <div key={n.title} className="min-w-0 rounded-3xl border border-border bg-card p-6" style={{ "--c": n.color } as React.CSSProperties}>
                <div className="flex items-baseline justify-between gap-3 border-b border-border pb-4">
                  <span className="text-[28px] leading-none font-extrabold tracking-[-0.02em] text-(--c) tabular-nums">0{i + 1}</span>
                  <span className="text-[12px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Planned</span>
                </div>
                <h3 className="mt-4 text-[19px] font-extrabold tracking-[-0.01em]">{n.title}</h3>
                <p className="mt-2 text-[15px] text-muted-foreground">{n.body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section>
          <div className={cn(glass, "grid grid-cols-2 items-center gap-[clamp(20px,4vw,48px)] rounded-[28px] p-[clamp(24px,5vw,56px)] max-[860px]:grid-cols-1")}>
            <div>
              <H2>Send your first split</H2>
              <Lede>Live on Arc mainnet. Up to {LIMIT} USDC per payment while identity verification is built.</Lede>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <CtaLink href={signedIn ? "/home" : "/signin"}>
                Open Splits <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </CtaLink>
              <CtaLink href="/send" tone="glass">
                Pay without an account
              </CtaLink>
            </div>
          </div>
        </Section>
      </main>

      <footer className="pt-10 pb-14 text-sm text-muted-foreground">
        <div className="flex w-full px-[clamp(16px,5vw,72px)] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Logo className="h-6" />
            <span>Send once. It lands divided.</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-5 font-semibold">
            <Link href="/about" className="hover:text-foreground">About</Link>
            <a href={EXPLORER} target="_blank" rel="noreferrer" className="hover:text-foreground">Contract</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
