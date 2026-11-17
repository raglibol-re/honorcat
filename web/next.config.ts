import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The relay library is shipped as TypeScript source from the workspace.
  transpilePackages: ["@honorcat/relay"],
  // Native/WASM database drivers stay outside the server bundle.
  serverExternalPackages: ["pg", "@electric-sql/pglite", "@circle-fin/swap-kit"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
