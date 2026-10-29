import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A photo avatar, or initials when there is no photo. Splits recipients are people named by
 * email, so the app itself uses initials; photos are for demos. See UI_BRIEF.md.
 */
export type Avatar = { src: string; alt: string } | { initials: string; alt: string };

export interface PaymentSummaryCardProps {
  /** The main title of the card, e.g. "Payment Templates" */
  title: string;
  /** The figure to show. Pass a decimal string for money so no cent is lost to float maths. */
  amount: number | string;
  /** Currency symbol shown before the amount. Defaults to "$". */
  currency?: string;
  /** Title of the interactive panel */
  subCardTitle: string;
  /** Subtitle or description of the interactive panel */
  subCardSubtitle: string;
  /** Avatars shown in the stack */
  avatars: Avatar[];
  /** Number shown in the "+N" circle */
  moreCount?: number;
  /** Called when the panel is activated by click, Enter or Space */
  onSubCardClick?: () => void;
  className?: string;
}

/** Groups a decimal string's whole part with commas and keeps at least two decimals. */
export function formatAmount(amount: number | string): string {
  if (typeof amount === "number") {
    return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  const [whole = "0", fraction = ""] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${fraction.padEnd(2, "0")}`;
}

function AvatarCircle({ avatar, first }: { avatar: Avatar; first: boolean }) {
  const shared = "h-10 w-10 shrink-0 rounded-full border-2 border-background";
  const style = { marginLeft: first ? 0 : "-12px" };
  if ("src" in avatar) {
    return <img src={avatar.src} alt={avatar.alt} className={cn(shared, "object-cover")} style={style} />;
  }
  return (
    <span
      aria-hidden="true"
      title={avatar.alt}
      className={cn(shared, "flex items-center justify-center bg-foreground/10 text-xs font-semibold text-foreground")}
      style={style}
    >
      {avatar.initials.slice(0, 2).toUpperCase()}
    </span>
  );
}

/**
 * A financial summary with one interactive panel and the people it concerns.
 * Theme-adaptive through the shadcn CSS variables.
 */
export const PaymentSummaryCard = React.forwardRef<HTMLDivElement, PaymentSummaryCardProps>(
  (
    { title, amount, currency = "$", subCardTitle, subCardSubtitle, avatars, moreCount, onSubCardClick, className },
    ref,
  ) => {
    const people = avatars.length + (moreCount ?? 0);
    return (
      <div
        ref={ref}
        className={cn("w-full max-w-sm rounded-md bg-card p-6 text-card-foreground shadow-dialog", className)}
      >
        <h2 className="text-lg font-medium text-muted-foreground">{title}</h2>

        <p className="mt-2 text-5xl font-bold tracking-tight tabular-nums">
          {currency}
          {formatAmount(amount)}
        </p>

        <button
          type="button"
          onClick={onSubCardClick}
          aria-label={`${subCardTitle}, ${subCardSubtitle}, ${people} ${people === 1 ? "person" : "people"}`}
          className="group mt-8 block w-full cursor-pointer rounded-xl bg-muted/50 p-4 text-left transition-all duration-300 ease-in-out hover:bg-muted/80 hover:shadow-lift focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
        >
          <span className="flex items-start justify-between">
            <span>
              <span className="block font-semibold text-card-foreground">{subCardTitle}</span>
              <span className="block text-sm text-muted-foreground">{subCardSubtitle}</span>
            </span>
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-background transition-transform duration-300 group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100">
              <ArrowUpRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </span>
          </span>

          <span className="mt-4 flex items-center">
            {avatars.map((avatar, index) => (
              <AvatarCircle key={`${avatar.alt}-${index}`} avatar={avatar} first={index === 0} />
            ))}
            {moreCount !== undefined && moreCount > 0 && (
              <span
                aria-hidden="true"
                className="ml-[-12px] flex h-10 w-10 items-center justify-center rounded-full border-2 border-background bg-primary-fill text-sm font-semibold text-primary-foreground"
              >
                +{moreCount}
              </span>
            )}
          </span>
        </button>
      </div>
    );
  },
);

PaymentSummaryCard.displayName = "PaymentSummaryCard";
