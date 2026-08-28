import { describe, expect, it } from "vitest";
import {
  detectSystemNode,
  locateNodeExecutable,
  parseNodeVersion,
  runNodeVersion,
} from "./node-manager.ts";

describe("locateNodeExecutable", () => {
  it("finds node on PATH when present", async () => {
    const exe = await locateNodeExecutable(process.platform);
    if (process.env.PATH?.includes("node") === false && exe === undefined) {
      // 无 node 环境则跳过（CI/受管环境下不要求）
      return;
    }
    expect(exe).toBeTruthy();
  });
});

describe("runNodeVersion", () => {
  it("returns a parseable version", async () => {
    const exe = await locateNodeExecutable(process.platform);
    if (exe === undefined) return;
    const v = await runNodeVersion(exe);
    expect(parseNodeVersion(v ?? "")).toBeTruthy();
  });
});

describe("detectSystemNode", () => {
  it("detects a usable node or undefined", async () => {
    const info = await detectSystemNode(process.platform, 18);
    if (info === undefined) return;
    expect(info.executable).toBeTruthy();
    expect(info.managed).toBe(false);
    expect(Number(info.version.slice(1).split(".")[0])).toBeGreaterThanOrEqual(
      18,
    );
  });
});
