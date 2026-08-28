import { describe, expect, it } from "vitest";
import {
  checksumFor,
  nodeArchiveSpec,
  nodeDownloadUrl,
  nodeMajor,
  parseNodeVersion,
  resolveNpmCli,
} from "./node-manager.ts";
import type { NodeVersionsConfig } from "./node-manager.ts";

describe("parseNodeVersion", () => {
  it("normalizes a bare version output", () => {
    expect(parseNodeVersion("v24.15.0\n")).toBe("v24.15.0");
  });
  it("rejects garbage", () => {
    expect(parseNodeVersion("not a version")).toBeUndefined();
    expect(parseNodeVersion("")).toBeUndefined();
  });
});

describe("nodeMajor", () => {
  it("extracts the major", () => {
    expect(nodeMajor("v24.15.0")).toBe(24);
  });
  it("returns undefined for invalid", () => {
    expect(nodeMajor("garbage")).toBeUndefined();
  });
});

describe("nodeArchiveSpec", () => {
  it("maps darwin arm64 to tar.gz", () => {
    expect(nodeArchiveSpec("24.15.0", "darwin", "arm64")).toEqual({
      fileName: "node-v24.15.0-darwin-arm64.tar.gz",
      ext: "tar.gz",
    });
  });
  it("maps win32 x64 to zip", () => {
    expect(nodeArchiveSpec("24.15.0", "win32", "x64")).toEqual({
      fileName: "node-v24.15.0-win-x64.zip",
      ext: "zip",
    });
  });
  it("throws for unsupported platforms", () => {
    expect(() => nodeArchiveSpec("24.15.0", "freebsd", "x64")).toThrow();
  });
});

describe("nodeDownloadUrl", () => {
  it("builds the npmmirror URL", () => {
    const config: NodeVersionsConfig = {
      version: "24.15.0",
      minSystemNode: 18,
      mirrorBase: "https://registry.npmmirror.com/-/binary/node",
      checksums: {},
    };
    expect(nodeDownloadUrl(config, "darwin", "arm64")).toBe(
      "https://registry.npmmirror.com/-/binary/node/v24.15.0/node-v24.15.0-darwin-arm64.tar.gz",
    );
  });
});

describe("checksumFor", () => {
  it("returns the matching checksum", () => {
    const config: NodeVersionsConfig = {
      version: "24.15.0",
      minSystemNode: 18,
      mirrorBase: "x",
      checksums: { "darwin-arm64": "abc123" },
    };
    expect(checksumFor(config, "darwin", "arm64")).toBe("abc123");
  });
  it("throws when the platform has no checksum", () => {
    const config: NodeVersionsConfig = {
      version: "24.15.0",
      minSystemNode: 18,
      mirrorBase: "x",
      checksums: {},
    };
    expect(() => checksumFor(config, "darwin", "arm64")).toThrow();
  });
});

describe("resolveNpmCli", () => {
  it("resolves posix npm-cli path", () => {
    expect(resolveNpmCli("/usr/local/bin/node", "darwin")).toBe(
      "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
    );
  });
  it("resolves windows npm-cli path", () => {
    expect(resolveNpmCli("C:\\node\\node.exe", "win32")).toBe(
      "C:\\node\\node_modules\\npm\\bin\\npm-cli.js",
    );
  });
});
