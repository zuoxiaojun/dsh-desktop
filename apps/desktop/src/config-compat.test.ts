import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyMigrations,
  findValue,
  parseRenames,
  planCompat,
  readProviderModels,
  scanSettings,
  type KernelCompat,
  type RenameTable,
} from "./config-compat.ts";
import { checkUserConfig, discoverKernelDomain } from "./config-migration.ts";

/** Trimmed to structure from the real ~/.dsh/settings.yaml that broke. */
const REAL_SETTINGS = [
  "ui-onboarding:",
  "  welcomeNoticeVersion: 2026-08-13.1",
  "permission:",
  "  defaultPreset: danger-full-access",
  "agent-presets:",
  "  default: code",
  "llm-pi-ai:",
  "  providers:",
  "    yonyou-default:",
  "      apiKeyEnv: YONYOU_DEFAULT_API_KEY",
  "      api: openai-completions",
  "      models:",
  "        - id: deepseek-v4-flash",
  "          name: deepseek-v4-flash",
  "    bailian:",
  "      displayName: 阿里百炼",
  "      models:",
  "        - id: qwen3.8-flash",
  "          contextWindow: 1000000",
  "        - id: deepseek-v4-flash",
  "          contextWindow: 384000",
  "agent-default-model:",
  "  provider: bailian",
  "  model: qwen3.8-flash",
  "ui-theme:",
  "  preference: system",
  "",
].join("\n");

const COMPAT: KernelCompat = {
  dshVersion: "0.1.2-rc.1",
  agentPresets: ["cordis", "minimal", "ptc", "standard"],
  permissionModes: ["read-only", "workspace-write", "danger-full-access"],
};

const RENAMES: RenameTable = {
  "agent-presets.default": { code: "ptc" },
  "permission.defaultPreset": {},
};

describe("scanSettings / findValue", () => {
  it("finds a two-level key at its real line", () => {
    const rows = scanSettings(REAL_SETTINGS);
    const hit = findValue(rows, "agent-presets", "default");
    expect(hit?.value).toBe("code");
    expect(REAL_SETTINGS.split("\n")[hit?.index ?? -1]).toBe("  default: code");
  });

  it("does not confuse a nested same-named key with the top-level one", () => {
    const rows = scanSettings(REAL_SETTINGS);
    expect(findValue(rows, "agent-default-model", "provider")?.value).toBe("bailian");
    // "provider" never appears at indent 2 under agent-presets.
    expect(findValue(rows, "agent-presets", "provider")).toBeUndefined();
  });

  it("reads provider model ids for the self-consistency check", () => {
    const models = readProviderModels(scanSettings(REAL_SETTINGS));
    expect([...models.keys()]).toEqual(["yonyou-default", "bailian"]);
    expect(models.get("bailian")).toEqual(["qwen3.8-flash", "deepseek-v4-flash"]);
  });
});

describe("planCompat", () => {
  it("flags the deleted preset and maps it to its successor", () => {
    const plan = planCompat(REAL_SETTINGS, COMPAT, RENAMES);
    expect(plan.migrations).toHaveLength(1);
    expect(plan.migrations[0]).toMatchObject({
      key: "agent-presets.default",
      value: "code",
      replacement: "ptc",
    });
    expect(plan.dangling).toEqual([]);
    expect(plan.unknownModels).toEqual([]);
  });

  it("accepts a settings file that is already current", () => {
    const plan = planCompat(
      REAL_SETTINGS.replace("  default: code", "  default: ptc"),
      COMPAT,
      RENAMES,
    );
    expect(plan.migrations).toEqual([]);
    expect(plan.dangling).toEqual([]);
  });

  it("reports a dropped value without guessing a replacement", () => {
    const plan = planCompat(
      REAL_SETTINGS.replace("  default: code", "  default: turbo"),
      COMPAT,
      RENAMES,
    );
    expect(plan.migrations).toEqual([]);
    expect(plan.dangling[0]).toMatchObject({
      key: "agent-presets.default",
      value: "turbo",
    });
  });

  it("checks permission modes too", () => {
    const plan = planCompat(
      REAL_SETTINGS.replace("defaultPreset: danger-full-access", "defaultPreset: read-write"),
      COMPAT,
      RENAMES,
    );
    expect(plan.dangling[0]?.key).toBe("permission.defaultPreset");
  });

  it("catches a default model that its provider no longer declares", () => {
    const plan = planCompat(
      REAL_SETTINGS.replace("  model: qwen3.8-flash", "  model: qwen2-old"),
      COMPAT,
      RENAMES,
    );
    expect(plan.unknownModels[0]).toMatchObject({
      key: "agent-default-model.model",
      value: "qwen2-old",
    });
  });

  it("catches a default provider that is not declared at all", () => {
    const plan = planCompat(
      REAL_SETTINGS.replace("  provider: bailian", "  provider: openai"),
      COMPAT,
      RENAMES,
    );
    expect(plan.unknownModels[0]?.key).toBe("agent-default-model.provider");
  });

  it("claims nothing when the kernel snapshot has an empty domain", () => {
    const plan = planCompat(REAL_SETTINGS, { agentPresets: [], permissionModes: [] }, RENAMES);
    expect(plan.migrations).toEqual([]);
    expect(plan.dangling).toEqual([]);
  });

  it("survives a file without the checked keys", () => {
    const plan = planCompat("ui-theme:\n  preference: system\n", COMPAT, RENAMES);
    expect(plan.migrations).toEqual([]);
    expect(plan.dangling).toEqual([]);
    expect(plan.unknownModels).toEqual([]);
  });
});

describe("applyMigrations", () => {
  it("rewrites only the value line", () => {
    const plan = planCompat(REAL_SETTINGS, COMPAT, RENAMES);
    const next = applyMigrations(REAL_SETTINGS, plan.migrations);
    const before = REAL_SETTINGS.split("\n");
    const after = next.split("\n");
    expect(after[plan.migrations[0]?.line ?? -1]).toBe("  default: ptc");
    let differences = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) differences++;
    expect(differences).toBe(1);
  });

  it("preserves the user quoting style", () => {
    const quoted = REAL_SETTINGS.replace("  default: code", "  default: \"code\"");
    const plan = planCompat(quoted, COMPAT, RENAMES);
    expect(applyMigrations(quoted, plan.migrations)).toContain("  default: \"ptc\"");
  });

  it("is idempotent and leaves other content byte-identical", () => {
    const plan = planCompat(REAL_SETTINGS, COMPAT, RENAMES);
    const once = applyMigrations(REAL_SETTINGS, plan.migrations);
    const twice = applyMigrations(once, planCompat(once, COMPAT, RENAMES).migrations);
    expect(twice).toBe(once);
    expect(planCompat(once, COMPAT, RENAMES).migrations).toEqual([]);
  });

  it("does nothing for a plan without replacements", () => {
    expect(applyMigrations(REAL_SETTINGS, [])).toBe(REAL_SETTINGS);
  });
});

