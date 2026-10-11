import path from "node:path";
import type { NextConfig } from "next";

const X402_ABSENT = "./src/lib/wallet/x402-absent.ts";
const X402_MODULES = ["@x402/core/client", "@x402/evm", "@x402/evm/exact/client", "@x402/evm/upto/client", "@x402/svm/exact/client"];

const config: NextConfig = {
  // PGlite ships WASM and the Circle SDK uses Node crypto; keep both out of the bundler.
  serverExternalPackages: ["@electric-sql/pglite", "@circle-fin/developer-controlled-wallets"],
  poweredByHeader: false,
  turbopack: {
    // Optional peers of @coinbase/cdp-sdk (pulled in by wagmi's Base Account connector), loaded only
    // for x402 payments, which Splits never makes. See src/lib/wallet/x402-absent.ts.
    resolveAlias: Object.fromEntries(X402_MODULES.map((name) => [name, X402_ABSENT])),
  },
  // The same stand-in when building with webpack (`next build --webpack`).
  webpack: (webpackConfig) => {
    webpackConfig.resolve ??= {};
    webpackConfig.resolve.alias = {
      ...webpackConfig.resolve.alias,
      // `$` makes each an exact match, so "@x402/evm" doesn't also swallow "@x402/evm/exact/client".
      ...Object.fromEntries(X402_MODULES.map((name) => [`${name}$`, path.resolve(X402_ABSENT)])),
    };
    return webpackConfig;
  },
};

export default config;
