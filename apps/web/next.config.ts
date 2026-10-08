import type { NextConfig } from "next";

const config: NextConfig = {
  // The engine package ships TypeScript source; LiteSVM is a native module that must not be bundled.
  transpilePackages: ["@ostira/core"],
  serverExternalPackages: ["litesvm"],
};

export default config;
