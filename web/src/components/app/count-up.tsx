"use client";

import { animate, useReducedMotion } from "motion/react";
import * as React from "react";
import { formatAmount } from "@/components/ui/card-3";

/**
 * Shows a USDC amount and counts to a new value when it changes. The in-between frames are only
 * for the eye; the final text is always the exact string passed in.
 */
export function CountUp({ value, prefix = "$" }: { value: string; prefix?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = React.useState(value);
  const previous = React.useRef(value);

  React.useEffect(() => {
    const from = Number(previous.current.replace(/,/g, ""));
    const to = Number(value.replace(/,/g, ""));
    previous.current = value;
    if (reduce || !Number.isFinite(from) || !Number.isFinite(to) || from === to) {
      setShown(value);
      return;
    }
    const decimals = Math.max(2, value.split(".")[1]?.length ?? 0);
    const controls = animate(from, to, {
      duration: 0.6,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => setShown(v.toFixed(decimals)),
      onComplete: () => setShown(value),
    });
    return () => controls.stop();
  }, [value, reduce]);

  return (
    <span>
      <span aria-hidden="true">
        {prefix}
        {formatAmount(shown)}
      </span>
      <span className="sr-only">
        {prefix}
        {formatAmount(value)}
      </span>
    </span>
  );
}
