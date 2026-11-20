import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // The relay library is shipped as TypeScript source from the workspace.
  transpilePackages: ["@honorcat/relay"],
  // The group pots switch (GROUPS=on) also decides whether the menu shows Groups.
  env: { NEXT_PUBLIC_GROUPS: process.env.GROUPS ?? "", NEXT_PUBLIC_SOCIAL: process.env.SOCIAL ?? "", NEXT_PUBLIC_APP_INSTALL: process.env.APP_INSTALL ?? "" },
  // The service worker must never be cached, so an installed app always gets the newest one.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
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
