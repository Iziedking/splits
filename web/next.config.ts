import type { NextConfig } from "next";

const config: NextConfig = {
  // PGlite ships WASM and the Circle SDK uses Node crypto; keep both out of the bundler.
  serverExternalPackages: ["@electric-sql/pglite", "@circle-fin/developer-controlled-wallets"],
  poweredByHeader: false,
  turbopack: {
    // Optional peers of @coinbase/cdp-sdk (pulled in by wagmi's Base Account connector), loaded only
    // for x402 payments, which Splits never makes. See src/lib/wallet/x402-absent.ts.
    resolveAlias: Object.fromEntries(
      ["@x402/core/client", "@x402/evm", "@x402/evm/exact/client", "@x402/evm/upto/client", "@x402/svm/exact/client"].map((name) => [
        name,
        "./src/lib/wallet/x402-absent.ts",
      ]),
    ),
  },
};

export default config;
