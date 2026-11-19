import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The relay library is shipped as TypeScript source from the workspace.
  transpilePackages: ["@honorcat/relay"],
  // The group pots switch (GROUPS=on) also decides whether the menu shows Groups.
  env: { NEXT_PUBLIC_GROUPS: process.env.GROUPS ?? "" },
  // Native/WASM database drivers stay outside the server bundle.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
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
