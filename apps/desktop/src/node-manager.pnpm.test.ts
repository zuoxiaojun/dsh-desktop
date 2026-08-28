import { describe, expect, it } from "vitest";
import { parsePnpmProgress, parseInstallDetail } from "./node-manager.ts";

describe("parsePnpmProgress", () => {
  it("parses a completed progress line", () => {
    expect(
      parsePnpmProgress(
        "Progress: resolved 193, reused 60, downloaded 133, added 193, done in 45s",
      ),
    ).toEqual({ resolved: 193, downloaded: 133, added: 193 });
  });

  it("parses an in-flight progress line", () => {
    expect(
      parsePnpmProgress(
        "Progress: resolved 193, reused 60, downloaded 100, added 80",
      ),
    ).toEqual({ resolved: 193, downloaded: 100, added: 80 });
  });

  it("returns undefined for unrelated lines", () => {
    expect(
      parsePnpmProgress("npm warn deprecated node-domexception@1.0.0"),
    ).toBeUndefined();
    expect(parsePnpmProgress("added 193 packages")).toBeUndefined();
    expect(parsePnpmProgress("")).toBeUndefined();
  });
});

describe("parseInstallDetail", () => {
  it("builds a progress detail from parsed numbers", () => {
    expect(
      parseInstallDetail({ resolved: 193, downloaded: 100, added: 80 }),
    ).toContain("80");
  });

  it("falls back to download count when added is zero", () => {
    expect(
      parseInstallDetail({ resolved: 193, downloaded: 100, added: 0 }),
    ).toContain("100");
  });

  it("returns undefined when nothing is known yet", () => {
    expect(
      parseInstallDetail({ resolved: 0, downloaded: 0, added: 0 }),
    ).toBeUndefined();
  });
});
