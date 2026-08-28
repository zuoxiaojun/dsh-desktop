import { describe, expect, it } from "vitest";
import { hostPathFor } from "./node-manager.ts";
import type { NodeInfo } from "./node-manager.ts";

const NODE: NodeInfo = {
  executable: "/opt/homebrew/bin/node",
  version: "v26.7.0",
  managed: false,
  npmCli: "/opt/homebrew/lib/node_modules/npm/bin/npm-cli.js",
};

describe("hostPathFor", () => {
  it("prepends managed pnpm bin and node bin before system paths", () => {
    const path = hostPathFor(
      NODE,
      "/tmp/ud/tools/pnpm/node_modules/.bin",
      "darwin",
      { PATH: "/custom/bin" },
    );
    const parts = path.split(":");
    expect(parts[0]).toBe("/tmp/ud/tools/pnpm/node_modules/.bin");
    expect(parts[1]).toBe("/opt/homebrew/bin");
    expect(parts).toContain("/usr/bin");
    expect(parts).toContain("/custom/bin");
  });

  it("falls back to node bin when pnpm is not bootstrapped", () => {
    const path = hostPathFor(NODE, undefined, "darwin", {
      PATH: "/custom/bin",
    });
    expect(path.split(":")[0]).toBe("/opt/homebrew/bin");
    expect(path.split(":")).toContain("/custom/bin");
  });

  it("uses semicolons on win32", () => {
    const path = hostPathFor(
      NODE,
      "C:\\ud\\tools\\pnpm\\node_modules\\.bin",
      "win32",
      { PATH: "C:\\custom\\bin" },
    );
    expect(path).toContain(";");
    expect(path.split(";")).toContain("C:\\custom\\bin");
  });
});
