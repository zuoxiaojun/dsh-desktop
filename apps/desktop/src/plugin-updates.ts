/**
 * Locate a newer revision for a plugin the shell had to disable.
 *
 * The recovery story desktop users get should end somewhere, and the realistic
 * end for "this plugin predates the kernel" is "here is a plugin build that
 * does not". Profiles install plugins the way the plugin market does: as
 * profile dependencies, usually git-hosted with a pinned commit. So a candidate
 * is just a newer revision of the very same spec - release tag first, branch
 * head otherwise, registry latest for published packages.
 *
 * Nothing here claims compatibility. Only a boot can prove that, so the caller
 * applies the candidate and retries; if the plugin still fails it is disabled
 * again and the user is told the upstream build is still broken.
 */

/** Parsed view of a profile dependency spec. */
export type PluginSpec =
  | {
      readonly kind: "github";
      readonly owner: string;
      readonly repo: string;
      /** Pinned ref (tag or 40-char sha), absent when the branch tip floats. */
      readonly ref?: string;
    }
  | {
      readonly kind: "registry";
      readonly name: string;
      readonly range: string;
    };

/** A newer revision the user could move to. */
export interface PluginUpdate {
  readonly packageName: string;
  readonly currentSpec: string;
  readonly candidateSpec: string;
  /** Short user-facing description of the target. */
  readonly label: string;
}

const GITHUB_RE =
  /^github:(?<owner>[\w.-]+)\/(?<repo>[\w.-]+?)(?:\.git)?(?:#(?<ref>[^#]+))?$/u;
const GIT_URL_RE =
  /^git\+(?:https?):\/\/(?:www\.)?github\.com\/(?<owner>[\w.-]+)\/(?<repo>[\w.-]+?)(?:\.git)?(?:#(?<ref>[^#]+))?$/u;
const SHA_RE = /^[0-9a-f]{40}$/u;
const NAMED_RE = /^(?:@[\w.-]+\/)?[\w.-]+$/u;

/**
 * Parse the spec shapes dsh profiles actually carry.
 *
 * @returns the parsed spec, or undefined for specs we refuse to rewrite (local
 * paths, tarballs, aliases) - editing those blind could point a profile at a
 * directory that is not the plugin.
 */
export function parsePluginSpec(
  packageName: string,
  spec: string,
): PluginSpec | undefined {
  const value = spec.trim();
  const git = GITHUB_RE.exec(value) ?? GIT_URL_RE.exec(value);
  const owner = git?.groups?.owner;
  const repo = git?.groups?.repo;
  const ref = git?.groups?.ref;
  if (owner !== undefined && repo !== undefined) {
    return ref === undefined
      ? { kind: "github", owner, repo }
      : { kind: "github", owner, repo, ref };
  }
  // The plain registry case: the manifest key is the package name and the
  // value is a range. Path- and link-shaped specs are excluded so a local
  // plugin checkout is never rewritten against a registry by mistake.
  const local = /^(?:link:|file:|workspace:|[.~/]\/|\/$)/u.test(value);
  // Ranges carry dots, wildcards and spaces (`1.2.3`, `~1.2`, `>=1 <2`).
  const ranged =
    /^[\d~^><=*.x|,\s]+$/u.test(value) ||
    /^(?:latest|next|\*)$/u.test(value);
  if (!local && ranged && NAMED_RE.test(packageName)) {
    return { kind: "registry", name: packageName, range: value };
  }
  return undefined;
}

/**
 * Decide the candidate revision for a github-hosted plugin.
 *
 * A pinned commit moves to a release tag when the repo publishes them (the tag
 * is the author's own supported statement), otherwise to the default branch
 * head. A floating spec always has a candidate: re-resolving it is how a
 * branch-tracking plugin picks up a fix.
 */
export function chooseGithubCandidate(
  spec: Extract<PluginSpec, { kind: "github" }>,
  upstream: { readonly latestTag?: string; readonly headSha?: string },
):
  | { readonly candidateSpec: string; readonly label: string }
  | undefined {
  const base = "github:" + spec.owner + "/" + spec.repo;
  // Floating spec: re-resolving picks up the branch tip, which is how a
  // branch-tracking plugin receives the author's fix.
  if (spec.ref === undefined) {
    return { candidateSpec: base, label: "重新解析上游最新提交" };
  }
  // A release tag outranks a raw commit: it is the author's own supported
  // build, and it is what an operator would have pinned by hand anyway.
  if (upstream.latestTag !== undefined) {
    return upstream.latestTag === spec.ref
      ? undefined
      : {
          candidateSpec: base + "#" + upstream.latestTag,
          label: "更新到 " + upstream.latestTag,
        };
  }
  const head = upstream.headSha;
  if (head !== undefined && headMoved(spec.ref, head)) {
    return {
      candidateSpec: base + "#" + head,
      label: "更新到上游最新提交 " + head.slice(0, 7),
    };
  }
  return undefined;
}

/** True when the pinned commit is not already the upstream head. */
function headMoved(pinned: string, head: string): boolean {
  if (!SHA_RE.test(pinned)) return pinned !== head;
  // Tolerate a short pin by comparing prefixes instead of demanding 40 hex.
  return !head.startsWith(pinned) && !pinned.startsWith(head);
}

/** "owner/repo" identity used by the GitHub API routes. */
export function githubRepo(
  spec: Extract<PluginSpec, { kind: "github" }>,
): string {
  return spec.owner + "/" + spec.repo;
}

/** Candidate for a published package: the registry latest, when newer. */
export function chooseRegistryCandidate(
  spec: Extract<PluginSpec, { kind: "registry" }>,
  installed: string | undefined,
  latest: string | undefined,
):
  | { readonly candidateSpec: string; readonly label: string }
  | undefined {
  if (latest === undefined || latest === "") return undefined;
  if (installed !== undefined && installed === latest) return undefined;
  return {
    candidateSpec: spec.name + "@" + latest,
    label: "更新到 v" + latest,
  };
}
/**
 * Network and profile reads that feed the candidate decision above.
 *
 * Every lookup fails open: an unavailable registry or a rate-limited GitHub
 * call must degrade to "no update offered", never to a scary error on top of an
 * already-recovering startup.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** npm mirror used for plugin metadata, matching the kernel install path. */
const PLUGIN_REGISTRY = "https://registry.npmmirror.com";
const LOOKUP_TIMEOUT_MS = 6000;

/**
 * Ceiling for one `dsh plugin add`. pnpm has to resolve and fetch the package,
 * so it is generous, but it must exist: without it a stalled registry leaves the
 * caller waiting forever with no way out.
 */
const PLUGIN_UPDATE_TIMEOUT_MS = 180_000;

/** The web profile directory, honouring $DSH_HOME the way dsh does. */
export function webProfileDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME?.trim();
  const root = home === undefined || home === "" ? join(homedir(), ".dsh") : home;
  const expanded = root.startsWith("~/")
    ? join(homedir(), root.slice(2))
    : root;
  return join(expanded, "profiles", "web");
}

/** Profile dependencies as declared; empty when the profile is unreadable. */
export function readProfileDependencies(
  profileDir: string,
): Record<string, string> {
  try {
    const manifest = JSON.parse(
      readFileSync(join(profileDir, "package.json"), "utf8"),
    ) as { dependencies?: unknown };
    const deps = manifest.dependencies;
    if (typeof deps !== "object" || deps === null) return {};
    const out: Record<string, string> = {};
    for (const [name, spec] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof spec === "string") out[name] = spec;
    }
    return out;
  } catch {
    return {};
  }
}

/** Version the profile actually has installed, when readable. */
export function readInstalledVersion(
  profileDir: string,
  packageName: string,
): string | undefined {
  try {
    const pkg = JSON.parse(
      readFileSync(
        join(profileDir, "node_modules", packageName, "package.json"),
        "utf8",
      ),
    ) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

async function getJson<T>(url: string): Promise<T | undefined> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      headers: {
        "User-Agent": "dsh-desktop",
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

/** Upstream revision info for a github-hosted plugin. */
export async function fetchGithubUpstream(
  repo: string,
): Promise<{ latestTag?: string; headSha?: string }> {
  const release = await getJson<{ tag_name?: unknown }>(
    "https://api.github.com/repos/" + repo + "/releases/latest",
  );
  const latestTag =
    typeof release?.tag_name === "string" && release.tag_name !== ""
      ? release.tag_name
      : undefined;
  if (latestTag !== undefined) return { latestTag };
  const commits = await getJson<{ sha?: unknown }[]>(
    "https://api.github.com/repos/" + repo + "/commits?per_page=1",
  );
  const head = Array.isArray(commits) ? commits[0]?.sha : undefined;
  return typeof head === "string" ? { headSha: head } : {};
}

/** Registry latest for a published plugin package. */
export async function fetchRegistryLatest(
  packageName: string,
): Promise<string | undefined> {
  try {
    const res = await fetch(
      PLUGIN_REGISTRY + "/" + packageName.replace(/\//u, "%2F") + "/latest",
      { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) },
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a newer revision for one plugin, or undefined when there is none, the
 * spec shape is not ours to rewrite, or the network is unavailable.
 */
export async function resolvePluginUpdate(
  packageName: string,
  profileDir: string = webProfileDir(),
): Promise<PluginUpdate | undefined> {
  const spec = readProfileDependencies(profileDir)[packageName];
  if (spec === undefined) return undefined;
  const parsed = parsePluginSpec(packageName, spec);
  if (parsed === undefined) return undefined;
  if (parsed.kind === "github") {
    const candidate = chooseGithubCandidate(
      parsed,
      await fetchGithubUpstream(githubRepo(parsed)),
    );
    return candidate === undefined
      ? undefined
      : {
          packageName,
          currentSpec: spec,
          candidateSpec: candidate.candidateSpec,
          label: candidate.label,
        };
  }
  const candidate = chooseRegistryCandidate(
    parsed,
    readInstalledVersion(profileDir, packageName),
    await fetchRegistryLatest(parsed.name),
  );
  return candidate === undefined
    ? undefined
    : {
        packageName,
        currentSpec: spec,
        candidateSpec: candidate.candidateSpec,
        label: candidate.label,
      };
}

/**
 * Install a candidate through dsh's own plugin command.
 *
 * Goes via `dsh plugin --profile <name>` rather than calling pnpm directly so
 * the package name, the layer list and any alias all reconcile exactly the way
 * the plugin market does.
 *
 * @returns true when pnpm and dsh both exited clean.
 */
export function applyPluginUpdate(options: {
  readonly nodeExecutable: string;
  readonly dshEntry: string;
  readonly profile: string;
  readonly spec: string;
  readonly env: NodeJS.ProcessEnv;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(
      options.nodeExecutable,
      [
        "--expose-internals",
        options.dshEntry,
        "plugin",
        "--profile",
        options.profile,
        "add",
        options.spec,
      ],
      {
        cwd: homedir(),
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
        // 与其余 spawn 一致：Windows 下不弹控制台窗口
        windowsHide: true,
      },
    );
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const done = (value: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(value);
    };
    // A stalled registry must not leave the caller hanging forever.
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(false);
    }, PLUGIN_UPDATE_TIMEOUT_MS);
    timer.unref();
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
  });
}

/** Whether a profile directory looks like a real installed profile. */
export function profileExists(profileDir: string): boolean {
  return existsSync(join(profileDir, "package.json"));
}