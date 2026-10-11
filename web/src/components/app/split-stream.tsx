"use client";

import { motion, useReducedMotion } from "motion/react";
import { INDIGO, purposeFill } from "@/lib/palette";

/**
 * The product's one signature graphic: a single indigo stream that divides into a coloured branch
 * per purpose. On the payment screen it follows real server state, never a timer:
 *
 *   idle      faint outline only
 *   trunk     the payment is being funded and approved: the trunk is drawn
 *   branches  paying out on Arc: the branches draw
 *   done      delivered: each recipient's node fills, one after another
 *   failed    the trunk stops and greys out; no branch is drawn
 */
export type StreamStage = "idle" | "trunk" | "branches" | "done" | "failed";

export type StreamBranch = { label: string; weight: number };

const W = 520;
const H = 240;
const FORK_X = 190;
const END_X = 380;

export function SplitStream({
  branches,
  stage,
  className,
  showLabels = true,
  intro = false,
}: {
  branches: StreamBranch[];
  stage: StreamStage;
  className?: string;
  showLabels?: boolean;
  /** Plays the whole draw once on mount (the sign-in hero). */
  intro?: boolean;
}) {
  const reduce = useReducedMotion();
  const total = branches.reduce((s, b) => s + Math.max(0, b.weight), 0) || 1;
  const midY = H / 2;
  const spread = Math.min(H - 50, 54 * Math.max(1, branches.length - 1));
  const ys = branches.map((_, i) => (branches.length === 1 ? midY : midY - spread / 2 + (spread / (branches.length - 1)) * i));

  const trunkOn = stage !== "idle";
  const branchesOn = stage === "branches" || stage === "done";
  const failed = stage === "failed";
  const t = (delay: number, duration: number) =>
    reduce ? { duration: 0 } : { delay: intro ? delay : 0, duration, ease: [0.65, 0, 0.35, 1] as const };

  const label = branches.map((b) => b.label).join(", ");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-label={`One payment splitting into ${branches.length} parts: ${label}`}
    >
      {/* Faint outline so the shape reads before anything moves. */}
      <path d={`M 24 ${midY} L ${FORK_X} ${midY}`} stroke="currentColor" strokeOpacity={0.08} strokeWidth={18} strokeLinecap="round" fill="none" />
      {ys.map((y, i) => (
        <path key={`g${i}`} d={branchPath(midY, y)} stroke="currentColor" strokeOpacity={0.08} strokeWidth={10} strokeLinecap="round" fill="none" />
      ))}

      <motion.path
        d={`M 24 ${midY} L ${FORK_X} ${midY}`}
        stroke={failed ? "#9da1b8" : INDIGO}
        strokeWidth={18}
        strokeLinecap="round"
        fill="none"
        initial={{ pathLength: intro ? 0 : trunkOn ? 1 : 0 }}
        animate={{ pathLength: trunkOn ? 1 : 0 }}
        transition={t(0.1, 0.6)}
      />
      {stage === "trunk" && !reduce && (
        <motion.circle
          r={5}
          cy={midY}
          fill="#ffffff"
          initial={{ cx: 40, opacity: 0 }}
          animate={{ cx: [40, FORK_X - 12], opacity: [0, 1, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        />
      )}

      {ys.map((y, i) => {
        const width = 6 + 10 * (Math.max(0, branches[i]!.weight) / total);
        return (
          <motion.path
            key={`b${i}`}
            d={branchPath(midY, y)}
            stroke={purposeFill(i)}
            strokeWidth={width}
            strokeLinecap="round"
            fill="none"
            initial={{ pathLength: intro ? 0 : branchesOn ? 1 : 0 }}
            animate={{ pathLength: branchesOn ? 1 : 0 }}
            transition={t(0.65 + i * 0.08, 0.7)}
          />
        );
      })}

      {ys.map((y, i) => {
        const filled = stage === "done";
        return (
          <g key={`n${i}`}>
            <motion.circle
              cx={END_X + 14}
              cy={y}
              r={11}
              stroke={purposeFill(i)}
              strokeWidth={3}
              initial={false}
              animate={{ fill: filled ? purposeFill(i) : "#ffffff", scale: filled && !reduce ? [1, 1.25, 1] : 1 }}
              transition={reduce ? { duration: 0 } : { delay: (intro ? 1.3 : 0.15) + i * 0.12, duration: 0.45 }}
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
            />
            {showLabels && (
              <text x={END_X + 32} y={y + 6} fontSize={18} fontWeight={600} fill="currentColor">
                {branches[i]!.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function branchPath(midY: number, y: number): string {
  return `M ${FORK_X} ${midY} C ${FORK_X + 80} ${midY}, ${END_X - 90} ${y}, ${END_X} ${y}`;
}
