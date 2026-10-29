import path from "node:path";
import type { NextConfig } from "next";

const X402_ABSENT = "./src/lib/wallet/x402-absent.ts";
const X402_MODULES = ["@x402/core/client", "@x402/evm", "@x402/evm/exact/client", "@x402/evm/upto/client", "@x402/svm/exact/client"];

const config: NextConfig = {
  // PGlite ships WASM and the Circle SDKs (wallets, Earn Kit) use Node crypto; keep them out of the bundler.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@circle-fin/developer-controlled-wallets",
    "@circle-fin/earn-kit",
    "@circle-fin/adapter-circle-wallets",
  ],
  poweredByHeader: false,
  // A Split tag's page lives at /@ada. Folders starting with @ are route slots in the app router,
  // so the page itself is /t/[tag].
  async rewrites() {
    return [{ source: "/@:tag", destination: "/t/:tag" }];
  },
  // A money app is never framed by another site, never sniffed, and keeps receipt and payment
  // tokens in its URLs out of other sites' Referer. A full CSP waits on an audit of the wallet SDKs.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
  // The production image (web/Dockerfile) sets SPLITS_STANDALONE=1 to get a self-contained
  // .next/standalone server. Plain `next build` / `next start` and `next build --webpack` are unchanged.
  ...(process.env.SPLITS_STANDALONE === "1" ? { output: "standalone" as const } : {}),
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
