/** Node.js runtime resolution and managed installation for the desktop shell. */

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { env } from "node:process";
import { dirname, join, win32 } from "node:path";

const VERSION_RE = /^v(\d+)\.(\d+)\.(\d+)$/u;

export interface NodeProgress {
  stage:
    | "detecting"
    | "using-system"
    | "downloading"
    | "verifying"
    | "installing"
    | "smoke"
    | "installing-dsh"
    | "ready";
  percent?: number;
  receivedBytes?: number;
  totalBytes?: number;
  detail?: string;
}

export interface NodeInfo {
  executable: string;
  version: string;
  managed: boolean;
  npmCli: string;
}

export interface NodeVersionsConfig {
  version: string;
  minSystemNode: number;
  mirrorBase: string;
  checksums: Record<string, string>;
}

export function parseNodeVersion(output: string): string | undefined {
  const match = VERSION_RE.exec(output.trim());
  return match?.[0];
}

export function nodeMajor(version: string): number | undefined {
  const match = VERSION_RE.exec(version);
  return match === null ? undefined : Number(match[1]);
}

const ARCHIVE_SPECS: Record<string, { ext: "tar.gz" | "zip" }> = {
  "darwin-arm64": { ext: "tar.gz" },
  "darwin-x64": { ext: "tar.gz" },
  "win32-x64": { ext: "zip" },
  "linux-x64": { ext: "tar.gz" },
  "linux-arm64": { ext: "tar.gz" },
};

/** Official Node archive platform label (win32 archives use "win"). */
const ARCHIVE_PLATFORM_LABEL: Record<string, string> = {
  win32: "win",
};

export function nodeArchiveSpec(
  version: string,
  platform: NodeJS.Platform,
  arch: string,
): { fileName: string; ext: "tar.gz" | "zip" } {
  const spec = ARCHIVE_SPECS[`${platform}-${arch}`];
  if (spec === undefined) {
    throw new Error(
      `unsupported Node platform/arch: ${platform}-${arch}; expected one of ${Object.keys(ARCHIVE_SPECS).join(", ")}`,
    );
  }
  return {
    fileName: `node-v${version}-${ARCHIVE_PLATFORM_LABEL[platform] ?? platform}-${arch}.${spec.ext}`,
    ext: spec.ext,
  };
}

export function nodeDownloadUrl(
  config: NodeVersionsConfig,
  platform: NodeJS.Platform,
  arch: string,
): string {
  const { fileName } = nodeArchiveSpec(config.version, platform, arch);
  return `${config.mirrorBase}/v${config.version}/${fileName}`;
}

export function checksumFor(
  config: NodeVersionsConfig,
  platform: NodeJS.Platform,
  arch: string,
): string {
  const key = `${platform}-${arch}`;
  const sum = config.checksums[key];
  if (sum === undefined) {
    throw new Error(`no SHA256 checksum configured for Node on ${key}`);
  }
  return sum;
}

function runCommand(
  command: string,
  args: readonly string[],
  shell: boolean,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell, windowsHide: true });
    let out = "";
    child.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => {
      resolve(code === 0 ? out : undefined);
    });
  });
}

export async function locateNodeExecutable(
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  const raw = await runCommand(
    platform === "win32" ? "where.exe" : "which",
    ["node"],
    false,
  );
  const first = raw?.split(/\r?\n/u).find((line) => line.trim() !== "");
  if (first !== undefined && first.trim() !== "") return first.trim();
  // macOS GUI 应用（双击 .app）不继承 shell 的 PATH，这里扫描常见安装位置兜底
  const homeDir = env.HOME ?? "";
  for (const candidate of nodeCandidates(platform, homeDir)) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** 常见 node 安装位置（PATH 之外），按平台返回；nvm/fnm 版本目录按版本号降序。 */
export function nodeCandidates(
  platform: NodeJS.Platform,
  homeDir: string,
): string[] {
  if (platform === "win32") {
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    const localAppData =
      env.LOCALAPPDATA ?? win32.join(homeDir, "AppData", "Local");
    return [
      win32.join(programFiles, "nodejs", "node.exe"),
      win32.join(localAppData, "Programs", "nodejs", "node.exe"),
      win32.join(homeDir, ".volta", "bin", "node.exe"),
    ];
  }

  const candidates: string[] = [];
  appendVersionedNodeDirs(
    candidates,
    join(homeDir, ".nvm", "versions", "node"),
    (dir) => join(dir, "bin", "node"),
  );
  appendVersionedNodeDirs(
    candidates,
    join(homeDir, ".fnm", "node-versions"),
    (dir) => join(dir, "installation", "bin", "node"),
  );
  candidates.push(
    join(homeDir, ".volta", "bin", "node"),
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
  );
  return candidates;
}

function appendVersionedNodeDirs(
  list: string[],
  root: string,
  toBin: (versionDir: string) => string,
): void {
  let versions: string[];
  try {
    versions = readdirSync(root).filter((name) => name.startsWith("v"));
  } catch {
    return;
  }
  versions.sort((a, b) => (nodeMajor(b) ?? 0) - (nodeMajor(a) ?? 0));
  for (const version of versions) list.push(toBin(join(root, version)));
}

export async function runNodeVersion(
  nodeExecutable: string,
): Promise<string | undefined> {
  const out = await runCommand(nodeExecutable, ["--version"], false);
  return out === undefined ? undefined : out.trim();
}

export async function detectSystemNode(
  platform: NodeJS.Platform,
  minSystemNode: number,
): Promise<NodeInfo | undefined> {
  const executable = await locateNodeExecutable(platform);
  if (executable === undefined) return undefined;
  const rawVersion = await runNodeVersion(executable);
  if (rawVersion === undefined) return undefined;
  const version = parseNodeVersion(rawVersion);
  if (version === undefined) return undefined;
  const major = nodeMajor(version);
  if (major === undefined || major < minSystemNode) return undefined;
  const npmCli = resolveNpmCli(executable, platform);
  if (!existsSync(npmCli)) return undefined;
  return { executable, version, managed: false, npmCli };
}

export function managedDshEntry(userDataDir: string): string {
  return join(
    userDataDir,
    "dsh",
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "lib",
    "bin.js",
  );
}

export function readManagedDshVersion(userDataDir: string): string | undefined {
  try {
    const pkg = JSON.parse(
      readFileSync(
        join(
          userDataDir,
          "dsh",
          "node_modules",
          "@deepseek-ai",
          "dsh",
          "package.json",
        ),
        "utf8",
      ),
    ) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

export async function extractArchive(
  archivePath: string,
  destDir: string,
  platform: NodeJS.Platform,
): Promise<void> {
  if (platform === "win32") {
    const out = await runCommand(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destDir}' -Force`,
      ],
      false,
    );
    if (out === undefined) {
      throw new Error(`extract failed for ${archivePath}`);
    }
    return;
  }
  const status = await new Promise<number | null>((resolve) => {
    const child = spawn("tar", ["-xzf", archivePath, "-C", destDir], {
      windowsHide: true,
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code));
  });
  if (status !== 0) throw new Error(`extract failed for ${archivePath}`);
}

async function hashMatches(
  archivePath: string,
  expected: string,
): Promise<boolean> {
  const actual = await sha256File(archivePath);
  return actual.toLowerCase() === expected.toLowerCase();
}

export async function installManagedNode(options: {
  userDataDir: string;
  config: NodeVersionsConfig;
  onProgress?: (p: NodeProgress) => void;
  signal?: AbortSignal;
}): Promise<NodeInfo> {
  const { userDataDir, config, onProgress, signal } = options;
  const platform = process.platform as NodeJS.Platform;
  const arch = process.arch;
  const url = nodeDownloadUrl(config, platform, arch);
  const expected = checksumFor(config, platform, arch);
  const root = join(userDataDir, "node");
  mkdirSync(userDataDir, { recursive: true });
  const staging = mkdtempSync(join(userDataDir, ".node-tmp-"));

  try {
    const archivePath = join(
      staging,
      `archive${platform === "win32" ? ".zip" : ".tar.gz"}`,
    );
    let attempt = 0;
    for (;;) {
      if (signal?.aborted) throw new Error("download aborted");
      onProgress?.({
        stage: "downloading",
        detail: `Node.js v${config.version}`,
        percent: 0,
      });
      try {
        await downloadFile(
          url,
          archivePath,
          (p) => {
            onProgress?.({
              stage: "downloading",
              detail: `Node.js v${config.version}`,
              percent:
                p.totalBytes === undefined
                  ? undefined
                  : Math.round((p.receivedBytes / p.totalBytes) * 100),
              receivedBytes: p.receivedBytes,
              totalBytes: p.totalBytes,
            });
          },
          signal,
        );
        break;
      } catch (error) {
        rmSync(archivePath, { force: true });
        attempt += 1;
        if (attempt >= 3 || signal?.aborted) throw error;
        onProgress?.({
          stage: "downloading",
          detail: `下载失败，第 ${attempt} 次重试…`,
        });
      }
    }

    onProgress?.({ stage: "verifying", detail: "SHA256 校验中…" });
    if (!(await hashMatches(archivePath, expected))) {
      throw new Error(`SHA256 mismatch for ${url}`);
    }

    onProgress?.({ stage: "installing", detail: "解压安装中…" });
    const extractDir = join(staging, "extracted");
    await extractArchive(archivePath, extractDir, platform);
    const entries = await readdir(extractDir);
    const entryName = entries[0]; // e.g. node-v24.15.0-darwin-arm64
    if (entryName === undefined) throw new Error("archive extracted nothing");
    const extractedRoot = join(extractDir, entryName);

    onProgress?.({ stage: "smoke", detail: "验证安装…" });
    const stagedExecutable =
      platform === "win32"
        ? join(extractedRoot, "node.exe")
        : join(extractedRoot, "bin", "node");
    const versionOut = await runNodeVersion(stagedExecutable);
    const version =
      versionOut === undefined ? undefined : parseNodeVersion(versionOut);
    if (version === undefined) {
      throw new Error(
        `installed Node smoke test failed (${String(versionOut)})`,
      );
    }

    const newExecutable =
      platform === "win32" ? join(root, "node.exe") : join(root, "bin", "node");
    rmSync(root, { recursive: true, force: true });
    renameSync(extractedRoot, root);
    const npmCli = resolveNpmCli(newExecutable, platform);
    if (!existsSync(npmCli)) {
      throw new Error(`npm not found under managed Node: ${npmCli}`);
    }
    onProgress?.({ stage: "ready", detail: `Node.js ${version}` });
    return { executable: newExecutable, version, managed: true, npmCli };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export async function ensureManagedDsh(options: {
  node: NodeInfo;
  userDataDir: string;
  onProgress?: (p: NodeProgress) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const { node, userDataDir, onProgress, signal } = options;
  const entry = managedDshEntry(userDataDir);
  if (existsSync(entry)) {
    onProgress?.({ stage: "installing-dsh", detail: "dsh 已就绪" });
    return entry;
  }
  const env = { ...process.env } as Record<string, string | undefined>;
  env.npm_config_registry = "https://registry.npmmirror.com";
  env.npm_config_cache = join(userDataDir, "npm-cache");
  if (signal?.aborted) throw new Error("install aborted");
  onProgress?.({
    stage: "installing-dsh",
    detail: "首次安装 dsh（国内镜像），请稍候…",
  });
  const status = await new Promise<number | null>((resolve) => {
    const child = spawn(
      node.executable,
      [
        node.npmCli,
        "install",
        "--prefix",
        join(userDataDir, "dsh"),
        "@deepseek-ai/dsh",
      ],
      { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    child.stderr?.on("data", (c: Buffer) => process.stderr.write(c));
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code));
  });
  if (status !== 0 || !existsSync(entry)) {
    throw new Error("managed dsh install failed (network or registry issue)");
  }
  onProgress?.({ stage: "installing-dsh", detail: "dsh 安装完成" });
  return entry;
}

export interface ResolveNodeOptions {
  userDataDir: string;
  config: NodeVersionsConfig;
  onProgress?: (p: NodeProgress) => void;
  signal?: AbortSignal;
}

export async function resolveNode(
  options: ResolveNodeOptions,
): Promise<NodeInfo> {
  const { userDataDir, config, onProgress, signal } = options;
  const platform = process.platform as NodeJS.Platform;
  onProgress?.({ stage: "detecting", detail: "检测 Node.js 环境…" });
  const system = await detectSystemNode(platform, config.minSystemNode);
  if (system !== undefined) {
    onProgress?.({
      stage: "using-system",
      detail: `使用系统 Node.js ${system.version}`,
    });
    return system;
  }
  onProgress?.({
    stage: "detecting",
    detail: "未检测到可用的 Node.js，准备下载…",
  });
  return installManagedNode({ userDataDir, config, onProgress, signal });
}

export function resolveNpmCli(
  nodeExecutable: string,
  platform: NodeJS.Platform,
): string {
  if (platform === "win32") {
    return win32.join(
      win32.dirname(nodeExecutable),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
  }
  return join(
    dirname(nodeExecutable),
    "..",
    "lib",
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number | undefined;
}

export function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      request.destroy(new Error("download aborted"));
    };
    const request = (url.startsWith("https:") ? httpsGet : httpGet)(
      url,
      { signal },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new Error(
              `download failed: HTTP ${String(response.statusCode)} for ${url}`,
            ),
          );
          return;
        }
        const contentLength = Number(
          response.headers["content-length"] ?? undefined,
        );
        const totalBytes = Number.isFinite(contentLength)
          ? contentLength
          : undefined;
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          onProgress?.({ receivedBytes: received, totalBytes });
        });
        const sink = createWriteStream(destPath);
        response.pipe(sink);
        sink.on("finish", () => resolve());
        sink.on("error", reject);
      },
    );
    request.on("error", reject);
    if (signal !== undefined) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
