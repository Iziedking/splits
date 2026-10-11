import type { NextConfig } from "next";

const config: NextConfig = {
  // PGlite ships WASM and the Circle SDK uses Node crypto; keep both out of the bundler.
  serverExternalPackages: ["@electric-sql/pglite", "@circle-fin/developer-controlled-wallets"],
  poweredByHeader: false,
};

export default config;
