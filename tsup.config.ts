import { defineConfig } from "tsup"

// A CLI ships no declarations. The core stays external so it is resolved from
// node_modules at runtime instead of being copied into the bundle.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  external: ["@kud/harness-fme"],
})
