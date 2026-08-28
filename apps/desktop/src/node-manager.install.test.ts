import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractArchive, managedDshEntry } from "./node-manager.ts";

describe("extractArchive (posix only)", () => {
  it.runIf(process.platform !== "win32")("extracts a tar.gz", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-ext-"));
    const payload = Buffer.from("payload-data");
    writeFileSync(join(dir, "inner.txt"), payload);
    execSync(`tar -czf "${join(dir, "a.tar.gz")}" -C "${dir}" inner.txt`);
    const out = mkdtempSync(join(tmpdir(), "dsh-ext-out-"));
    await extractArchive(
      join(dir, "a.tar.gz"),
      out,
      process.platform as NodeJS.Platform,
    );
    expect(readFileSync(join(out, "inner.txt"))).toEqual(payload);
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });
});

describe("managedDshEntry", () => {
  it("points into the managed dsh dir", () => {
    expect(managedDshEntry("/tmp/ud")).toBe(
      "/tmp/ud/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js",
    );
  });
});
