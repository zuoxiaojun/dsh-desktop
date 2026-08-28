import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts", "src/preload.ts"],
  format: "esm",
  platform: "node",
  outDir: "lib",
  clean: true,
  bundle: false,
  external: ["electron", "electron-updater"],
});
