/**
 * Runtime half of the kernel-contract check: read the live kernel, migrate, remember.
 *
 * The value domain is read from the installed kernel rather than a build-time
 * snapshot. That matters for a pure-shell client: the kernel is whatever the
 * user currently has (npm latest, or a version they updated to on their own),
 * so a manifest baked at build time would describe a version that may no
 * longer be the one running. Reading the actual install can never disagree.
 *
 * Three guards on the only risky action here - writing a file the user owns:
 *  - only values present in the authored rename table are rewritten; anything
 *    merely unknown is reported and left alone;
 *  - the rewrite touches exactly the line carrying the value, so comments and
 *    layout survive;
 *  - each (key, from, to, kernel) decision is applied at most once and recorded
 *    in userData. Set DSH_DESKTOP_NO_CONFIG_MIGRATION=1 to report without
 *    writing at all.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  applyMigrations,
  parseRenames,
  planCompat,
  type DanglingValue,
  type KernelCompat,
} from "./config-compat.ts";

/** What the user should be told about. */
export interface CompatReport {
  readonly migrated: DanglingValue[];
  readonly dangling: DanglingValue[];
  readonly unknownModels: DanglingValue[];
  /** True when something was found but not written (opt-out or already applied). */
  readonly reportedOnly: boolean;
  readonly kernelVersion?: string;
}

const RECORD_FILE = "config-compat.json";
const PRESETS_PACKAGE = "@deepseek-ai/dsh-agent-presets";
const POLICY_PACKAGE = "@deepseek-ai/dsh-sandbox-policy";
const DSH_PACKAGE = "@deepseek-ai/dsh";

export function dshHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.DSH_HOME?.trim();
  if (fromEnv === undefined || fromEnv === "") return join(homedir(), ".dsh");
  if (fromEnv.startsWith("~/")) return join(homedir(), fromEnv.slice(2));
  return fromEnv;
}

function settingsPath(env: NodeJS.ProcessEnv): string {
  return join(dshHome(env), "settings.yaml");
}

/** Both install layouts: flat node_modules, and the pnpm hoisted layer. */
function packageDir(kernelRoot: string, name: string): string | undefined {
  const paths = [
    join(kernelRoot, "node_modules", name),
    join(kernelRoot, "node_modules", ".pnpm", "node_modules", name),
  ];
  for (const p of paths) if (existsSync(p)) return p;
  return undefined;
}

function subdirectories(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => !name.startsWith("."))
      .filter((name) => {
        try {
          return statSync(join(dir, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

/**
 * Permission modes come from the kernel's own SANDBOX_MODES array literal
 * rather than our notes, so a new mode is recognised without a client release.
 * Preset ids are the preset package's own directories for the same reason.
 */
function sandboxModes(policyPkg: string): string[] {
  try {
    const text = readFileSync(join(policyPkg, "lib", "index.js"), "utf8");
    const start = text.indexOf("const SANDBOX_MODES = [");
    if (start < 0) return [];
    const end = text.indexOf("]", start);
    if (end < 0) return [];
    return [...text.slice(start, end).matchAll(/"([^"]+)"/gu)]
      .map((m) => m[1])
      .filter((v): v is string => typeof v === "string" && v !== "");
  } catch {
    return [];
  }
}

function kernelVersion(kernelRoot: string): string | undefined {
  const pkg = packageDir(kernelRoot, DSH_PACKAGE);
  if (pkg === undefined) return undefined;
  try {
    const data = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof data.version === "string" ? data.version : undefined;
  } catch {
    return undefined;
  }
}

/** Read the domain from an installed kernel; undefined when it cannot be judged. */
export function discoverKernelDomain(kernelRoot: string): KernelCompat | undefined {
  const presetsPkg = packageDir(kernelRoot, PRESETS_PACKAGE);
  const policyPkg = packageDir(kernelRoot, POLICY_PACKAGE);
  if (presetsPkg === undefined || policyPkg === undefined) return undefined;
  const agentPresets = subdirectories(join(presetsPkg, "presets"));
  const permissionModes = sandboxModes(policyPkg);
  // An empty domain would make every value look valid, which is worse than
  // declining to judge: it silently disables the check.
  if (agentPresets.length === 0 || permissionModes.length < 2) return undefined;
  const version = kernelVersion(kernelRoot);
  return {
    ...(version === undefined ? {} : { dshVersion: version }),
    agentPresets,
    permissionModes,
  };
}

function loadRecord(userDataDir: string): string[] {
  try {
    const data = JSON.parse(readFileSync(join(userDataDir, RECORD_FILE), "utf8")) as {
      applied?: unknown;
    };
    return Array.isArray(data.applied)
      ? data.applied.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function saveRecord(userDataDir: string, applied: readonly string[]): void {
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(
    join(userDataDir, RECORD_FILE),
    JSON.stringify({ applied }, null, 2) + "\n",
    "utf8",
  );
}

function stamp(entry: DanglingValue, kernelVersion: string | undefined): string {
  return (
    entry.key +
    ":" +
    entry.value +
    "->" +
    (entry.replacement ?? "?") +
    "@" +
    (kernelVersion ?? "unknown")
  );
}

/**
 * Check the user's settings against the kernel actually installed and migrate
 * what is certainly safe. Never throws: this runs after a successful boot, and
 * a config note must not become a startup failure.
 */
export function checkUserConfig(options: {
  readonly desktopDir: string;
  readonly kernelRoot: string;
  readonly userDataDir: string;
  readonly env?: NodeJS.ProcessEnv;
}): CompatReport {
  const env = options.env ?? process.env;
  const empty: CompatReport = {
    migrated: [],
    dangling: [],
    unknownModels: [],
    reportedOnly: false,
  };
  try {
    const path = settingsPath(env);
    if (!existsSync(path)) return empty;
    const compat = discoverKernelDomain(options.kernelRoot);
    if (compat === undefined) return empty;
    const renamesPath = join(options.desktopDir, "resources/config-renames.json");
    const renames = parseRenames(
      existsSync(renamesPath) ? readFileSync(renamesPath, "utf8") : "{}",
    );
    const text = readFileSync(path, "utf8");
    const plan = planCompat(text, compat, renames);
    if (
      plan.migrations.length === 0 &&
      plan.dangling.length === 0 &&
      plan.unknownModels.length === 0
    ) {
      return empty;
    }

    const applied = loadRecord(options.userDataDir);
    const writeAllowed = env.DSH_DESKTOP_NO_CONFIG_MIGRATION === undefined;
    const toApply = writeAllowed
      ? plan.migrations.filter(
          (entry) => !applied.includes(stamp(entry, compat.dshVersion)),
        )
      : [];
    let reportedOnly = !writeAllowed || toApply.length < plan.migrations.length;

    if (toApply.length > 0) {
      const next = applyMigrations(text, toApply);
      // Refuse to write an unexpected transformation: if the migrated values
      // are not all clean afterwards, a parser bug is in play and the user's
      // file is better left untouched than "fixed".
      const stillDangling = planCompat(next, compat, renames).migrations;
      if (stillDangling.length === 0) {
        writeFileSync(path, next, "utf8");
        saveRecord(options.userDataDir, [
          ...applied,
          ...toApply.map((entry) => stamp(entry, compat.dshVersion)),
        ]);
      } else {
        reportedOnly = true;
      }
    }

    return {
      migrated: toApply,
      dangling: plan.dangling,
      unknownModels: plan.unknownModels,
      reportedOnly,
      kernelVersion: compat.dshVersion,
    };
  } catch (error) {
    console.error("config compatibility check failed:", error);
    return empty;
  }
}

