import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { defineConfig } from "vitest/config";

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    root: configDir,
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
