import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeCandidates } from "./node-manager.ts";

describe("nodeCandidates (darwin)", () => {
  it("includes brew and common user paths", () => {
    const paths = nodeCandidates("darwin", "/Users/me");
    expect(paths).toContain("/opt/homebrew/bin/node");
    expect(paths).toContain("/usr/local/bin/node");
    expect(paths).toContain("/Users/me/.volta/bin/node");
  });
});

describe("nodeCandidates (win32)", () => {
  it("includes Program Files and local app data", () => {
    const paths = nodeCandidates("win32", "C:\\Users\\me");
    expect(paths).toContain("C:\\Program Files\\nodejs\\node.exe");
    expect(paths).toContain(
      "C:\\Users\\me\\AppData\\Local\\Programs\\nodejs\\node.exe",
    );
    expect(paths).toContain("C:\\Users\\me\\.volta\\bin\\node.exe");
  });
});

describe("nodeCandidates nvm enumeration", () => {
  it("lists installed nvm versions sorted by version", () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-nvm-"));
    const versionsRoot = join(home, ".nvm", "versions", "node");
    mkdirSync(join(versionsRoot, "v18.20.4", "bin"), { recursive: true });
    mkdirSync(join(versionsRoot, "v22.14.0", "bin"), { recursive: true });
    writeFileSync(join(versionsRoot, "v22.14.0", "bin", "node"), "");
    writeFileSync(join(versionsRoot, "v18.20.4", "bin", "node"), "");

    const paths = nodeCandidates("darwin", home);
    expect(paths[0]).toBe(join(versionsRoot, "v22.14.0", "bin", "node"));
    expect(paths[1]).toBe(join(versionsRoot, "v18.20.4", "bin", "node"));
    rmSync(home, { recursive: true, force: true });
  });

  it("tolerates a missing nvm dir", () => {
    const home = mkdtempSync(join(tmpdir(), "dsh-nvm-miss-"));
    const paths = nodeCandidates("darwin", home);
    expect(paths.some((p) => p.includes(".nvm"))).toBe(false);
    rmSync(home, { recursive: true, force: true });
  });
});
