"use client";

import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface SheetProps {
  open: boolean;
  /** Called whenever the dialog closes: the close button, Escape, or `open` turning false. */
  onClose: () => void;
  title: React.ReactNode;
  /** One line under the title; it also describes the dialog to screen readers. */
  description?: React.ReactNode;
  /** The id of content in `children` that describes the dialog, when there is no description line. */
  describedBy?: string;
  /** "sheet" rises from the bottom on a phone and sits in the middle from sm; "centre" always sits in the middle. */
  variant?: "sheet" | "centre";
  /** Focus this when the dialog opens instead of the title (the PIN field does this). */
  initialFocus?: React.RefObject<HTMLElement | null>;
  /** Controls beside the title, before Close. Keep them 44px tall. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

const variants = {
  sheet:
    "mx-auto mt-auto mb-0 w-full max-w-md rounded-t-2xl open:motion-safe:animate-[rise_300ms_cubic-bezier(0.22,1,0.36,1)] sm:my-auto sm:w-[calc(100%-2rem)] sm:rounded-2xl sm:open:motion-safe:animate-[pop_320ms_cubic-bezier(0.34,1.4,0.64,1)]",
  centre: "m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl open:motion-safe:animate-[pop_320ms_cubic-bezier(0.34,1.4,0.64,1)]",
};

/**
 * Every dialog in the app: a native <dialog> opened with showModal, so focus stays inside, Escape
 * closes it and focus goes back where it was. On open, focus lands on the title (or `initialFocus`)
 * rather than on the close button. Tapping the backdrop does nothing.
 */
export function Sheet({ open, onClose, title, description, describedBy, variant = "sheet", initialFocus, actions, children, className }: SheetProps) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const id = React.useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  React.useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      (initialFocus?.current ?? titleRef.current)?.focus();
    }
    if (!open && dialog.open) dialog.close();
    // initialFocus is a ref, read when the dialog opens.
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : describedBy}
      className={cn(
        "bg-card p-0 text-card-foreground shadow-dialog backdrop:bg-foreground/40 backdrop:backdrop-blur-[4px]",
        variants[variant],
      )}
    >
      <div className={cn("flex max-h-[85dvh] flex-col overflow-y-auto p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]", className)}>
        <div className="flex items-center gap-2">
          <h2 ref={titleRef} id={titleId} tabIndex={-1} className="min-w-0 flex-1 text-2xl font-bold focus:outline-none">
            {title}
          </h2>
          {actions}
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="-my-1.5 -mr-3 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        {description && (
          <p id={descriptionId} className="mt-1 text-sm text-muted-foreground">
            {description}
          </p>
        )}
        {children}
      </div>
    </dialog>
  );
}
