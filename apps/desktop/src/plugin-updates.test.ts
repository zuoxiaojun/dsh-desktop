import { describe, expect, it } from "vitest";
import {
  chooseGithubCandidate,
  chooseRegistryCandidate,
  githubRepo,
  parsePluginSpec,
} from "./plugin-updates.ts";

/**
 * Specs below are copied from a real profile. A mis-parse silently removes the
 * update offer from a user whose only path back to a working app is that offer,
 * so every shape dsh users actually end up with is pinned here.
 */
describe("parsePluginSpec", () => {
  it("reads a pinned github commit", () => {
    const spec = parsePluginSpec(
      "dsh-obsidian",
      "github:mingzeng21/dsh-obsidian#72212e7db6908701381e10a7d0c116b00bd3364d",
    );
    expect(spec?.kind).toBe("github");
    if (spec?.kind !== "github") return;
    expect(githubRepo(spec)).toBe("mingzeng21/dsh-obsidian");
    expect(spec.ref).toBe("72212e7db6908701381e10a7d0c116b00bd3364d");
  });

  it("reads a release-tag pin and a floating branch", () => {
    expect(parsePluginSpec("x", "github:omdsh-dev/dsh-better-sidebar#v0.18.0")).toEqual({
      kind: "github",
      owner: "omdsh-dev",
      repo: "dsh-better-sidebar",
      ref: "v0.18.0",
    });
    expect(parsePluginSpec("x", "github:Rxiain/dsh-openviking")).toEqual({
      kind: "github",
      owner: "Rxiain",
      repo: "dsh-openviking",
    });
  });

  it("reads registry ranges, including dotted and scoped ones", () => {
    expect(parsePluginSpec("@anysearch/anysearch-dsh", "^0.1.4")).toEqual({
      kind: "registry",
      name: "@anysearch/anysearch-dsh",
      range: "^0.1.4",
    });
    expect(parsePluginSpec("@cocofhu/skillhub", "~0.2.16")?.kind).toBe("registry");
    expect(parsePluginSpec("plain-pkg", "1.2.3")?.kind).toBe("registry");
    expect(parsePluginSpec("plain-pkg", ">=1.0.0 <2.0.0")?.kind).toBe("registry");
    expect(parsePluginSpec("plain-pkg", "latest")?.kind).toBe("registry");
  });

  it("refuses specs that are not ours to rewrite", () => {
    expect(parsePluginSpec("my-local", "link:../plugin")).toBeUndefined();
    expect(parsePluginSpec("my-local", "file:/tmp/plugin")).toBeUndefined();
    expect(parsePluginSpec("my-local", "./checkout")).toBeUndefined();
    expect(parsePluginSpec("my-local", "https://example.com/x.tgz")).toBeUndefined();
  });
});

describe("chooseGithubCandidate", () => {
  const pinned = {
    kind: "github" as const,
    owner: "omdsh-dev",
    repo: "dsh-better-sidebar",
    ref: "50e05ecea0f2f4ba07775d47eed1fdb30831eec8",
  };

  it("prefers a release tag over a raw commit", () => {
    expect(
      chooseGithubCandidate(pinned, {
        latestTag: "v0.18.0",
        headSha: "2dc2dcf41815cb0cf930b30708564b300645d347",
      }),
    ).toEqual({
      candidateSpec: "github:omdsh-dev/dsh-better-sidebar#v0.18.0",
      label: "更新到 v0.18.0",
    });
  });

  it("falls back to the branch head when the repo ships no releases", () => {
    const c = chooseGithubCandidate(pinned, {
      headSha: "bac2c53cd889707183a1236e999dbc802b650f73",
    });
    expect(c?.candidateSpec).toContain("bac2c53c");
  });

  it("offers nothing when already at the newest revision", () => {
    expect(
      chooseGithubCandidate({ ...pinned, ref: "v0.18.0" }, { latestTag: "v0.18.0" }),
    ).toBeUndefined();
    expect(
      chooseGithubCandidate(
        { ...pinned, ref: "bac2c53cd889707183a1236e999dbc802b650f73" },
        { headSha: "bac2c53cd889707183a1236e999dbc802b650f73" },
      ),
    ).toBeUndefined();
  });

  it("always offers a re-resolve for a floating branch spec", () => {
    const c = chooseGithubCandidate({ kind: "github", owner: "Rxiain", repo: "p" }, {});
    expect(c?.candidateSpec).toBe("github:Rxiain/p");
  });
});

describe("chooseRegistryCandidate", () => {
  const spec = {
    kind: "registry" as const,
    name: "@anysearch/anysearch-dsh",
    range: "^0.1.4",
  };

  it("proposes the published latest", () => {
    expect(chooseRegistryCandidate(spec, "0.1.4", "0.1.9")).toEqual({
      candidateSpec: "@anysearch/anysearch-dsh@0.1.9",
      label: "更新到 v0.1.9",
    });
  });

  it("stays quiet when already current or when the lookup failed", () => {
    expect(chooseRegistryCandidate(spec, "0.1.9", "0.1.9")).toBeUndefined();
    expect(chooseRegistryCandidate(spec, "0.1.9", undefined)).toBeUndefined();
  });
});
