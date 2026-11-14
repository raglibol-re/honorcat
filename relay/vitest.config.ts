import { defineConfig } from "vitest/config";

// PGlite boots a full Postgres in WASM per test database; the first boot takes several seconds.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
