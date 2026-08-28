# DSH Desktop 纯壳架构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 DSH Desktop 从「打包内嵌 dsh + Electron 自带 Node」改造为「纯壳 + 用户系统 Node + 缺省自动从 npmmirror 安装 Node/dsh」的架构，包体从 ~287MB 降到 ~90MB。

**Architecture:** Electron 壳启动时先解析 Node（系统 Node ≥18 优先，否则下载受管 v24 LTS 到 userData），再受管安装 `@deepseek-ai/dsh` 到 `userData/dsh`，用 `node --expose-internals <dsh入口> web` 直接启动；全程由闪屏窗口（本地 HTML）显示初始化进度。Host 监督模型（就绪解析/代际/超时）不变。

**Tech Stack:** Electron 43（主进程 TS/ESM，tsdown 构建）、Node 24 LTS（受管）、npmmirror 国内镜像、vitest（已有依赖，本计划建立测试基线）。

**Spec:** `docs/spec-node-runtime.md`（本计划的一切论证以此为准）

## Global Constraints

- 壳的 `package.json` 不再依赖 `@deepseek-ai/dsh`；删除 `apps/desktop/resources/dsh/` 与 `scripts/prepare-dsh.ts`。
- 所有子进程一律 `spawn(nodeExecutable, [...])` 直启绝对路径，**不经 shell**（Windows 无 `.cmd` 坑）。
- dsh 启动必须带 `--expose-internals`（HMR 依赖）；npx/npm exec 不能传该 flag → 一律用受管安装 + 直接 node 启动。
- 下载 Node 一律走 `config.mirrorBase`（`https://registry.npmmirror.com/-/binary/node`），下载后必须 SHA256 校验（`config.checksums`），失败删除重下（≤2 次重试）。
- npm registry/cache 注入：`npm_config_registry=https://registry.npmmirror.com`、`npm_config_cache=<userData>/npm-cache`。
- 闪屏 preload 只暴露固定方法，无通用 IPC；渲染器保持 `sandbox:true`、`contextIsolation:true`、`nodeIntegration:false`。
- Node 版本策略：受管 v24 LTS（`resources/node-versions.json` 可配），系统 Node 主版本 ≥ `minSystemNode`(18) 直接复用，否则装受管副本。
- 纯逻辑模块 `node-manager.ts` 不得 import electron。

---

### Task 1: 建立 vitest 测试基线

**Files:**

- Create: `apps/desktop/vitest.config.ts`
- Modify: `package.json`（根，加 `test` 脚本）
- Test: `apps/desktop/src/vitest-setup.test.ts`

**Interfaces:**

- Consumes: 无
- Produces: `pnpm run test` 可运行 vitest；测试文件放 `apps/desktop/src/*.test.ts`（tsconfig `include:["src"]` 会 typecheck 它们，tsdown 只构建显式 entry 不会误打包）

- [ ] **Step 1: 写 vitest 配置**

```ts
// apps/desktop/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 2: 写冒烟测试**

```ts
// apps/desktop/src/vitest-setup.test.ts
import { describe, expect, it } from "vitest";

describe("vitest baseline", () => {
  it("runs tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: 加 test 脚本到根 package.json**

```json
"test": "vitest run -c apps/desktop/vitest.config.ts",
```

- [ ] **Step 4: 运行验证**

Run: `pnpm run test`
Expected: PASS（1 个用例）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/vitest.config.ts apps/desktop/src/vitest-setup.test.ts package.json
git commit -m "test: 建立 vitest 测试基线"
```

---

### Task 2: node-manager 纯函数（解析/归档/URL/校验和/npm-cli）

**Files:**

- Create: `apps/desktop/src/node-manager.ts`（本任务只加纯函数部分）
- Create: `apps/desktop/src/node-manager.test.ts`

**Interfaces:**

- Consumes: 无
- Produces（后续任务依赖的精确签名）:

  ```ts
  export interface NodeProgress {
    stage: "detecting" | "using-system" | "downloading" | "verifying" | "installing" | "smoke" | "installing-dsh" | "ready";
    percent?: number;
    receivedBytes?: number;
    totalBytes?: number;
    detail?: string;
  }
  export interface NodeInfo {
    executable: string;
    version: string;    // "v24.15.0"（带前导 v）
    managed: boolean;
    npmCli: string;
  }
  export interface NodeVersionsConfig {
    version: string;                       // "24.15.0"
    minSystemNode: number;                 // 18
    mirrorBase: string;                    // "https://registry.npmmirror.com/-/binary/node"
    checksums: Record<string, string>;     // "darwin-arm64" -> sha256
  }
  export function parseNodeVersion(output: string): string | undefined;      // "v24.15.0" 规范化校验
  export function nodeMajor(version: string): number | undefined;            // "v24.15.0" -> 24
  export function nodeArchiveSpec(version: string, platform: NodeJS.Platform, arch: string): { fileName: string; ext: "tar.gz" | "zip" };
  export function nodeDownloadUrl(config: NodeVersionsConfig, platform: NodeJS.Platform, arch: string): string;
  export function checksumFor(config: NodeVersionsConfig, platform: NodeJS.Platform, arch: string): string;  // 缺平台抛错
  export function resolveNpmCli(nodeExecutable: string, platform: NodeJS.Platform): string;
  ```

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/src/node-manager.test.ts
import { describe, expect, it } from "vitest";
import {
  checksumFor,
  nodeArchiveSpec,
  nodeDownloadUrl,
  nodeMajor,
  parseNodeVersion,
  resolveNpmCli,
} from "./node-manager.ts";

describe("parseNodeVersion", () => {
  it("normalizes a bare version output", () => {
    expect(parseNodeVersion("v24.15.0\n")).toBe("v24.15.0");
  });
  it("rejects garbage", () => {
    expect(parseNodeVersion("not a version")).toBeUndefined();
    expect(parseNodeVersion("")).toBeUndefined();
  });
});

describe("nodeMajor", () => {
  it("extracts the major", () => {
    expect(nodeMajor("v24.15.0")).toBe(24);
  });
  it("returns undefined for invalid", () => {
    expect(nodeMajor("garbage")).toBeUndefined();
  });
});

describe("nodeArchiveSpec", () => {
  it("maps darwin arm64 to tar.gz", () => {
    expect(nodeArchiveSpec("24.15.0", "darwin", "arm64")).toEqual({
      fileName: "node-v24.15.0-darwin-arm64.tar.gz",
      ext: "tar.gz",
    });
  });
  it("maps win32 x64 to zip", () => {
    expect(nodeArchiveSpec("24.15.0", "win32", "x64")).toEqual({
      fileName: "node-v24.15.0-win-x64.zip",
      ext: "zip",
    });
  });
  it("throws for unsupported platforms", () => {
    expect(() => nodeArchiveSpec("24.15.0", "freebsd", "x64")).toThrow();
  });
});

describe("nodeDownloadUrl", () => {
  it("builds the npmmirror URL", () => {
    const config: NodeVersionsConfig = {
      version: "24.15.0",
      minSystemNode: 18,
      mirrorBase: "https://registry.npmmirror.com/-/binary/node",
      checksums: {},
    };
    expect(nodeDownloadUrl(config, "darwin", "arm64")).toBe(
      "https://registry.npmmirror.com/-/binary/node/v24.15.0/node-v24.15.0-darwin-arm64.tar.gz",
    );
  });
});

describe("checksumFor", () => {
  it("returns the matching checksum", () => {
    const config: NodeVersionsConfig = {
      version: "24.15.0",
      minSystemNode: 18,
      mirrorBase: "x",
      checksums: { "darwin-arm64": "abc123" },
    };
    expect(checksumFor(config, "darwin", "arm64")).toBe("abc123");
  });
  it("throws when the platform has no checksum", () => {
    const config: NodeVersionsConfig = {
      version: "24.15.0",
      minSystemNode: 18,
      mirrorBase: "x",
      checksums: {},
    };
    expect(() => checksumFor(config, "darwin", "arm64")).toThrow();
  });
});

describe("resolveNpmCli", () => {
  it("resolves posix npm-cli path", () => {
    expect(resolveNpmCli("/usr/local/bin/node", "darwin")).toBe(
      "/usr/local/lib/node_modules/npm/bin/npm-cli.js",
    );
  });
  it("resolves windows npm-cli path", () => {
    expect(resolveNpmCli("C:\\node\\node.exe", "win32")).toBe(
      "C:\\node\\node_modules\\npm\\bin\\npm-cli.js",
    );
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现纯函数**

```ts
// apps/desktop/src/node-manager.ts（本任务只写纯函数；后续任务追加）
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
    fileName: `node-v${version}-${platform}-${arch}.${spec.ext}`,
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
  return platform === "win32"
    ? join(dirname(nodeExecutable), "node_modules", "npm", "bin", "npm-cli.js")
    : join(
        dirname(nodeExecutable),
        "..",
        "lib",
        "node_modules",
        "npm",
        "bin",
        "npm-cli.js",
      );
}
```

（文件顶部补齐 import：`import { dirname, join } from "node:path";`）

- [ ] **Step 4: 运行确认通过**

Run: `pnpm run test`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/node-manager.ts apps/desktop/src/node-manager.test.ts
git commit -m "feat: node-manager 纯函数（版本解析/归档映射/下载URL/校验和/npm-cli 定位）"
```

---

### Task 3: node-manager 下载与 SHA256 校验

**Files:**

- Modify: `apps/desktop/src/node-manager.ts`（追加 `sha256File` / `downloadFile`）
- Modify: `apps/desktop/src/node-manager.test.ts`

**Interfaces:**

- Consumes: Task 2 的 `NodeProgress`
- Produces:

  ```ts
  export function sha256File(path: string): Promise<string>;   // 返回小写 hex
  export interface DownloadProgress { receivedBytes: number; totalBytes: number | undefined; }
  export function downloadFile(
    url: string,
    destPath: string,
    onProgress?: (p: DownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  ```

- [ ] **Step 1: 写失败测试（本地 HTTP 服务器 + 临时文件）**

```ts
// 追加到 node-manager.test.ts
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";
import { downloadFile, sha256File } from "./node-manager.ts";

let server: Server;
let baseUrl: string;
let payload: Buffer;

beforeAll(async () => {
  payload = Buffer.from("hello node download", "utf8");
  server = createServer((req, res) => {
    if (req.url === "/node.bin") {
      res.writeHead(200, { "content-length": String(payload.length) });
      res.end(payload);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

describe("downloadFile", () => {
  it("downloads bytes and reports progress", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-dl-"));
    const dest = join(dir, "node.bin");
    const events: number[] = [];
    await downloadFile(`${baseUrl}/node.bin`, dest, (p) => {
      events.push(p.receivedBytes);
    });
    expect(readFileSync(dest)).toEqual(payload);
    expect(events[events.length - 1]).toBe(payload.length);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("sha256File", () => {
  it("hashes a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-sha-"));
    const dest = join(dir, "node.bin");
    await downloadFile(`${baseUrl}/node.bin`, dest);
    const expected = createHash("sha256").update(payload).digest("hex");
    expect(await sha256File(dest)).toBe(expected);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test`
Expected: FAIL（`downloadFile`/`sha256File` 未导出）

- [ ] **Step 3: 实现**

```ts
// 追加到 node-manager.ts
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { get } from "node:https";

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
    const request = get(
      url,
      { signal },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new Error(`download failed: HTTP ${String(response.statusCode)} for ${url}`),
          );
          return;
        }
        const totalBytes = Number(response.headers["content-length"] ?? undefined);
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          onProgress?.({
            receivedBytes: received,
            totalBytes: Number.isFinite(totalBytes) ? totalBytes : undefined,
          });
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
```

（文件顶部补齐 import：`import { createReadStream } from "node:fs";`）

- [ ] **Step 4: 运行确认通过**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/node-manager.ts apps/desktop/src/node-manager.test.ts
git commit -m "feat: node-manager 下载与 SHA256 校验"
```

---

### Task 4: node-manager 系统 Node 检测

**Files:**

- Modify: `apps/desktop/src/node-manager.ts`（追加检测逻辑）
- Create: `apps/desktop/src/node-manager.detect.test.ts`

**Interfaces:**

- Consumes: Task 2 的 `NodeInfo`/`resolveNpmCli`/`parseNodeVersion`/`nodeMajor`
- Produces:

  ```ts
  export function locateNodeExecutable(platform: NodeJS.Platform): Promise<string | undefined>;
  export function runNodeVersion(nodeExecutable: string): Promise<string | undefined>;
  export async function detectSystemNode(platform: NodeJS.Platform, minSystemNode: number): Promise<NodeInfo | undefined>;
  ```

- [ ] **Step 1: 写测试（在本机 vitest 的 node 环境下可真实检测）**

```ts
// apps/desktop/src/node-manager.detect.test.ts
import { describe, expect, it } from "vitest";
import {
  detectSystemNode,
  locateNodeExecutable,
  parseNodeVersion,
  runNodeVersion,
} from "./node-manager.ts";

describe("locateNodeExecutable", () => {
  it("finds node on PATH when present", async () => {
    const exe = await locateNodeExecutable(process.platform);
    if (process.env.PATH?.includes("node") === false && exe === undefined) {
      // 无 node 环境则跳过（CI/受管环境下不要求）
      return;
    }
    expect(exe).toBeTruthy();
  });
});

describe("runNodeVersion", () => {
  it("returns a parseable version", async () => {
    const exe = await locateNodeExecutable(process.platform);
    if (exe === undefined) return;
    const v = await runNodeVersion(exe);
    expect(parseNodeVersion(v ?? "")).toBeTruthy();
  });
});

describe("detectSystemNode", () => {
  it("detects a usable node or undefined", async () => {
    const info = await detectSystemNode(process.platform, 18);
    if (info === undefined) return;
    expect(info.executable).toBeTruthy();
    expect(info.managed).toBe(false);
    expect(Number(info.version.slice(1).split(".")[0])).toBeGreaterThanOrEqual(18);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test`
Expected: FAIL（函数未导出）

- [ ] **Step 3: 实现**

```ts
// 追加到 node-manager.ts
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

function runCommand(command: string, args: readonly string[], shell: boolean): Promise<string | undefined> {
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
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm run test`
Expected: PASS（本机有 node，检测到；无 node 环境自动跳过）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/node-manager.ts apps/desktop/src/node-manager.detect.test.ts
git commit -m "feat: node-manager 系统 Node 检测"
```

---

### Task 5: node-manager 受管安装 + resolveNode 编排

**Files:**

- Modify: `apps/desktop/src/node-manager.ts`（追加 extract/install/ensureDsh/resolveNode）
- Create: `apps/desktop/src/node-manager.install.test.ts`

**Interfaces:**

- Consumes: Task 2/3/4 的全部函数
- Produces（main.ts 唯一入口）:

  ```ts
  export interface ResolveNodeOptions {
    userDataDir: string;
    config: NodeVersionsConfig;
    onProgress?: (p: NodeProgress) => void;
    signal?: AbortSignal;
  }
  export function resolveNode(options: ResolveNodeOptions): Promise<NodeInfo>;
  export function extractArchive(archivePath: string, destDir: string, platform: NodeJS.Platform): Promise<void>;
  export function installManagedNode(options: { userDataDir: string; config: NodeVersionsConfig; onProgress?: (p: NodeProgress) => void; signal?: AbortSignal }): Promise<NodeInfo>;
  export function managedDshEntry(userDataDir: string): string;
  export function readManagedDshVersion(userDataDir: string): string | undefined;
  export function ensureManagedDsh(options: { node: NodeInfo; userDataDir: string; onProgress?: (p: NodeProgress) => void; signal?: AbortSignal }): Promise<string>;  // 返回 dsh 入口
  ```

- [ ] **Step 1: 写 extractArchive 测试（用系统 tar 生成 fixture，仅 posix）**

```ts
// apps/desktop/src/node-manager.install.test.ts
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractArchive, managedDshEntry } from "./node-manager.ts";

describe("extractArchive (posix only)", () => {
  it.runIf(process.platform !== "win32")("extracts a tar.gz", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dsh-ext-"));
    const payload = Buffer.from("payload-data");
    writeFileSync(join(dir, "inner.txt"), payload);
    execSync(`tar -czf "${join(dir, "a.tar.gz")}" -C "${dir}" inner.txt`);
    const out = mkdtempSync(join(tmpdir(), "dsh-ext-out-"));
    await extractArchive(join(dir, "a.tar.gz"), out, process.platform as NodeJS.Platform);
    expect(readFileSync(join(out, "inner.txt"))).toEqual(payload);
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  });
});

describe("managedDshEntry", () => {
  it("points into the managed dsh dir", () => {
    expect(managedDshEntry("/tmp/ud")).toBe(
      "/tmp/ud/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js",
    );
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm run test`
Expected: FAIL

- [ ] **Step 3: 实现受管安装 + 编排**

```ts
// 追加到 node-manager.ts
import { mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

export function managedDshEntry(userDataDir: string): string {
  return join(userDataDir, "dsh", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
}

export function readManagedDshVersion(userDataDir: string): string | undefined {
  try {
    const pkg = JSON.parse(
      readFileSync(
        join(userDataDir, "dsh", "node_modules", "@deepseek-ai", "dsh", "package.json"),
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
    await runCommand(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destDir}' -Force`,
      ],
      false,
    );
    return;
  }
  const status = await new Promise<number | null>((resolve) => {
    const child = spawn("tar", ["-xzf", archivePath, "-C", destDir], { windowsHide: true });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code));
  });
  if (status !== 0) throw new Error(`extract failed for ${archivePath}`);
}

async function hashMatches(archivePath: string, expected: string): Promise<boolean> {
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
  const staging = mkdtempSync(join(userDataDir, ".node-tmp-"));

  try {
    const archivePath = join(staging, "archive" + (process.platform === "win32" ? ".zip" : ".tar.gz"));
    let attempt = 0;
    for (;;) {
      if (signal?.aborted) throw new Error("aborted");
      onProgress?.({ stage: "downloading", detail: `Node.js v${config.version}`, percent: 0 });
      try {
        await downloadFile(url, archivePath, (p) => {
          onProgress?.({
            stage: "downloading",
            detail: `Node.js v${config.version}`,
            percent: p.totalBytes === undefined ? undefined : Math.round((p.receivedBytes / p.totalBytes) * 100),
            receivedBytes: p.receivedBytes,
            totalBytes: p.totalBytes,
          });
        }, signal);
        break;
      } catch (error) {
        rmSync(archivePath, { force: true });
        attempt += 1;
        if (attempt >= 3 || signal?.aborted) throw error;
        onProgress?.({ stage: "downloading", detail: `下载失败，第 ${attempt} 次重试…` });
      }
    }

    onProgress?.({ stage: "verifying", detail: "SHA256 校验中…" });
    if (!(await hashMatches(archivePath, expected))) {
      throw new Error(`SHA256 mismatch for ${url}`);
    }

    onProgress?.({ stage: "installing", detail: "解压安装中…" });
    const extractDir = join(staging, "extracted");
    await extractArchive(archivePath, extractDir, platform);
    const entries = await import("node:fs/promises").then((m) => m.readdir(extractDir));
    const entryName = entries[0]; // node-v24.15.0-darwin-arm64
    if (entryName === undefined) throw new Error("archive extracted nothing");
    const extractedRoot = join(extractDir, entryName);

    onProgress?.({ stage: "smoke", detail: "验证安装…" });
    const executable = platform === "win32"
      ? join(extractedRoot, "node.exe")
      : join(extractedRoot, "bin", "node");
    const versionOut = await runNodeVersion(executable);
    const version = versionOut === undefined ? undefined : parseNodeVersion(versionOut);
    if (version === undefined) {
      throw new Error(`installed Node smoke test failed (${String(versionOut)})`);
    }

    rmSync(root, { recursive: true, force: true });
    renameSync(extractedRoot, root);
    const npmCli = resolveNpmCli(executable, platform);
    if (!existsSync(npmCli)) throw new Error(`npm not found under managed Node: ${npmCli}`);
    onProgress?.({ stage: "ready", detail: `Node.js ${version}` });
    return { executable, version, managed: true, npmCli };
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
  onProgress?.({ stage: "installing-dsh", detail: "首次安装 dsh（国内镜像），请稍候…" });
  const status = await new Promise<number | null>((resolve) => {
    const child = spawn(
      node.executable,
      [node.npmCli, "install", "--prefix", join(userDataDir, "dsh"), "@deepseek-ai/dsh"],
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

export async function resolveNode(options: ResolveNodeOptions): Promise<NodeInfo> {
  const { userDataDir, config, onProgress, signal } = options;
  const platform = process.platform as NodeJS.Platform;
  onProgress?.({ stage: "detecting", detail: "检测 Node.js 环境…" });
  const system = await detectSystemNode(platform, config.minSystemNode);
  if (system !== undefined) {
    onProgress?.({ stage: "using-system", detail: `使用系统 Node.js ${system.version}` });
    return system;
  }
  if (system === undefined) {
    onProgress?.({ stage: "detecting", detail: "未检测到可用的 Node.js，准备下载…" });
  }
  const managed = await installManagedNode({ userDataDir, config, onProgress, signal });
  return managed;
}
```

注意：`installManagedNode` 里 `executable` 在 rename 前指向 staging 路径，rename 后同路径无效——需在 rename 后**重新计算** executable（用新 root）。修正：rename 前先计算 `newExecutable`，rename 后返回 `newExecutable`：

```ts
    const newExecutable = platform === "win32"
      ? join(root, "node.exe")
      : join(root, "bin", "node");
    rmSync(root, { recursive: true, force: true });
    renameSync(extractedRoot, root);
    const npmCli = resolveNpmCli(newExecutable, platform);
    if (!existsSync(npmCli)) throw new Error(`npm not found under managed Node: ${npmCli}`);
    onProgress?.({ stage: "ready", detail: `Node.js ${version}` });
    return { executable: newExecutable, version, managed: true, npmCli };
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm run test`
Expected: PASS（extract 用例 posix 下通过；resolveNode 全链路不在单测覆盖——网络相关，冒烟在 Task 11 手动验证）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/node-manager.ts apps/desktop/src/node-manager.install.test.ts
git commit -m "feat: node-manager 受管安装与 resolveNode 编排"
```

---

### Task 6: 闪屏窗口（boot.html + boot-preload + boot-window）

**Files:**

- Create: `apps/desktop/resources/boot.html`
- Create: `apps/desktop/src/boot-preload.ts`
- Create: `apps/desktop/src/boot-window.ts`

**Interfaces:**

- Consumes: Task 2 的 `NodeProgress`
- Produces（Task 8 依赖）:

  ```ts
  // boot-window.ts
  export interface BootWindow {
    show(): void;
    update(progress: NodeProgress): void;
    showError(message: string): void;
    close(): void;
  }
  export function createBootWindow(options: { desktopVersion: string }): BootWindow;
  // IPC 通道（主进程 → 渲染器）："dsh-boot:progress"、"dsh-boot:error"
  // IPC 通道（渲染器 → 主进程）："dsh-boot:retry"（ipcRenderer.send）
  ```

- [ ] **Step 1: 写 boot.html（内联样式/脚本，无外部资源）**

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>DSH Desktop</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
      "Microsoft YaHei", sans-serif;
    display: flex; align-items: center; justify-content: center;
    height: 100vh; background: var(--bg, #f6f7f9); color: var(--fg, #1c1e21);
    user-select: none;
  }
  @media (prefers-color-scheme: dark) {
    body { --bg: #1e1f24; --fg: #e8e9eb; --sub: #9a9da3; --track: #34363c;
      --bar: #4f8cff; --err: #ff6b6b; }
  }
  body { --sub: #6b6f76; --track: #e2e4e8; --bar: #2f6fed; --err: #d33; }
  .card { width: 420px; text-align: center; }
  .logo { width: 56px; height: 56px; margin: 0 auto 14px; }
  .title { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
  .stage { font-size: 12px; color: var(--sub); margin-bottom: 16px; min-height: 18px; }
  .bar { height: 6px; border-radius: 3px; background: var(--track); overflow: hidden; }
  .bar > i { display: block; height: 100%; width: 0; background: var(--bar);
    border-radius: 3px; transition: width 0.2s ease; }
  .bar.indeterminate > i { width: 30%; animation: slide 1.2s ease-in-out infinite; }
  @keyframes slide { 0% { margin-left: -30%; } 100% { margin-left: 100%; } }
  .detail { font-size: 11px; color: var(--sub); margin-top: 10px; min-height: 16px; }
  .err { color: var(--err); margin-top: 10px; font-size: 12px; }
  .btn { margin-top: 14px; padding: 7px 22px; font-size: 13px; border: 0;
    border-radius: 6px; background: var(--bar); color: #fff; cursor: pointer; }
  .hidden { display: none; }
</style>
</head>
<body>
  <div class="card">
    <svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#2f6fed"/>
      <path d="M20 22c0-4 3-7 7-7h10c4 0 7 3 7 7v8h-6v-7c0-1-1-2-2-2H28c-1 0-2 1-2 2v20c0 1 1 2 2 2h8c1 0 2-1 2-2v-7h6v8c0 4-3 7-7 7h-10c-4 0-7-3-7-7z" fill="#fff"/>
    </svg>
    <div class="title" id="title">DSH Desktop</div>
    <div class="stage" id="stage">正在初始化…</div>
    <div class="bar indeterminate" id="bar"><i></i></div>
    <div class="detail" id="detail"></div>
    <div class="err hidden" id="err"></div>
    <button class="btn hidden" id="retry">重试</button>
  </div>
  <script>
    const $ = (id) => document.getElementById(id);
    const bar = $("bar"), barFill = bar.querySelector("i");
    const stageEl = $("stage"), detailEl = $("detail"), errEl = $("err"),
      retryBtn = $("retry");
    window.dshBoot.onProgress((p) => {
      errEl.classList.add("hidden");
      retryBtn.classList.add("hidden");
      stageEl.textContent = p.detail || p.stage;
      if (typeof p.percent === "number") {
        bar.classList.remove("indeterminate");
        barFill.style.width = Math.max(0, Math.min(100, p.percent)) + "%";
      } else {
        bar.classList.add("indeterminate");
      }
      detailEl.textContent =
        typeof p.percent === "number" && p.totalBytes
          ? p.receivedBytes + " / " + p.totalBytes + " bytes"
          : "";
    });
    window.dshBoot.onError((e) => {
      bar.classList.remove("indeterminate");
      barFill.style.width = "0";
      stageEl.textContent = "初始化失败";
      errEl.textContent = e.message;
      errEl.classList.remove("hidden");
      retryBtn.classList.remove("hidden");
    });
    retryBtn.addEventListener("click", () => window.dshBoot.retry());
  </script>
</body>
</html>
```

- [ ] **Step 2: 写 boot-preload.ts**

```ts
/** Boot splash bridge: fixed methods only, no generic IPC escape hatch. */
import { contextBridge, ipcRenderer } from "electron";
import type { NodeProgress } from "./node-manager.ts";

export interface BootBridge {
  onProgress(callback: (progress: NodeProgress) => void): () => void;
  onError(callback: (error: { message: string }) => void): () => void;
  retry(): void;
}

const bridge: BootBridge = Object.freeze({
  onProgress(callback) {
    const listener = (_e: unknown, progress: NodeProgress): void => {
      callback(progress);
    };
    ipcRenderer.on("dsh-boot:progress", listener);
    return () => {
      ipcRenderer.off("dsh-boot:progress", listener);
    };
  },
  onError(callback) {
    const listener = (_e: unknown, error: { message: string }): void => {
      callback(error);
    };
    ipcRenderer.on("dsh-boot:error", listener);
    return () => {
      ipcRenderer.off("dsh-boot:error", listener);
    };
  },
  retry() {
    ipcRenderer.send("dsh-boot:retry");
  },
});

contextBridge.exposeInMainWorld("dshBoot", bridge);
```

- [ ] **Step 3: 写 boot-window.ts**

```ts
/** Frameless splash window reporting environment initialization progress. */
import { BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import type { NodeProgress } from "./node-manager.ts";

export interface BootWindow {
  show(): void;
  update(progress: NodeProgress): void;
  showError(message: string): void;
  close(): void;
}

export interface BootWindowOptions {
  readonly desktopVersion: string;
  readonly bootHtmlPath: string;
  readonly bootPreloadPath: string;
}

let retryHandler: (() => void) | undefined;

export function createBootWindow(options: BootWindowOptions): BootWindow {
  const window = new BrowserWindow({
    width: 460,
    height: 340,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    title: "DSH Desktop",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: options.bootPreloadPath,
    },
  });
  window.setMenuBarVisibility(false);
  void window.loadFile(options.bootHtmlPath);

  const onRetry = (): void => {
    retryHandler?.();
  };
  ipcMain.removeAllListeners("dsh-boot:retry");
  ipcMain.on("dsh-boot:retry", onRetry);

  return {
    show() {
      window.show();
    },
    update(progress) {
      if (window.isDestroyed()) return;
      window.webContents.send("dsh-boot:progress", progress);
    },
    showError(message) {
      if (window.isDestroyed()) return;
      window.webContents.send("dsh-boot:error", { message });
    },
    close() {
      ipcMain.removeListener("dsh-boot:retry", onRetry);
      if (!window.isDestroyed()) window.destroy();
    },
  };
}

export function setBootRetryHandler(handler: () => void): void {
  retryHandler = handler;
}
```

- [ ] **Step 4: 手动验证（在 Task 8 完成后整体验证；本任务先确保编译通过）**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/resources/boot.html apps/desktop/src/boot-preload.ts apps/desktop/src/boot-window.ts
git commit -m "feat: 启动闪屏窗口与桥接"
```

---

### Task 7: host-supervisor spawn 改造

**Files:**

- Modify: `apps/desktop/src/host-supervisor.ts`（`SpawnDshWebOptions` + `spawnDshWeb`）

**Interfaces:**

- Consumes: 无新依赖
- Produces（Task 8 依赖）:

  ```ts
  export interface SpawnDshWebOptions {
    readonly nodeExecutable: string;
    readonly dshEntry: string;
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
  }
  export function spawnDshWeb(options: SpawnDshWebOptions): HostChild;
  ```

- [ ] **Step 1: 修改 `SpawnDshWebOptions` 与 `spawnDshWeb`**

```ts
/** Options for the real `dsh web` child. */
export interface SpawnDshWebOptions {
  readonly nodeExecutable: string;
  readonly dshEntry: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

/** Spawn the production Web Host on an OS-assigned loopback port. */
export function spawnDshWeb(options: SpawnDshWebOptions): HostChild {
  const process = spawn(
    options.nodeExecutable,
    [
      "--expose-internals",
      options.dshEntry,
      "web",
      "--no-open",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
    ],
    {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  return nodeChildAdapter(process);
}
```

（删除原实现里的 `electronRunAsNode` 分支与 `cliEntry` 参数）

- [ ] **Step 2: 编译验证**

Run: `pnpm run typecheck`
Expected: PASS（此时 main.ts 仍传旧参数会报错——Task 8 一并修）

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/host-supervisor.ts
git commit -m "feat: host-supervisor 改为直接 node 启动 dsh"
```

---

### Task 8: main.ts 集成（boot 流程 + 版本角标）

**Files:**

- Modify: `apps/desktop/src/main.ts`

**Interfaces:**

- Consumes:
  - `resolveNode` / `NodeInfo` / `ensureManagedDsh` / `managedDshEntry` / `readManagedDshVersion`（node-manager.ts）
  - `createBootWindow` / `setBootRetryHandler`（boot-window.ts）
  - `spawnDshWeb`（host-supervisor.ts，新签名）
- Produces: 无新导出

- [ ] **Step 1: 删除构建时 dsh 解析，改为运行时**

删除：`resolveDshEntry()`、`readDshVersion()`、`spawnDshWeb()`（本地旧版）、`adaptChild()`。
保留 `DESKTOP_VERSION`（version.json）。新增模块级 `let DSH_VERSION: string | undefined`。

- [ ] **Step 2: 重写 boot 流程**

```ts
let bootWindow: BootWindow | undefined;
let abortController: AbortController | undefined;
let nodeInfo: NodeInfo | undefined;
let bootStarted = false;

async function boot(): Promise<void> {
  if (bootQuitPromise !== undefined) return;

  const bootHtml = join(DESKTOP_DIR, "resources/boot.html");
  const bootPreload = join(DESKTOP_DIR, "lib/boot-preload.mjs");
  if (bootWindow === undefined) {
    bootWindow = createBootWindow({ desktopVersion: DESKTOP_VERSION, bootHtmlPath: bootHtml, bootPreloadPath: bootPreload });
  }
  bootWindow.show();

  abortController = new AbortController();
  const signal = abortController.signal;
  const userDataDir = app.getPath("userData");

  setBootRetryHandler(() => {
    void boot().catch(handleBootError);
  });

  const onProgress = (p: NodeProgress): void => {
    bootWindow?.update(p);
  };

  // 阶段一：解析 Node（含受管安装）
  const node = await resolveNode({
    userDataDir,
    config: NODE_VERSIONS,
    onProgress,
    signal,
  });
  nodeInfo = node;

  // 阶段二：受管安装 dsh
  const dshEntry = await ensureManagedDsh({ node, userDataDir, onProgress, signal });

  // 阶段三：Host 监督模型启动 dsh web
  host = createHostSupervisor({
    spawnHost: () => spawnDshWeb({
      nodeExecutable: node.executable,
      dshEntry,
      cwd: env.HOME || process.cwd(),
      env: { ...env, DSH_DESKTOP: "1" },
    }),
    log: (chunk) => process.stderr.write(chunk),
    onUnexpectedExit: ({ code, signal: sig }) => {
      console.error(`desktop Host exited unexpectedly (code ${String(code)}, signal ${String(sig)})`);
      void requestAppQuit();
    },
  });

  hardenSession();
  registerIpcHandlers();
  lifecycle = createDesktopLifecycle({
    getWindow: () => mainWindow,
    createWindow: createMainWindow,
    loadHost: async (w, o) => {
      await (w as BrowserWindow).loadURL(desktopRendererUrl(o));
    },
    disposeHost: async () => {
      await host?.shutdown();
    },
    quit: releaseAppQuit,
    reportError: (e) => {
      console.error("desktop shutdown failed:", e);
    },
  });

  bootWindow.update({ stage: "installing-dsh", detail: "正在启动 dsh…" });
  await host.start();

  DSH_VERSION = readManagedDshVersion(userDataDir);

  bootWindow.close();
  bootWindow = undefined;
  createTray();
  await lifecycle.showWindow();
}

async function handleBootError(error: unknown): Promise<void> {
  console.error("desktop startup failed:", error);
  if (bootWindow !== undefined) {
    const message = error instanceof Error ? error.message : String(error);
    bootWindow.showError(message);
  } else {
    const { dialog } = await import("electron");
    await dialog.showMessageBox({
      type: "error",
      title: `${APP_NAME} failed to start`,
      message: error instanceof Error ? error.message : String(error),
    });
    await requestAppQuit();
  }
}
```

- [ ] **Step 3: 修改 `registerIpcHandlers` / `injectVersionBadge`**

`registerIpcHandlers` 中 `dsh: DSH_VERSION`（变量，非常量）。
`injectVersionBadge` 已有逻辑不变，但 `dshText` 基于可变的 `DSH_VERSION`。

- [ ] **Step 4: 修改启动入口错误处理**

```ts
app.whenReady().then(boot).catch((error: unknown) => {
  void handleBootError(error);
});
```

退出时中止下载：

```ts
app.on("before-quit", (event: Event) => {
  if (quitReleased) return;
  event.preventDefault();
  abortController?.abort();
  void requestAppQuit();
});
```

（`requestAppQuit` 里 `disposeHost` 已处理 host；下载阶段 host 为 undefined，`disposeHost` 直接 resolve，正常退出）

- [ ] **Step 5: 顶部加载 node-versions.json**

```ts
const NODE_VERSIONS: NodeVersionsConfig = (() => {
  try {
    return JSON.parse(readFileSync(join(DESKTOP_DIR, "resources/node-versions.json"), "utf8")) as NodeVersionsConfig;
  } catch (error) {
    throw new Error(`node-versions.json missing or invalid: ${String(error)}`);
  }
})();
```

（Task 9 创建该文件；本任务先建占位或一并创建——见 Task 9 Step 1）

- [ ] **Step 6: 编译 + 冒烟**

Run: `pnpm run typecheck && pnpm run build`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main.ts
git commit -m "feat: main.ts 纯壳启动流程（Node 解析 + 受管 dsh + 闪屏）"
```

---

### Task 9: 打包流水线清理

**Files:**

- Create: `apps/desktop/resources/node-versions.json`
- Delete: `apps/desktop/scripts/prepare-dsh.ts`
- Delete: `apps/desktop/resources/dsh/`（git rm -r，260MB 不进入 git，直接 rm 即可）
- Modify: `apps/desktop/tsdown.config.ts`
- Modify: `apps/desktop/electron-builder.config.cjs`
- Modify: `apps/desktop/package.json`（删 `@deepseek-ai/dsh` 依赖）
- Modify: `package.json`（根，`prepare:dsh` 从脚本链移除）
- Modify: `apps/desktop/scripts/dev-desktop.ts`（fingerprint 增源）
- Modify: `apps/desktop/scripts/verify-app.sh`

**Interfaces:**

- Consumes: 无（构建配置）
- Produces: 新的构建产物结构：`lib/main.mjs`、`lib/preload.mjs`、`lib/boot-preload.mjs` + `resources/boot.html`、`resources/node-versions.json`

- [ ] **Step 1: 创建 node-versions.json**

```json
{
  "version": "24.15.0",
  "minSystemNode": 18,
  "mirrorBase": "https://registry.npmmirror.com/-/binary/node",
  "checksums": {
    "darwin-arm64": "",
    "darwin-x64": "",
    "win32-x64": "",
    "linux-x64": "",
    "linux-arm64": ""
  }
}
```

（checksum 为空 → 受管安装会在缺少平台时抛错「no SHA256 checksum」；发布前从 `{mirrorBase}/v24.15.0/SHASUMS256.txt` 填入。本地已有系统 Node 的开发/测试不受影响。若需要本机 arm64 校验值，发布时填。）

- [ ] **Step 2: 删除 prepare-dsh.ts 与 resources/dsh/**

```bash
git rm apps/desktop/scripts/prepare-dsh.ts
rm -rf apps/desktop/resources/dsh
```

- [ ] **Step 3: tsdown entry 增加 boot-preload**

```ts
entry: ["src/main.ts", "src/preload.ts", "src/boot-preload.ts"],
```

- [ ] **Step 4: electron-builder 配置**

删除整个 `extraResources` 块；`files` 改为：

```cjs
files: [
  "lib/**",
  "package.json",
  "resources/icon.svg",
  "resources/version.json",
  "resources/boot.html",
  "resources/node-versions.json",
  "build/icon.png",
],
```

（`!resources/dsh/**` 排除项与 dsh extraResources 一并删除）

- [ ] **Step 5: package.json（壳）删依赖**

`apps/desktop/package.json` 删除 `"@deepseek-ai/dsh": "0.1.1-rc.2"`。

- [ ] **Step 6: 根 package.json 脚本链**

```json
"package": "pnpm run build && electron-builder --dir -c apps/desktop/electron-builder.config.cjs",
"dist:mac": "pnpm run build && electron-builder --dir --mac -c apps/desktop/electron-builder.config.cjs && bash apps/desktop/scripts/verify-app.sh && bash apps/desktop/scripts/package-dmg.sh",
"dist:win": "pnpm run build && electron-builder --win -c apps/desktop/electron-builder.config.cjs",
"dist:linux": "pnpm run build && electron-builder --linux -c apps/desktop/electron-builder.config.cjs",
"dist:all": "pnpm run build && electron-builder --mac --win --linux -c apps/desktop/electron-builder.config.cjs",
```

（全部去掉 `pnpm run prepare:dsh &&` 前缀；删除 `"prepare:dsh"` 脚本本身）

- [ ] **Step 7: dev-desktop.ts fingerprint**

`collectFingerprint()` 的 sources 增加：

```ts
nodeManager: hash(readFileSync(resolve(DESKTOP_DIR, "src/node-manager.ts"), "utf8")),
bootWindow: hash(readFileSync(resolve(DESKTOP_DIR, "src/boot-window.ts"), "utf8")),
bootPreload: hash(readFileSync(resolve(DESKTOP_DIR, "src/boot-preload.ts"), "utf8")),
bootHtml: hash(readFileSync(resolve(DESKTOP_DIR, "resources/boot.html"), "utf8")),
nodeVersions: hash(readFileSync(resolve(DESKTOP_DIR, "resources/node-versions.json"), "utf8")),
```

- [ ] **Step 8: verify-app.sh 重写检查项**

```bash
#!/bin/bash
# 验证打包后的 .app 结构（纯壳架构）
# 在 electron-builder --dir 之后、package-dmg.sh 之前运行
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "❌ node not found in PATH; verify-app.sh needs node" >&2
  exit 1
fi

APP_PATH="${1:-}"
if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  PROJECT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
  DEFAULT_APP="$PROJECT_DIR/dist/mac-arm64/DSH Desktop.app"
  APP_PATH="${APP_PATH:-$DEFAULT_APP}"
fi
if [ ! -d "$APP_PATH" ]; then
  echo "❌ 用法: $0 <path/to/DSH Desktop.app>" >&2
  exit 1
fi

echo "🔍 Verifying packaged app at ${APP_PATH}..."
echo ""

RESOURCES="${APP_PATH}/Contents/Resources"

# 1. node-versions.json 存在、可解析、含当前平台 checksum
NODE_VERSIONS="${RESOURCES}/node-versions.json"
if [ ! -f "$NODE_VERSIONS" ]; then
  echo "❌ node-versions.json not found"
  exit 1
fi
ARCH=$(uname -m)
[ "$ARCH" = "x86_64" ] && ARCH="x64"
NODE_KEY="darwin-${ARCH}"
SUM=$(node -e "const c=require('${NODE_VERSIONS}');console.log(c.checksums['${NODE_KEY}']||'')")
if [ -z "$SUM" ]; then
  echo "⚠️  checksum for ${NODE_KEY} is empty (发布前需从 SHASUMS256.txt 填入)"
else
  echo "✅ node-versions.json: v$(node -e "console.log(require('${NODE_VERSIONS}').version)") (${NODE_KEY} checksum set)"
fi

# 2. boot.html
[ -f "${RESOURCES}/boot.html" ] && echo "✅ boot.html" || { echo "❌ boot.html missing"; exit 1; }

# 3. app.asar 存在（含 main/preload/boot-preload）
[ -f "${RESOURCES}/app.asar" ] && echo "✅ app.asar ($(ls -lh "${RESOURCES}/app.asar" | awk '{print $5}'))" || { echo "❌ app.asar missing"; exit 1; }

# 4. 不包含 dsh 目录（纯壳）
if [ -d "${RESOURCES}/dsh" ]; then
  echo "❌ Resources/dsh still present (纯壳架构不应打包 dsh)"
  exit 1
else
  echo "✅ 未打包 dsh（纯壳）"
fi

# 5. version.json
VERSION_JSON_RES="${RESOURCES}/version.json"
if [ -f "$VERSION_JSON_RES" ]; then
  echo "✅ desktop version: $(node -e "console.log(JSON.parse(require('fs').readFileSync('${VERSION_JSON_RES}','utf8')).version)")"
else
  echo "✅ desktop version: 1.0.0 (embedded in asar)"
fi

# 6. icon
ICON="${RESOURCES}/icon.icns"
if [ -f "$ICON" ]; then
  echo "✅ icon.icns: $(ls -lh "$ICON" | awk '{print $5}')"
else
  echo "⚠️  icon.icns not found"
fi

echo ""
echo "✅ All checks passed!"
```

- [ ] **Step 9: 全量验证**

Run: `pnpm run typecheck && pnpm run test && pnpm run build`
Expected: PASS 全部

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: 清理打包流水线（去 dsh 打包，纯壳 + 受管运行时）"
```

---

### Task 10: 文档更新（AGENTS.md + README + spec 校对）

**Files:**

- Modify: `AGENTS.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: 无
- Produces: 文档与实现一致

- [ ] **Step 1: 更新 AGENTS.md**

把以下段落改写为纯壳架构（保持 AGENTS.md 为单一信息源）：

- §1 定位：删除「用户无需安装 Node.js」，改为「缺 Node 时自动从国内镜像安装到用户目录」
- §2.1 三层架构图 → 增加 Layer 0 环境初始化
- §2.3 数据流图：spawn 来源改为「系统/受管 Node + 受管 dsh」
- §3.1 main.ts 关键路径：`boot()` 流程改为 闪屏 → resolveNode → ensureManagedDsh → host.start
- §3.1 dsh 启动策略：`resolveDshEntry` 两路径 → 改为 `resolveNode()`（系统 node ≥18 / 受管 v24 LTS）与受管 dsh 安装
- §3.2 新增 `node-manager.ts` 小节（检测/下载/SHA256/解压/冒烟/受管 dsh）
- §3.3 新增 `boot-window.ts` 小节（闪屏 + 固定桥）
- §6 打包与分发：删除 prepare:dsh 描述、extraResources dsh 部分、内嵌 dsh 依赖节；包体从 ~287MB 改 ~90MB
- §8 兼容性：DSH 版本改为「跟随 npm latest，首次启动安装」
- §9 已知问题：版本角标 dsh 版本改为运行时读取受管目录
- 命令表：删 `prepare:dsh`，加 `test`；`dist:*` 链更新

- [ ] **Step 2: 更新 README.md**

概述部分同步：纯壳 + 首次启动自动装 Node/dsh（国内镜像）+ 进度闪屏；删除「用户无需安装 Node.js」表述。

- [ ] **Step 3: 校对 spec**

`docs/spec-node-runtime.md` 与实现对照，修正偏差（如有）。

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md README.md docs/spec-node-runtime.md
git commit -m "docs: 更新架构文档为纯壳方案"
```

---

### Task 11: 完成前检查

**Files:**

- 无（验证）

**Interfaces:**

- Consumes: 全部

- [ ] **Step 1: 静态检查**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 2: 单元测试**

Run: `pnpm run test`
Expected: PASS（全部用例）

- [ ] **Step 3: 构建**

Run: `pnpm run build`
Expected: PASS，`lib/` 含 `main.mjs`、`preload.mjs`、`boot-preload.mjs`

- [ ] **Step 4: 开发模式冒烟**

Run: `pnpm run dev:desktop`
Expected: 本机有系统 Node（v22）→ 直接复用，闪屏短暂显示后进入主窗口，版本角标显示 `DSH Desktop v1.0.0` 与运行时读取的 dsh 版本（受管安装后会显示）。首次会联网受管安装 dsh 到 `~/Library/Application Support/dsh-desktop/dsh/`。

- [ ] **Step 5: 受管 Node 路径验证（可选，有条件时）**

```bash
PATH=/usr/bin:/bin pnpm run dev:desktop   # 临时隔离 PATH 模拟无 Node
```

Expected: 闪屏显示下载进度 → 校验 → 安装 → 启动 dsh。

- [ ] **Step 6: 打包体积验证**

```bash
pnpm run build && electron-builder --dir --mac -c apps/desktop/electron-builder.config.cjs
du -sh "dist/mac-arm64/DSH Desktop.app"
```

Expected: 明显小于原 ~287MB（纯 Electron 体积，无 dsh 目录）。

- [ ] **Step 7: 最终 commit（如有遗漏改动）**

```bash
git status   # 确认无未提交改动；如有则提交
```

---

## 自审清单

- [x] **Spec 覆盖**：D1（Task 7/8 受管 dsh + --expose-internals）、D2（Task 5 userData/node）、D3（Task 5 SHA256）、D4（Task 4 系统 ≥18）、D5（Task 5 npm 镜像注入）、D6（Task 6 闪屏）、D7（Task 8 运行时版本）、打包清理（Task 9）、文档（Task 10）、验收（Task 11）。
- [x] **占位扫描**：无 TBD；测试代码均为具体用例。
- [x] **类型一致性**：`NodeProgress.stage` 联合类型在 Task 2/5/6/8 一致；`NodeInfo`/`NodeVersionsConfig` 跨任务一致；`spawnDshWeb` 新签名在 Task 7 定义、Task 8 消费。
