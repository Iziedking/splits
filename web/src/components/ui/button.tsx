import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "light" | "outlineLight";

/** Pills (UI_BRIEF.md v4): one teal primary per screen, a teal outline for the secondary action. */
const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-deep shadow-[0_10px_24px_-12px_rgb(15_163_154/0.7)]",
  secondary: "bg-white/70 text-primary ring-1 ring-primary/70 hover:bg-white",
  ghost: "text-muted-foreground hover:bg-white/60 hover:text-foreground",
  /** On a dark or tinted fill. */
  light: "bg-white text-foreground hover:bg-white/90",
  /** A quieter action on a dark or tinted fill. */
  outlineLight: "text-white ring-1 ring-white/40 hover:bg-white/10",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Shows a spinner and blocks clicks while work is in flight. */
  busy?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", busy = false, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold transition-[transform,background-color,box-shadow] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100",
        variants[variant],
        className,
      )}
      {...props}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      )}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
