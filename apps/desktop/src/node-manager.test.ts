import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  checksumFor,
  downloadFile,
  dshRegistryLatestUrl,
  nodeArchiveSpec,
  nodeDownloadUrl,
  nodeMajor,
  parseLatestDshVersion,
  parseNodeVersion,
  resolveNpmCli,
  sha256File,
  shouldUpdateDsh,
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

let server: Server;
let baseUrl: string;
let payload: Buffer;

beforeAll(async () => {
  payload = Buffer.from("hello node download", "utf8");
  server = createServer((req, res) => {
    if (req.url === "/node.bin") {
      res.writeHead(200, { "content-length": String(payload.length) });
      res.end(payload);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

describe("downloadFile", () => {
  it("downloads bytes and reports progress", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-dl-"));
    const dest = join(dir, "node.bin");
    const events: number[] = [];
    await downloadFile(`${baseUrl}/node.bin`, dest, (p) => {
      events.push(p.receivedBytes);
    });
    expect(readFileSync(dest)).toEqual(payload);
    expect(events[events.length - 1]).toBe(payload.length);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("sha256File", () => {
  it("hashes a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-sha-"));
    const dest = join(dir, "node.bin");
    await downloadFile(`${baseUrl}/node.bin`, dest);
    const expected = createHash("sha256").update(payload).digest("hex");
    expect(await sha256File(dest)).toBe(expected);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("dshRegistryLatestUrl", () => {
  it("builds a latest-version URL and trims trailing slash", () => {
    expect(dshRegistryLatestUrl("https://registry.npmmirror.com")).toBe(
      "https://registry.npmmirror.com/@deepseek-ai%2Fdsh/latest",
    );
    expect(dshRegistryLatestUrl("https://registry.npmmirror.com/")).toBe(
      "https://registry.npmmirror.com/@deepseek-ai%2Fdsh/latest",
    );
  });
});

describe("parseLatestDshVersion", () => {
  it("parses a version from a registry latest body", () => {
    expect(parseLatestDshVersion('{"version":"0.1.2"}')).toBe("0.1.2");
  });
  it("returns undefined on malformed / missing version", () => {
    expect(parseLatestDshVersion("not json")).toBeUndefined();
    expect(parseLatestDshVersion("{}")).toBeUndefined();
    expect(parseLatestDshVersion('{"version":""}')).toBeUndefined();
  });
});

describe("shouldUpdateDsh", () => {
  it("updates when latest differs from installed", () => {
    expect(shouldUpdateDsh("0.1.1-rc.2", "0.1.2")).toBe(true);
    expect(shouldUpdateDsh(undefined, "0.1.2")).toBe(true);
  });
  it("does not update when already latest or latest unknown", () => {
    expect(shouldUpdateDsh("0.1.2", "0.1.2")).toBe(false);
    expect(shouldUpdateDsh("0.1.1-rc.2", undefined)).toBe(false);
  });
});
