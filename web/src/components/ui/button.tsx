import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";

export type Variant = "primary" | "secondary" | "ghost" | "light" | "outlineLight" | "glass";

/** Pills (UI_BRIEF.md v4): one teal primary per screen, a teal outline for the secondary action. */
const variants: Record<Variant, string> = {
  primary: "bg-primary-fill text-primary-foreground hover:bg-primary-fill-hover shadow-pill",
  secondary: "bg-white/70 text-primary-text ring-1 ring-primary/70 hover:bg-white",
  ghost: "text-muted-foreground hover:bg-white/60 hover:text-foreground",
  /** On a dark or tinted fill. */
  light: "bg-white text-foreground hover:bg-white/90",
  /** A quieter action on a dark or tinted fill. */
  outlineLight: "text-white ring-1 ring-white/40 hover:bg-white/10",
  /** The quieter action on the landing glass. */
  glass: "border border-border bg-white/60 text-foreground backdrop-blur-md hover:bg-white/80 hover:shadow-lift",
};

export type Size = "lg" | "sm";

const sizes: Record<Size, string> = {
  /** The main pill: 52px. */
  lg: "min-h-[52px] px-6 text-ui",
  /** A pill in a row of other 44px controls. */
  sm: "min-h-11 px-4 text-sm",
};

/** The pill classes, for the few places that cannot be a Button or a ButtonLink. */
export function buttonClass({ variant = "primary", size = "lg", className }: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[transform,background-color,box-shadow] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100",
    sizes[size],
    variants[variant],
    className,
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and blocks clicks while work is in flight. */
  busy?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "lg", busy = false, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={buttonClass({ variant, size, className })}
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

export interface ButtonLinkProps extends Omit<React.ComponentProps<typeof Link>, "className"> {
  variant?: Variant;
  size?: Size;
  className?: string;
}

/** A link that looks like a Button: every pill that navigates is one of these. */
export function ButtonLink({ variant = "primary", size = "lg", className, ...props }: ButtonLinkProps) {
  return <Link className={buttonClass({ variant, size, className })} {...props} />;
}
