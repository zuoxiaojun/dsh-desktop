/** Node.js runtime resolution and managed installation for the desktop shell. */

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, createReadStream, createWriteStream } from "node:fs";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
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
  return first?.trim();
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
