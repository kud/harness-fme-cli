import { defineConfig } from "tsup"

// A CLI ships no declarations. The core stays external so it is resolved from
// node_modules at runtime instead of being copied into the bundle. Splitting
// keeps the entry's `await import()` lazy, so it sets NODE_ENV before React
// (external, hence a hoisted static import) is first loaded.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: true,
  external: ["@kud/harness-fme"],
})
