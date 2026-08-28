/** Node.js runtime resolution and managed installation for the desktop shell. */

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
