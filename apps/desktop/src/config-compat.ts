/**
 * Kernel-contract compatibility for the shared user settings file.
 *
 * The kernel owns public config vocabularies - agent preset ids, permission
 * modes - and has changed them across releases without migrating the file that
 * references them: 0.1.2-rc.1 deleted preset id "code" (now "ptc"), leaving
 * "default: code" in ~/.dsh/settings.yaml pointing at nothing. The failure is
 * worse than a crash: dsh rejects the session create and the web UI logs one
 * console.warn, so the user just sees a button that does nothing.
 *
 * The kernel bundles its own value domain (preset directories, sandbox mode
 * literals), so the build can snapshot it into kernel-compat.json and the
 * running app can spot a dangling value. Detection is only half the job: a
 * value the kernel renamed can be migrated with certainty, while a value it
 * dropped needs a human. Those two outcomes are kept separate, and a
 * migration rewrites exactly the line carrying the value - never the whole
 * document. settings.yaml belongs to the user, may hold comments and ordering
 * they care about, and there is no safe round-trip through a generic YAML
 * writer here.
 */

/** Value domains snapshotted from the kernel at build time. */
export interface KernelCompat {
  readonly dshVersion?: string;
  readonly agentPresets: readonly string[];
  readonly permissionModes: readonly string[];
}

/** Old value -> replacement per settings key. Authored by us, reviewed on each kernel bump. */
export type RenameTable = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** One dangling setting discovered in the file. */
export interface DanglingValue {
  /** Dotted settings path, e.g. agent-presets.default */
  readonly key: string;
  readonly value: string;
  /** 0-based index of the line carrying the value. */
  readonly line: number;
  /** Value the kernel now uses, when a rename is known. */
  readonly replacement?: string;
  readonly reason: string;
}

/** Outcome of checking a settings document. */
export interface CompatPlan {
  /** Values safe to rewrite automatically. */
  readonly migrations: DanglingValue[];
  /** Values with no known successor: report them, never guess. */
  readonly dangling: DanglingValue[];
  /** Model references that do not resolve inside the same file. */
  readonly unknownModels: DanglingValue[];
}

/** A key/value line with its indentation, as much structure as this file needs. */
interface Row {
  readonly index: number;
  readonly indent: number;
  readonly key: string;
  readonly value: string;
}

/**
 * Parse the scalar block-mapping subset that settings.yaml actually uses.
 *
 * Sequence entries are surfaced both as key "item" and as their own key so
 * model ids stay reachable. Flow collections, block scalars and anchors are
 * not used by this file; a line that is not "key:" or "key: value" is skipped,
 * which keeps a future format change from producing a false migration instead
 * of a missed one.
 */
export function scanSettings(text: string): Row[] {
  const rows: Row[] = [];
  const lines = text.split(/\r?\n/u);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    if (trimmed.startsWith("- ")) {
      const item = /^-\s+([\w-]+):\s*(.*)$/u.exec(trimmed);
      if (item?.[1] !== undefined) {
        const value = stripQuotes(item[2] ?? "");
        rows.push({ index: i, indent: indent + 2, key: "item", value });
        rows.push({ index: i, indent: indent + 2, key: item[1], value });
      }
      continue;
    }
    const pair = /^([\w.@-]+):\s*(.*)$/u.exec(trimmed);
    const key = pair?.[1];
    if (key === undefined) continue;
    rows.push({
      index: i,
      indent,
      key,
      value: stripQuotes(pair?.[2] ?? ""),
    });
  }
  return rows;
}

function stripQuotes(value: string): string {
  const v = value.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Locate the line of a two-level key: a child inside a top-level block.
 *
 * The child must sit at exactly indent 2 inside the parent block, so a
 * same-named key nested deeper (providers repeat names like this) cannot be
 * matched by mistake.
 */
export function findValue(
  rows: readonly Row[],
  parent: string,
  child: string,
): Row | undefined {
  const start = rows.findIndex(
    (r) => r.indent === 0 && r.key === parent && r.value === "",
  );
  if (start < 0) return undefined;
  for (let i = start + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined || row.indent === 0) break;
    if (row.indent === 2 && row.key === child && row.value !== "") return row;
  }
  return undefined;
}

/** Provider name -> declared model ids, read out of the same document. */
export function readProviderModels(rows: readonly Row[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const start = rows.findIndex(
    (r) => r.indent === 2 && r.key === "providers" && r.value === "",
  );
  if (start < 0) return out;
  let provider: string | undefined;
  let inModels = false;
  for (let i = start + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined || row.indent <= 2) break;
    if (row.indent === 4) {
      inModels = false;
      provider = row.value === "" ? row.key : undefined;
      if (provider !== undefined && !out.has(provider)) out.set(provider, []);
      continue;
    }
    if (provider === undefined) continue;
    if (row.indent === 6) {
      inModels = row.key === "models";
      continue;
    }
    if (inModels && row.indent >= 8 && row.key === "id") {
      out.get(provider)?.push(row.value);
    }
  }
  return out;
}

/**
 * Compare the user's settings against the kernel value domain.
 *
 * Read-only on purpose: choosing what to rewrite is the caller's decision, so
 * a plan can be shown before the file is touched.
 */
export function planCompat(
  text: string,
  compat: KernelCompat,
  renames: RenameTable,
): CompatPlan {
  const rows = scanSettings(text);
  const migrations: DanglingValue[] = [];
  const dangling: DanglingValue[] = [];
  const unknownModels: DanglingValue[] = [];

  const check = (
    key: string,
    parent: string,
    child: string,
    domain: readonly string[],
  ): void => {
    if (domain.length === 0) return; // no snapshot: nothing is provably wrong
    const row = findValue(rows, parent, child);
    if (row === undefined || row.value === "") return;
    if (domain.includes(row.value)) return;
    const replacement = renames[key]?.[row.value];
    const base = { key, value: row.value, line: row.index };
    if (replacement === undefined) {
      dangling.push({
        ...base,
        reason: "当前内核没有这个取值，且无法确定它的新名字",
      });
      return;
    }
    migrations.push({
      ...base,
      replacement,
      reason: "当前内核已把它改名为 " + replacement,
    });
  };

  check("agent-presets.default", "agent-presets", "default", compat.agentPresets);
  check("permission.defaultPreset", "permission", "defaultPreset", compat.permissionModes);

  // A default model must resolve inside the same document. Provider or model
  // renamed in one place only is the same class of silent breakage, and
  // catching it needs no kernel knowledge at all.
  const models = readProviderModels(rows);
  const provider = findValue(rows, "agent-default-model", "provider");
  const model = findValue(rows, "agent-default-model", "model");
  if (provider !== undefined && provider.value !== "") {
    const declared = models.get(provider.value);
    if (declared === undefined) {
      unknownModels.push({
        key: "agent-default-model.provider",
        value: provider.value,
        line: provider.index,
        reason: "本文件的 llm-pi-ai.providers 里没有这个 provider",
      });
    } else if (model !== undefined && model.value !== "") {
      if (declared.length > 0 && !declared.includes(model.value)) {
        unknownModels.push({
          key: "agent-default-model.model",
          value: model.value,
          line: model.index,
          reason: "provider " + provider.value + " 下没有声明这个模型",
        });
      }
    }
  }

  return { migrations, dangling, unknownModels };
}

/**
 * Rewrite only the lines carrying migrated values.
 *
 * Everything else is byte-identical, including comments and blank lines, and
 * the original indentation and quoting style are kept.
 */
export function applyMigrations(
  text: string,
  migrations: readonly DanglingValue[],
): string {
  if (migrations.length === 0) return text;
  const lines = text.split(/\r?\n/u);
  for (const migration of migrations) {
    const next = migration.replacement;
    if (next === undefined) continue;
    const line = lines[migration.line];
    if (line === undefined) continue;
    const match = /^(\s*[\w.@-]+:\s*)(.*\S)(\s*)$/u.exec(line);
    if (match === null) continue;
    const previous = match[2] ?? "";
    const quoted =
      /^".*"$/u.test(previous) ? '"' + next + '"' :
      /^'.*'$/u.test(previous) ? "'" + next + "'" :
      next;
    lines[migration.line] = (match[1] ?? "") + quoted + (match[3] ?? "");
  }
  return lines.join("\n");
}

/** Parse the authored rename table; malformed content only disables auto-migration. */
export function parseRenames(raw: string): RenameTable {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, Record<string, string>> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== "object" || value === null) continue;
      const map: Record<string, string> = {};
      for (const [from, to] of Object.entries(value as Record<string, unknown>)) {
        if (from !== "" && typeof to === "string" && to !== "") map[from] = to;
      }
      out[key] = map;
    }
    return out;
  } catch {
    return {};
  }
}