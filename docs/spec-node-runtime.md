# Spec：DSH Desktop 纯壳架构（用户 Node + 缺省自装）

> 状态：已批准设计，已实施。本文记录架构决策，作为实施与后续维护的依据。
> 关联：AGENTS.md（运行时文档单一维护源，以 AGENTS.md 为准）。

## 1. 背景与目标

初始方案（v1）：客户端打包内嵌 `@deepseek-ai/dsh` 全部依赖（`resources/dsh/`，约 260MB），
并用 Electron 自带 Node（`ELECTRON_RUN_AS_NODE=1`）运行。包体约 287MB。

当前方案（v2，2026-08 实施）：

1. **纯壳**：不再打包 dsh 及其依赖，包体约 176MB（纯 Electron ~90MB + 内置 Node ~49MB）。
2. **用用户自己的 Node 优先**：启动时检测系统 Node ≥18，优先直接使用。
3. **内置 Node 运行时**：构建时从国内镜像 npmmirror 下载 Node LTS，SHA256 校验后压缩进安装包（`resources/node-bundle-*`），首次启动直接解压使用，无需联网下载。
4. **缺 Node 自动装（兜底）**：内置包也找不到时，从网络下载到应用数据目录。
5. 保持 dsh 官方行为一致（含 HMR，依赖 `--expose-internals`）。

## 2. 关键决策

| # | 决策 | 理由 |
| --- | ------ | ------ |
| D1 | dsh 改为**受管安装**：先引导 pnpm（`node <npm-cli> install --prefix <userData>/tools/pnpm pnpm`，走镜像），再 `node pnpm.cjs add @deepseek-ai/dsh --ignore-scripts --store-dir <userData>/pnpm-store`，随后 `node --expose-internals <dsh入口> web` 直接启动 | 设计稿原写 `npx/npm exec`，但 dsh 的 HMR 需要 `--expose-internals`，而 npx/npm exec 不会把该 flag 传给 bin 脚本 → dsh 起不来。受管安装等价满足「纯壳 + 走国内镜像」，且：跨平台无 `.cmd`/shell 坑、dsh 版本可直接从受管目录 package.json 读取（角标解决）、更新可显式控制。**选 pnpm 而非 npm**：npm 首次安装实测 ~8 分钟，pnpm 硬链接 store 实测 ~60-90 秒（提速 ~5x）；`--ignore-scripts` 规避 pnpm 10+ 的 `ERR_PNPM_IGNORED_BUILDS`（dsh 依赖均有预编译二进制，无需构建）。 |
| D2 | Node 安装到 `userData/node/`（用户级，免管理员） | 不动系统、无需提权、卸载即弃。仅客户端内部使用，不污染 PATH。 |
| D3 | Node 版本固定 LTS v24.x（可配置），下载后 SHA256 校验 | LTS 受支持时间长；校验防篡改/防损坏。 |
| D4 | 系统 Node ≥ 18 直接用，不打扰；< 18 视为不可用，自动装受管副本 | dsh 无 engines 声明，18 为保守下限。 |
| D5 | npm registry 与 cache 注入：`npm_config_registry=https://registry.npmmirror.com`、`npm_config_cache=<userData>/npm-cache` | 国内镜像加速；缓存隔离，二次启动秒开，不依赖用户全局 `~/.npm`。 |
| D6 | 闪屏窗口（本地 HTML）承载全部初始化进度 | 下载有真实字节进度；错误态提供「重试」。 |
| D7 | 版本角标 dsh 版本改为运行时读取受管目录 `@deepseek-ai/dsh/package.json` | 构建时不再可知。 |

## 3. 架构总览

```
┌────────────────────────────────────────────────────────┐
│ Layer 0: 环境初始化（首次 / 缺 Node / 缺 dsh 时）     │
│   ① 检测系统 Node ≥18 → 有则直接复用（managed: false）│
│   ② 无系统 Node → 解压内置 node-bundle-* 到 userData/ │
│   ③ 内置包也不可用 → 从 npmmirror 下载 v24 LTS 兜底   │
│   均经 SHA256 校验 → 冒烟验证 → 受管安装 dsh           │
│   全程闪屏（boot-window）实时进度                      │
├────────────────────────────────────────────────────────┤
│ Layer 1: Electron 主进程（壳）                         │
│   resolveNode() → 系统 node 优先 → 内置 → 网络兜底     │
│   窗口 | 托盘 | 子进程 | 安全策略（不变）              │
├────────────────────────────────────────────────────────┤
│ Layer 2: dsh web 子进程                                │
│   node --expose-internals <userData>/dsh/.../bin.js    │
│   --no-open --host 127.0.0.1 --port 0 → 就绪 URL       │
├────────────────────────────────────────────────────────┤
│ Layer 3: Web 渲染器（不变）                             │
└────────────────────────────────────────────────────────┘
```

数据流与原有 Host 监督模型不变：`HostSupervisor` 管理代际、就绪解析、SIGTERM→SIGKILL、
意外退出处理，仅 spawn 来源从「Electron 自带 Node + 打包目录」改为「解析出的系统/受管 Node +
受管 dsh 目录」。

## 4. 模块设计

### 4.1 `src/node-manager.ts`（新增）

纯逻辑模块，可单测。不依赖 electron API（userData 由调用方注入）。

```ts
export interface NodeInfo {
  executable: string;   // node 可执行文件绝对路径
  version: string;      // "v24.15.0"
  managed: boolean;     // true = 本次自动安装的受管副本
  npmCli: string;       // npm-cli.js 绝对路径
}

export interface NodeProgress {
  stage:
    | "detecting"      // 检测系统 Node
    | "using-system"   // 复用系统 Node
    | "downloading"    // 下载中（带字节进度）
    | "verifying"      // SHA256 校验
    | "installing"     // 解压安装
    | "smoke"          // 冒烟验证
    | "installing-dsh" // 受管安装 dsh
    | "ready";
  percent?: number;        // 下载 0-100
  receivedBytes?: number;
  totalBytes?: number;
  detail?: string;         // 状态文案（如 "Node.js v24.15.0"）
}

export interface NodeVersionsConfig {
  version: string;                    // 受管 Node 版本，如 "24.15.0"
  minSystemNode: number;              // 系统 Node 最低主版本，默认 18
  mirrorBase: string;                 // https://registry.npmmirror.com/-/binary/node
  mirrorFallback?: string;            // 备用镜像，如 https://nodejs.org/dist
  checksums: Record<string, string>;  // "darwin-arm64" → sha256
}

export async function resolveNode(options: {
  userDataDir: string;
  config: NodeVersionsConfig;
  desktopDir?: string;       // 查找内置 node-bundle-* 资源
  onProgress?: (p: NodeProgress) => void;
  signal?: AbortSignal;
}): Promise<NodeInfo>

export function bundledNodeArchive(desktopDir: string): string;
export async function installBundledNode(options: {
  userDataDir: string;
  config: NodeVersionsConfig;
  archivePath: string;
  onProgress?: (p: NodeProgress) => void;
}): Promise<NodeInfo>
```

行为：

1. `detectSystemNode()`：PATH 找 `node`（win 用 `where.exe`，posix 用 `which`），跑 `node --version`
   解析主版本。≥ `minSystemNode` 且能找到 npm-cli.js → 返回系统 Node。
2. 否则 `bundledNodeArchive(desktopDir)` 查内置资源（dev 模式：`<desktopDir>/resources/node-bundle-*`，打包模式：`process.resourcesPath/node-bundle-*`）。
   找到 → SHA256 校验 → 解压到 `userData/node/` → 冒烟 → npm-cli 定位。
4. 否则下载受管 Node：
   - 平台映射：`darwin-arm64`/`darwin-x64` → `tar.gz`；`win32-x64` → `zip`；`linux-x64`/`linux-arm64` → `tar.gz`。
   - URL：`{mirrorBase}/v{version}/node-v{version}-{platform}-{arch}.{ext}`。
   - 流式下载到 `userData/.node-tmp-<rand>/`，用 `content-length` 计算百分比，节流上报。
   - SHA256 校验，失败删除重下（≤2 次重试）。
   - 解压：posix 用系统 `tar -xzf`（macOS/Linux 自带）；win 用 PowerShell `Expand-Archive`。
   - 目录重命名为 `userData/node/`（先删旧）。原子性：解压到临时目录再 rename。
   - 冒烟：`node --version`；定位 npm-cli.js。
5. 受管安装 dsh（`ensureDsh`）：
   - 先确保 pnpm：`node <npm-cli> install --prefix <userData>/tools/pnpm pnpm`（一次性，镜像加速，无依赖很快）。
   - 用 pnpm 装 dsh：`node <pnpm.cjs> add @deepseek-ai/dsh --ignore-scripts --store-dir <userData>/pnpm-store --registry https://registry.npmmirror.com`，cwd=`<userData>/dsh`（预写 package.json）。
   - 解析 pnpm `Progress: resolved N, reused N, downloaded N, added N` 行 → 闪屏实时进度（`依赖处理 X/N` / `下载依赖 X 个…`）。
   - 幂等：已存在且 package.json 可读 → 跳过（后续可做显式更新）。
6. 取消：`signal.aborted` 时中止 HTTP 请求、清理临时目录。

npm-cli.js 定位：

- posix：`join(dirname(node), "../lib/node_modules/npm/bin/npm-cli.js")`
- win：`join(dirname(node), "node_modules/npm/bin/npm-cli.js")`
- 找不到 → 回退 `spawn("npm", ...)`（win 带 shell），再失败则报错「Node 缺少 npm」。

### 4.2 `src/boot-window.ts` + `resources/boot.html` + `src/boot-preload.ts`（新增）

- `boot-window.ts`：创建无边框小窗（~460×320，居中，`resizable:false`，`frame:false`），
  `loadFile(boot.html)`，preload 用独立 `boot-preload.mjs`。
  API：`show()` / `update(progress)` / `showError(message, onRetry)` / `close()`。
- `boot.html`：图标 + 标题 + 阶段标签 + 进度条 + 状态文字；错误视图含「重试」按钮。
  内联 CSS/JS（无外部资源），`contextIsolation:true`、`sandbox:true`、`nodeIntegration:false`。
- `boot-preload.ts`：`contextBridge` 暴露固定方法（无通用 IPC）：

  ```ts
  interface BootBridge {
    onProgress(cb: (p: NodeProgress) => void): () => void;
    onError(cb: (e: { message: string }) => void): () => void;
    retry(): void;  // send "dsh-boot:retry" 到主进程
  }
  ```

- IPC 通道（仅闪屏窗口）：`dsh-boot:progress`、`dsh-boot:error`、`dsh-boot:retry`。
  安全模型与主窗口一致，不是 catch-all。

### 4.3 `src/host-supervisor.ts`（改造）

- `spawnDshWeb` 签名改为接收 `nodeExecutable` + `dshEntry`：

  ```
  spawn(nodeExecutable, ["--expose-internals", dshEntry, "web",
    "--no-open", "--host", "127.0.0.1", "--port", "0"], { env: {...env, DSH_DESKTOP: "1"} })
  ```

- 移除 `ELECTRON_RUN_AS_NODE` / `resolveDshEntry()` / 打包路径逻辑（不再需要）。
- 其余（ReadinessParser、代际、超时、SIGTERM→SIGKILL）不变。

### 4.4 `src/main.ts`（改造）

启动流程：

```
app.whenReady()
 → boot()
   → createBootWindow() + show()
   → resolveNode({userDataDir, desktopDir, ...})  // 系统→内置→网络兜底，含 ensureDsh，全程进度
   → createHostSupervisor({ spawnHost: () => spawnDshWeb(node) })
   → hardenSession(); registerIpcHandlers()
   → createDesktopLifecycle(...)（loadHost 等不变）
   → host.start()           // 首次可能较慢（无进度，闪屏显示"启动 dsh…"）
   → bootWindow.close()
   → createTray()
   → lifecycle.showWindow()
```

- 删除 `resolveDshEntry()` / `readDshVersion()`（构建时）。
- `DSH_VERSION` 改为启动后读受管 dsh 的 package.json：
  `readFileSync(join(userData, "dsh/node_modules/@deepseek-ai/dsh/package.json"))`，读不到则角标只显示桌面版。
- 错误路径：`resolveNode`/`host.start` 抛错 → 闪屏 `showError` + 重试按钮；重试重新执行失败阶段；
  用户选择退出则正常退出流程。
- 下载期间的退出：AbortController 取消下载；`before-quit`/托盘退出逻辑不变。

### 4.5 `resources/node-versions.json`（新增）

```json
{
  "version": "24.15.0",
  "minSystemNode": 18,
  "mirrorBase": "https://registry.npmmirror.com/-/binary/node",
  "checksums": {
    "darwin-arm64": "<sha256>",
    "darwin-x64": "<sha256>",
    "win32-x64": "<sha256>",
    "linux-x64": "<sha256>",
    "linux-arm64": "<sha256>"
  }
}
```

发布新版本时更新版本号与校验和。checksum 可从
`{mirrorBase}/v{version}/SHASUMS256.txt` 获取后填入（构建/发布时人工确认）。

## 5. 打包与清理

- 删除：`apps/desktop/scripts/prepare-dsh.ts`、`apps/desktop/resources/dsh/`（260MB 直接消失）。
- 根 `package.json`：`prepare:dsh` 从 `package`/`dist:*` 脚本链中移除。
- `apps/desktop/package.json`：删除依赖 `@deepseek-ai/dsh`。
- 新增 `scripts/prepare-node.ts`：构建时下载 Node 归档，SHA256 校验后压缩到 `resources/node-bundle-<platform>-<arch>.<ext>`。
- `electron-builder.config.cjs`：
  - 删除 `extraResources` 的 dsh 部分，改为 include Node bundle：
    `{ from: "apps/desktop/resources/", to: ".", filter: ["node-bundle-*"] }`
  - `files` 增加 `resources/boot.html`、`resources/node-versions.json`（boot-preload 由 tsdown 构建进 lib/）。
  - **注意**：`files` 会打进 `app.asar`；运行时 `DESKTOP_DIR`（main.mjs 所在目录的上级）解析到 asar 根，Electron 的 fs shim / `loadFile` / preload 均支持 asar 内路径，因此资源无需松散外置（与旧版 version.json/icon.svg 的处理一致）。
- `tsdown.config.ts`：entry 增加 `src/boot-preload.ts`。
- `scripts/dev-desktop.ts`：fingerprint 的 sources 增加新源文件（node-manager、boot-window、boot-preload、boot.html、node-versions.json）。
- `scripts/verify-app.sh`：删除 dsh 入口/版本/依赖检查；改为检查：
  - `node-versions.json` 存在（松散 Resources **或 asar 内**，asar 用 `grep -q <name> app.asar` 启发式）且 JSON 可解析、含当前平台 checksum
  - `node-bundle-<platform>-<arch>.<ext>` 存在（松散 Resources）
  - `boot.html` 存在（松散或 asar 内）
  - `app.asar` 存在
  - **不包含** `Resources/dsh`（纯壳反向断言）
  - `version.json`、icon 检查保留
  - 删除 dsh --version 冒烟

## 6. 边界与风险

| 风险 | 对策 |
| ------ | ------ |
| 首次启动需联网（仅 dsh） | 闪屏明确提示；安装失败自动重试；最终失败给「重试」按钮。Node 已内置无需联网 |
| 镜像不可达/被墙 | mirrorBase 可配置；构建时 prepare-node.ts 失败可配 mirrorFallback（默认 nodejs.org）；运行时兜底下载同样走镜像/备用 |
| Gatekeeper/SmartScreen | 下载走应用自身 HTTP 代码（非浏览器下载），不产生 quarantine/MOTW 标记，无「无法验证开发者」弹窗；解压免提权 |
| Windows `.cmd`/shell 坑 | 一律 `spawn(node, [...])` 直启绝对路径，不经 shell；npm 操作走 npm-cli.js |
| 校验失败/解压损坏 | SHA256 校验失败删除重下；解压到临时目录再原子 rename |
| 下载中退出 | AbortSignal 取消并清理临时目录 |
| 系统 Node 无 npm | 回退 `spawn("npm")`；再失败报错提示 |
| dsh 更新 | 受管目录每次启动检查 package.json 可读即复用；后续加显式「检查更新」入口（本次不做） |

## 7. 验收

- `pnpm run typecheck` 通过。
- `pnpm run build` 通过，lib/ 含 main.mjs、preload.mjs、boot-preload.mjs。
- `node-manager` 纯逻辑有 vitest 单测（解析/平台映射/校验和匹配/版本比较）。
- `pnpm run dev:desktop` 在本机（已有 Node）冒烟：直接复用系统 Node 启动，无下载流程；受管安装 dsh（npmmirror，~284MB）后 dsh web 就绪（`dsh web: http://127.0.0.1:PORT`），主窗口加载前端 HTTP 200。
- 手动验证路径（有条件的）：无 Node 环境（临时 PATH 隔离）触发下载 + 进度 + 受管安装。
- 打包产物不包含 `dsh/` 目录（app.asar ~140K，纯壳成立）；**体积说明**：解包 .app 约 ~350MB（Electron Frameworks ~298MB + 内置 Node 归档 ~51MB），DMG 压缩后约 ~176MB（原方案 ~287MB DMG 含 dsh）。
