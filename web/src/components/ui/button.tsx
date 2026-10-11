import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-muted text-foreground hover:bg-muted/70",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
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
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
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
