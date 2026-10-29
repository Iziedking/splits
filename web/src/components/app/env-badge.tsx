const explain = {
  preview: "Money on this server is simulated",
  testnet: "Arc Testnet USDC has no value",
};

/**
 * The badge on any page whose money is not real, so nobody mistakes a test for mainnet. The reason is
 * read out with the badge, since a tooltip never reaches touch or keyboard.
 */
export function EnvBadge({ mode }: { mode: "preview" | "testnet" }) {
  return (
    <span className="rounded-full bg-purpose-4 px-3 py-1 text-xs font-bold text-foreground">
      {mode === "preview" ? "Preview" : "Testnet"}
      <span className="sr-only">. {explain[mode]}.</span>
    </span>
  );
}
