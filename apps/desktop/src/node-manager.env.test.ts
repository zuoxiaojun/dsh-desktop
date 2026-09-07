import { describe, expect, it } from "vitest";
import { withoutInheritedNpmConfig } from "./node-manager.ts";

describe("withoutInheritedNpmConfig", () => {
  it("drops ambient npm configuration and lifecycle metadata", () => {
    const clean = withoutInheritedNpmConfig({
      PATH: "/usr/bin",
      HOME: "/Users/u",
      npm_config_allow_scripts: "koffi,node-pty",
      npm_config_registry: "https://registry.npmjs.org",
      npm_config_prefix: "/Users/u/.npm-global",
      npm_lifecycle_event: "dev:desktop",
      NPM_CONFIG_DIR: "/tmp/x",
      NODE_OPTIONS: "--require /tmp/hook.cjs",
    });
    expect(clean).toEqual({ PATH: "/usr/bin", HOME: "/Users/u" });
  });

  it("keeps unrelated environment intact", () => {
    const clean = withoutInheritedNpmConfig({
      DSH_DESKTOP: "1",
      npm_config_cache: "/tmp/cache",
    });
    expect(clean).toEqual({ DSH_DESKTOP: "1" });
  });

  it("survives an empty environment", () => {
    expect(withoutInheritedNpmConfig({})).toEqual({});
  });
});
