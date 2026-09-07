import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyHostFailure,
  explainReason,
  looksPluginRelated,
  readSafeMode,
  renderSafeModePatch,
  recoveringDetail,
  safePatchPath,
  startWithPluginRecovery,
  withDisabled,
  withoutDisabled,
  writeSafeMode,
  SAFE_PATCH_FILE,
  SAFE_STATE_FILE,
  type DisabledPlugin,
} from "./plugin-recovery.ts";

/**
 * Verbatim shape of the real 0.1.2-rc.1 startup failure: the kernel dropped the
 * settingsNamespace export and two git-hosted profile plugins still imported it.
 * Kept as one blob so a change in dsh's wording shows up as a test failure.
 */
const REAL_FAILURE = [
  "Error: dsh: plugin tree failed to load: failed to apply loader entry include (cordis:include): loader entries failed to apply",
  "AggregateError: loader entries failed to apply",
  "    at file:///Users/u/.dsh/profiles/web/#include",
  "Error: failed to import loader entry openviking (dsh-openviking): The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'",
  "    at updateError (file:///Users/u/.dsh/.../cordis-plugin-loader/lib/index.js:309:9)",
  "    at Entry._init (file:///Users/u/.dsh/.../cordis-plugin-loader/lib/index.js:524:10)",
  "Error: failed to import loader entry better-sidebar (dsh-better-sidebar): The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'",
  "    at updateError (file:///Users/u/.dsh/.../cordis-plugin-loader/lib/index.js:309:9)",
  "  [cause]: SyntaxError: The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'",
].join("\n");

describe("classifyHostFailure", () => {
  it("names every plugin bundle that failed to import", () => {
    const failure = classifyHostFailure(REAL_FAILURE);
    expect(failure.kind).toBe("incompatible-plugin");
    if (failure.kind !== "incompatible-plugin") return;
    expect(failure.plugins.map((p) => p.entryId)).toEqual([
      "openviking",
      "better-sidebar",
    ]);
    expect(failure.plugins.map((p) => p.packageName)).toEqual([
      "dsh-openviking",
      "dsh-better-sidebar",
    ]);
  });

  it("keeps the reason line for user-facing explanation", () => {
    const failure = classifyHostFailure(REAL_FAILURE);
    if (failure.kind !== "incompatible-plugin") throw new Error("no failure");
    expect(failure.plugins[0]?.reason).toContain(
      "does not provide an export named 'settingsNamespace'",
    );
  });

  it("deduplicates the same entry reported twice", () => {
    const twice = REAL_FAILURE + "\n" + REAL_FAILURE;
    const failure = classifyHostFailure(twice);
    if (failure.kind !== "incompatible-plugin") throw new Error("no failure");
    expect(failure.plugins).toHaveLength(2);
  });

  it("does not blame plugins for an unrelated startup failure", () => {
    expect(
      classifyHostFailure(
        "Error: desktop Host exited before readiness (code 1, signal null)",
      ).kind,
    ).toBe("not-plugin-related");
    expect(classifyHostFailure("").kind).toBe("not-plugin-related");
  });

  it("ignores a bare module-not-found for the host itself", () => {
    const failure = classifyHostFailure(
      "Error: Cannot find package '@deepseek-ai/dsh' imported from bin.js",
    );
    expect(failure.kind).toBe("not-plugin-related");
  });
});

describe("looksPluginRelated", () => {
  it("recognizes the plugin-tree failure banner", () => {
    expect(looksPluginRelated(REAL_FAILURE)).toBe(true);
    expect(looksPluginRelated("EADDRINUSE: address already in use")).toBe(false);
  });
});

describe("renderSafeModePatch", () => {
  it("emits one disabled row per entry id", () => {
    const patch = renderSafeModePatch(["openviking", "better-sidebar"]);
    expect(patch).toContain("- id: openviking\n  disabled: true");
    expect(patch).toContain("- id: better-sidebar\n  disabled: true");
  });

  it("drops duplicates and keeps an empty list a valid empty tree", () => {
    expect(renderSafeModePatch(["a", "a"])).toContain("- id: a");
    expect(renderSafeModePatch([])).toContain("[]");
    expect(renderSafeModePatch([]).includes("- id:")).toBe(false);
  });

  it("quotes ids YAML would otherwise reinterpret", () => {
    const quoted = renderSafeModePatch(["yes", "no:1"]);
    expect(quoted).toContain("- id: 'yes'");
    expect(quoted).toContain("- id: 'no:1'");
    const plain = renderSafeModePatch(["better-sidebar"]);
    expect(plain).toContain("- id: better-sidebar");
    expect(plain.includes("'better-sidebar'")).toBe(false);
  });
});

describe("explainReason", () => {
  it("translates the missing-export failure users actually hit", () => {
    const text = explainReason(
      "The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'",
    );
    expect(text).toContain("settingsNamespace");
    expect(text).toContain("@deepseek-ai/dsh-settings");
    expect(text).toContain("不兼容");
  });

  it("falls back to the raw reason when unrecognized", () => {
    expect(explainReason("boom")).toBe("boom");
    expect(explainReason("")).toBe("插件导入失败");
  });
});

describe("safe-mode set algebra", () => {
  const existing = [
    {
      entryId: "openviking",
      packageName: "dsh-openviking",
      reason: "r",
      disabledAt: "t0",
    },
  ];

  it("adds only previously unknown entries", () => {
    const next = withDisabled(
      existing,
      [
        {
          entryId: "openviking",
          packageName: "dsh-openviking",
          reason: "r",
        },
        {
          entryId: "better-sidebar",
          packageName: "dsh-better-sidebar",
          reason: "r2",
        },
      ],
      "t1",
    );
    expect(next?.map((e) => e.entryId)).toEqual([
      "openviking",
      "better-sidebar",
    ]);
    expect(next?.[1]?.disabledAt).toBe("t1");
  });

  it("signals a stalled recovery by returning undefined", () => {
    expect(
      withDisabled(
        existing,
        [{ entryId: "openviking", packageName: "dsh-openviking", reason: "r" }],
        "t1",
      ),
    ).toBeUndefined();
  });

  it("removes an entry on re-enable, undefined when absent", () => {
    expect(withoutDisabled(existing, "openviking")).toEqual([]);
    expect(withoutDisabled(existing, "other")).toBeUndefined();
  });
});

describe("recoveringDetail", () => {
  it("counts the disabled plugins for the splash line", () => {
    expect(recoveringDetail(2)).toContain("2");
  });
});
describe("startWithPluginRecovery", () => {
  /** A Host stand-in that fails with real dsh output, then goes quiet. */
  function fakeHost(output: string, failTimes = 1) {
    const calls: string[] = [];
    let remaining = failTimes;
    return {
      calls,
      host: {
        async start() {
          calls.push("start");
          if (remaining-- > 0) throw new Error("boot failed\nHost output:\n" + output);
          return "http://127.0.0.1:1";
        },
        async restart(reason: string) {
          calls.push("restart:" + reason);
          if (remaining-- > 0) throw new Error("boot failed\nHost output:\n" + output);
          return { id: 2, origin: "http://127.0.0.1:1" };
        },
      },
    };
  }

  it("disables the attributed bundles and relaunches to a booted Host", async () => {
    const fake = fakeHost(REAL_FAILURE);
    let disabled: DisabledPlugin[] = [];
    const reports: number[] = [];
    const recovered = await startWithPluginRecovery({
      startup: async (attempt) =>
        attempt === 0 ? fake.host.start() : fake.host.restart("safe"),
      getDisabled: () => disabled,
      commit: (next) => {
        disabled = [...next];
      },
      report: (count) => reports.push(count),
    });
    expect(fake.calls).toEqual(["start", "restart:safe"]);
    expect(disabled.map((entry) => entry.entryId)).toEqual([
      "openviking",
      "better-sidebar",
    ]);
    expect(recovered).toHaveLength(2);
    expect(reports).toEqual([2]);
  });

  it("keeps previously disabled bundles across rounds", async () => {
    const fake = fakeHost(REAL_FAILURE);
    let disabled: DisabledPlugin[] = [
      {
        entryId: "already",
        packageName: "dsh-already",
        reason: "",
        disabledAt: "t",
      },
    ];
    await startWithPluginRecovery({
      startup: async (attempt) =>
        attempt === 0 ? fake.host.start() : fake.host.restart("safe"),
      getDisabled: () => disabled,
      commit: (next) => {
        disabled = [...next];
      },
    });
    expect(disabled.map((entry) => entry.entryId)).toEqual([
      "already",
      "openviking",
      "better-sidebar",
    ]);
  });

  it("stops instead of looping when the same bundles keep failing", async () => {
    const fake = fakeHost(REAL_FAILURE, 10);
    let disabled: DisabledPlugin[] = [];
    await expect(
      startWithPluginRecovery({
        startup: async () => fake.host.start(),
        getDisabled: () => disabled,
        commit: (next) => {
          disabled = [...next];
        },
      }),
    ).rejects.toThrow("自动停用后仍无法启动");
    expect(disabled).toHaveLength(2);
  });

  it("surfaces an unrelated failure untouched", async () => {
    const error = new Error("EADDRINUSE: address already in use 127.0.0.1:3000");
    await expect(
      startWithPluginRecovery({
        startup: async () => {
          throw error;
        },
        getDisabled: () => [],
        commit: () => {},
      }),
    ).rejects.toBe(error);
  });

  it("names the plugin when the tree failed but no entry could be parsed", async () => {
    await expect(
      startWithPluginRecovery({
        startup: async () => {
          throw new Error("dsh: plugin tree failed to load: something else");
        },
        getDisabled: () => [],
        commit: () => {},
      }),
    ).rejects.toThrow("插件加载失败");
  });
});

describe("safe-mode persistence", () => {
  it("round-trips the disabled set through userData", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-safe-"));
    try {
      expect(readSafeMode(dir)).toEqual([]);
      expect(safePatchPath(dir)).toBeUndefined();
      const rows: DisabledPlugin[] = [
        {
          entryId: "openviking",
          packageName: "dsh-openviking",
          reason: "no export",
          disabledAt: "2026-09-07T00:00:00.000Z",
        },
      ];
      const patch = writeSafeMode(dir, rows);
      expect(patch).toEqual(join(dir, SAFE_PATCH_FILE));
      expect(safePatchPath(dir)).toEqual(patch);
      expect(readSafeMode(dir)).toEqual(rows);
      expect(readFileSync(patch as string, "utf8")).toContain(
        "- id: openviking\n  disabled: true",
      );
      // Emptying the set stops passing an overlay at all.
      expect(writeSafeMode(dir, [])).toBeUndefined();
      expect(safePatchPath(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores a corrupted state file instead of failing startup", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-safe-"));
    try {
      writeFileSync(join(dir, SAFE_STATE_FILE), "{not json");
      expect(readSafeMode(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drops malformed rows but keeps the usable ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-safe-"));
    try {
      writeFileSync(
        join(dir, SAFE_STATE_FILE),
        JSON.stringify({
          disabled: [
            { entryId: "good", packageName: "dsh-good" },
            { packageName: "missing-id" },
            null,
          ],
        }),
      );
      expect(readSafeMode(dir)).toEqual([
        {
          entryId: "good",
          packageName: "dsh-good",
          reason: "",
          disabledAt: "",
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
