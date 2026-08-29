# AGENTS.md

> DSH Desktop 设计与代理指南（唯一信息源）。人看的概览见 [README.md](./README.md)；本文件是给 AI 代理的完整设计 + 操作说明。所有信息在这里单一维护，不要在别处复述。

## 1. 定位

DSH Desktop 是一个**轻量 Electron 壳**，在 DeepSeek Harness 官方 `dsh web` 之上提供桌面化体验。

**核心原则：**

- **纯壳**：不打包 dsh 及其依赖，运行时用**用户自己的 Node.js** + 受管安装的 `@deepseek-ai/dsh`，升级只跟 npm latest。
- **缺 Node 自动装**：首次启动检测系统 Node，没有（或 < 18）时从**国内镜像 npmmirror** 下载 Node LTS 到用户目录，闪屏全程显示进度。
- 功能与原生 `dsh web` 完全一致，桌面只加「入口」，不做功能增强。
- 只加一个 Electron 桌面入口：窗口管理 + 系统托盘 + 子进程管理 + 环境初始化。
- 一键打包流水线，支持 macOS / Windows / Linux，包体 ~90MB（纯 Electron）。

## 2. 架构

### 2.1 四层架构

```
┌─────────────────────────────────────────────────┐
│  Layer 0: 环境初始化（仅首次 / 缺 Node 时）         │
│  检测系统 Node ≥18 → 无则 npmmirror 下载 v24 LTS    │
│  SHA256 校验 → 解压到 userData/node → 冒烟验证      │
│  → 受管安装 dsh（node npm-cli install --prefix）    │
│  全程闪屏（boot-window）实时进度                     │
├─────────────────────────────────────────────────┤
│  Layer 1: Electron 主进程                         │
│  窗口管理 | 系统托盘 | 子进程 spawn | 安全策略      │
│  resolveNode() → 系统 node 优先，兜底受管 node     │
├─────────────────────────────────────────────────┤
│  Layer 2: dsh web 子进程                           │
│  node --expose-internals <userData>/dsh/.../bin.js │
│  监听 127.0.0.1:0，输出就绪 URL                    │
│  ─── 所有 Harness 核心逻辑在这里运行 ───            │
├─────────────────────────────────────────────────┤
│  Layer 3: Web 渲染器                               │
│  Electron 窗口加载子进程的 URL                      │
│  contextBridge 暴露固定 API，沙箱化，无通用 IPC      │
└─────────────────────────────────────────────────┘
```

### 2.2 与 DSH 官方的关系

DSH 官方 npm 包 `@deepseek-ai/dsh` **不打包进客户端**。客户端启动时用解析出的 Node（系统或受管）执行：

```
node <npm-cli.js> install --prefix <userData>/dsh @deepseek-ai/dsh
```

首次联网安装到用户数据目录（走国内镜像 `registry.npmmirror.com`），之后幂等复用。**关键决策：为什么不用 npx/npm exec？**——dsh 的 HMR 依赖 `--expose-internals`，而 npx/npm exec 不会把该 flag 传给 bin 脚本，dsh 起不来。受管安装 + `node --expose-internals <入口> web` 直接启动，行为与官方完全一致。

### 2.3 数据流

```
用户操作
   ↓
 Electron 主进程              子进程 (dsh web)
 ┌───────────────┐           ┌──────────────────┐
 │ 窗口关闭 → 隐藏  │           │  dsh web          │
 │ 托盘点击 → 恢复  │  spawn +  │  监听随机端口      │
 │ 退出 → 停子进程  │  stdout   │  输出就绪 URL     │
 └───────────────┘  ────────► └──────────────────┘
       │                                  │
       │  contextBridge (固定方法)          │  HTTP
       ▼                                  ▼
 ┌──────────────────────────────────────────┐
 │  Web 渲染器 (BrowserWindow)               │
 │  加载 http://127.0.0.1:XXXXX              │
 │  完全相同的 dsh Web 前端                   │
 └──────────────────────────────────────────┘
```

## 3. 核心模块

### 3.1 main.ts — Electron 主进程

**职责：** 窗口创建、系统托盘、子进程 spawn、环境初始化编排、安全策略、退出流程。

**关键路径：**

```
app.whenReady()
  → boot()
    → createBootWindow()            // 闪屏
    → resolveNode()                 // 系统 Node ≥18 / 受管 v24 LTS，含进度回调
    → ensureManagedDsh()            // 受管安装 @deepseek-ai/dsh（首次联网）
    → createHostSupervisor(spawnDshWeb)
    → hardenSession()               // 拒绝所有权限请求（仅首次，幂等）
    → host.start()                  // 启动 dsh 子进程，等待就绪 URL
    → DSH_VERSION = readManagedDshVersion()   // 运行时读取受管 dsh 版本
    → bootWindow.close()
    → createTray()
    → lifecycle.showWindow()        // 加载 dsh URL
```

**Node 解析策略（node-manager.ts）：**

```
resolveNode()
  → detectSystemNode()
      1. which/where 找 node
      2. node --version 解析主版本 ≥18（config.minSystemNode）
      3. 定位 npm-cli.js（<node>/../lib/node_modules/npm/... 或 win 下 <node>/node_modules/npm/...）
      4. 全部满足 → 返回系统 Node（managed: false）
  → 否则 installManagedNode()
      1. npmmirror 下载 node-v{V}-{platform}-{arch}.{tar.gz|zip}（流式，字节进度）
      2. SHA256 校验（失败删除重下，≤2 次重试）
      3. 系统 tar / PowerShell 解压到 userData/node/（临时目录 + 原子 rename）
      4. node --version 冒烟 + npm-cli 定位
```

**闪屏（boot-window.ts + boot.html + boot-preload.ts）：** 无边框小窗，内联样式/脚本无外部资源；`contextBridge` 只暴露 `onProgress`/`onError`/`retry` 固定方法，IPC 通道 `dsh-boot:progress`/`dsh-boot:error`/`dsh-boot:retry`；错误态显示重试按钮（重试重新执行 boot，先清理已存在的 host）。

**版本策略（resources/node-versions.json）：** `version`（受管 Node 版本）、`minSystemNode`（系统 Node 下限）、`mirrorBase`（镜像根）、`checksums`（平台 → SHA256）。发布新 Node 版本时更新；checksum 从 `{mirrorBase}/v{version}/SHASUMS256.txt` 获取。

**窗口配置：** 标准 macOS 原生窗口（`frame: true` 默认）；`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；最小尺寸 960×640；关闭时隐藏到托盘而非退出。

### 3.2 host-supervisor.ts — 子进程生命周期管理

**代（Generation）管理模型：**

```
HostSupervisor
├── start()      → 启动一代 Host，等待就绪 URL
├── restart()    → 停止当前代，启动新的（递增 ID）
├── shutdown()   → 永久关闭
└── current      → 当前活跃的 HostGeneration
    ├── id: number     (单调递增)
    └── origin: string  (http://127.0.0.1:XXXXX)
```

**关键设计：**

- **ReadinessParser**：逐行解析 stdout，匹配 `dsh web:` 前缀提取 URL，拒绝非 loopback URL。
- **超时控制**：90s 启动超时，5s 关闭宽限期。
- **SIGTERM → SIGKILL**：优雅关闭，超时后强制终止。
- **意外退出处理**：子进程非预期退出时自动退出桌面应用。
- **输出缓冲**：保留最多 32KB 启动输出用于诊断。
- **spawnDshWeb**：`spawn(nodeExecutable, ["--expose-internals", dshEntry, "web", "--no-open", "--host", "127.0.0.1", "--port", "0"])`——不经 shell，Windows 无 `.cmd` 坑。**env 注入完整 PATH**（`hostPathFor`：受管 pnpm bin + node bin + `/usr/local/bin` `/opt/homebrew/bin` `/usr/bin` `/bin` `/usr/sbin` `/sbin` + 原 PATH）——打包后 .app 启动的宿主进程 PATH 只有系统最小集，而 dsh 插件 marketplace 会 `spawnSync("pnpm")`，不注入就 ENOENT。

> **The Host（leading word）**：每一项任务都会碰到 Host——被监督的 `dsh web` 子进程。它绑定 `127.0.0.1:0`，就绪时打印唯一的 **readiness line**：
>
> ```
> dsh web: http://127.0.0.1:PORT
> ```
>
> `ReadinessParser` 断言该行为 loopback HTTP + 显式端口，否则拒绝。Host 在窗口显示前启动；Node 与 dsh 入口由 `resolveNode` + `ensureManagedDsh` 提供。

### 3.3 node-manager.ts — Node 解析与受管安装

纯逻辑模块，不 import electron（userData 由调用方注入），可单测。职责：

- `detectSystemNode(platform, minSystemNode)`：PATH 检测 + 常见安装位置扫描（brew/nvm/volta/fnm，见下）+ 版本判断 + npm-cli 定位。
- `installManagedNode({userDataDir, config, onProgress, signal})`：下载（字节进度）→ SHA256 → 解压 → 冒烟 → 原子落位。
- `ensureManagedDsh({node, userDataDir, ...})`：先引导 pnpm（`node npm-cli install --prefix <userData>/tools/pnpm pnpm`，一次性，走镜像），再用 `node pnpm.cjs add @deepseek-ai/dsh --ignore-scripts --store-dir <userData>/pnpm-store --registry https://registry.npmmirror.com` 安装（cwd=`<userData>/dsh`，预写 package.json）；解析 pnpm 的 `Progress: resolved N, reused N, downloaded N, added N` 行实时更新闪屏进度；**dsh 已存在则直接复用，启动不安装、不联网阻塞**。另提供 `checkDshUpdate(userDataDir)`（非阻塞查 registry latest 并与已装版本比对）与 `installDshUpdate({node,userDataDir,...})`（手动 `pnpm add @deepseek-ai/dsh@latest` 更新，供角标「检查更新」按钮调用）。注入 `npm_config_registry=https://registry.npmmirror.com` 与 `npm_config_cache=<userData>/npm-cache`。
- `resolveNode(options)`：编排入口，返回 `NodeInfo { executable, version, managed, npmCli }`。
- 进度模型 `NodeProgress { stage, percent?, receivedBytes?, totalBytes?, detail? }`，stage 含 detecting/using-system/downloading/verifying/installing/smoke/installing-dsh/ready。

**注意（实现细节）：**

- Node 官方 Windows 归档平台名是 `win` 不是 `win32`（`node-v{V}-win-x64.zip`）。
- posix 下处理 Windows 路径要用 `node:path` 的 `win32` 变体（`resolveNpmCli`/`nodeCandidates`）。
- `installManagedNode` 在 rename 到 `userData/node/` 后需**重新计算** executable 路径（staging 路径已失效）。
- `mkdtempSync` 前先 `mkdirSync(userDataDir, { recursive: true })`。
- **dsh 用 pnpm 而非 npm 的原因**：npm 首次安装 dsh（193 依赖）实测 ~8 分钟，pnpm 硬链接 store 实测 ~60-90 秒（提速 ~5x）。`--ignore-scripts` 必须加：pnpm 10+ 对存在被忽略的构建脚本会以 `ERR_PNPM_IGNORED_BUILDS` 退出码 1 失败，而 dsh 依赖（node-pty/koffi/protobufjs 等）都有预编译二进制，不需要构建脚本（prepare-dsh 时代已用 `--ignore-scripts` 验证可用）。
- **受管安装目录布局**：`<userData>/dsh/`（dsh 根，node_modules 为 pnpm 符号链接，实际文件在 `dsh/node_modules/.pnpm/` 虚拟 store）+ `<userData>/pnpm-store/`（硬链接池）+ `<userData>/tools/pnpm/`（pnpm 本体）。
- `nodeCandidates`：扫描 PATH 之外的常见 node 安装位置（darwin: `/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`、`~/.volta`、nvm/fnm 版本目录按版本降序；win32: `Program Files\nodejs`、`LocalAppData\Programs\nodejs`、`~/.volta`）——macOS 双击 .app 启动时 GUI 环境不继承 shell PATH，必须有此兜底才能找到用户已装的 node。

### 3.4 window-lifecycle.ts — 窗口生命周期

```
窗口关闭 → event.preventDefault() → 隐藏窗口
托盘点击 → 恢复窗口并聚焦
显式退出 → 停子进程 → 释放应用
```

**关键设计：** 窗口关闭不退出，托盘中常驻；多次退出请求合并（pendingQuit 共享）；窗口重建时等待 Host 就绪；安装器退出信号（`--dsh-installer-quit`）特殊处理；单实例锁 `app.requestSingleInstanceLock()`。

### 3.5 preload.ts — 沙箱桥接（主窗口）

```
sandbox: true 的渲染器
    ├── dshDesktop.platform              → 'darwin' | 'win32' | 'linux'
    ├── dshDesktop.versions              → { desktop, dsh }（dsh 运行时读取）
    └── dshDesktop.workspace.pickDirectory() → 目录选择器
```

**安全模型：** `sandbox: true` 让渲染器无法访问 Node.js API；`contextBridge` 只暴露**固定方法**，没有通用 IPC 通道；所有权限请求被拒绝（`hardenSession()`）；导航限制只允许加载 Host 同源 URL，外部链接走系统浏览器。闪屏窗口（boot-preload）同样只暴露固定方法。

## 4. 命令与开发工作流

```
pnpm install
pnpm run dev:desktop           # 构建（仅当指纹变化）+ 启动
pnpm run dev:desktop:rebuild   # 强制重建后启动
pnpm run test                  # vitest 单元测试（node-manager 纯逻辑）
pnpm run typecheck             # tsc --noEmit
pnpm run build                 # tsdown → lib/  (gitignored)
pnpm run package               # 构建 + electron-builder --dir（unpacked）
pnpm run dist:mac              # macOS DMG
pnpm run dist:win              # Windows NSIS
pnpm run dist:linux            # Linux AppImage
pnpm run dist:all              # 全平台
```

`scripts/dev-desktop.ts` 在 `lib/.dev-fingerprint` 缓存指纹（覆盖全部 src 源文件 + boot.html + node-versions.json），仅当变化时才重建。`lib/` 是 gitignored 构建产物——用 `build` 重新生成，不要直接编辑其内容。

## 5. 窗口与生命周期

- **关闭即隐藏，永不退出**：窗口隐藏到托盘（`window-lifecycle.ts`）；显式退出才先停 Host。
- **安全是硬约束**：`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；`preload.ts`/`boot-preload.ts` 只暴露固定桥接方法，无通用 IPC。加能力就走固定桥，不要加 catch-all。

## 6. 打包与分发

**纯壳，不内嵌任何运行时/依赖：**

```
pnpm run build
  → tsdown 产出 lib/（main.mjs、preload.mjs、boot-preload.mjs）
  → electron-builder 打包（files 含 lib/**、resources/boot.html、resources/node-versions.json 等）
```

**electron-builder 核心配置：**

```cjs
files: ["lib/**", "package.json", "resources/icon.svg",
        "resources/version.json", "resources/boot.html",
        "resources/node-versions.json", "build/icon.png"]
```

无 `extraResources`（不打包 dsh/node_modules）。Node 与 dsh 均在**首次运行时**由客户端自己安装到用户数据目录。

**macOS 特殊处理：** electron-builder 的 DMG 目标因 `@electron/get` 兼容性问题不可用，改由手写 `scripts/package-dmg.sh`（`hdiutil`）制作。它在打 DMG 前用**自签名证书**（`DSH Desktop Developer`，写入 login keychain）对 bundle 做 `codesign --force --deep` 深度签名——避免 ad-hoc 签名被较新 macOS 判为「已损坏」。自签名签出的包 Gatekeeper 显示「无法验证开发者/安全性阻止」，**右键 → 打开**可运行；配置 Apple Developer ID + 公证后才可双击直达。

**`dist:*` 步骤顺序**（顺序很重要）：`build` → `electron-builder --dir` → `verify-app.sh` → `package-dmg.sh`。

**产物清理：** `package-dmg.sh` 打完 DMG 后会删除中间产物（`dist/mac`、`dist/mac-arm64`、`builder-debug.yml`、`builder-effective-config.yaml`、`.DS_Store`），`dist/` 里最终只保留 `.dmg`。

**产物：**

| 平台 | 产物 | 大小 |
| ------ | ------ | ------ |
| macOS | `DSH Desktop-{version}-arm64.dmg` | ~90MB（纯 Electron） |
| Windows | `DSH Desktop-{version}-setup-x64.exe` | TBD |
| Linux | `DSH Desktop-{version}-x64.AppImage` | TBD |

## 7. 项目结构

```
dsh-desktop/
├── apps/desktop/              # Electron 桌面应用（唯一入口）
│   ├── src/
│   │   ├── main.ts            # 主进程入口（含启动编排）
│   │   ├── preload.ts         # 主窗口沙箱桥接
│   │   ├── boot-preload.ts    # 闪屏沙箱桥接
│   │   ├── boot-window.ts     # 闪屏窗口
│   │   ├── node-manager.ts    # Node 解析/下载/校验/安装 + 受管 dsh
│   │   ├── host-supervisor.ts # 子进程生命周期管理
│   │   ├── window-lifecycle.ts # 窗口生命周期
│   │   └── *.test.ts          # vitest 单元测试
│   ├── scripts/
│   │   ├── dev-desktop.ts     # 开发启动器（指纹缓存 + 增量构建）
│   │   ├── verify-app.sh      # 打包后验证（纯壳结构检查）
│   │   └── package-dmg.sh     # macOS DMG 打包
│   ├── resources/             # boot.html、icon、版本号、node-versions
│   ├── build/                 # 构建图标（icns/png）
│   ├── vitest.config.ts
│   ├── electron-builder.config.cjs
│   ├── tsdown.config.ts
│   ├── tsconfig.json
│   └── package.json
├── docs/
│   └── spec-node-runtime.md   # 纯壳架构 spec（决策记录）
├── README.md                  # 面向人的概览
├── LICENSE
├── AGENTS.md                  # 本文件
└── package.json               # workspace 根配置
```

## 8. 运行时依赖与兼容性

| 组件 | 策略 |
| ---------- | ------------- |
| Node.js | 系统 Node ≥18 直接复用；否则受管安装 v24 LTS（`node-versions.json` 可配） |
| dsh | 首次启动受管安装 npm latest（国内镜像）；**已装复用；启动异步检查 latest（仅记录，不装）；用户点角标「检查更新」才手动安装并提示重启生效**；版本运行时读取显示 |

- **npm 镜像**：`npm_config_registry=https://registry.npmmirror.com`、`npm_config_cache=<userData>/npm-cache`（不依赖用户全局 `~/.npm`）。
- **Node 下载镜像**：`mirrorBase` 可配，默认 `https://registry.npmmirror.com/-/binary/node`。
- 只要 `dsh web` 的启动接口（`--no-open --host 127.0.0.1 --port 0`）与就绪协议（`dsh web: http://127.0.0.1:PORT`）不破坏性变更，桌面端就不需要改。

## 9. 已知问题

- **代码签名/公证**：未配置 Apple Developer 证书，包用**自签名证书**（`DSH Desktop Developer`）签名（`codesign --verify` 通过、`spctl` rejected、`Authority=DSH Desktop Developer`）。从网上下载会被 Gatekeeper 视为「无法验证开发者 / 安全性阻止」，**右键 → 打开**即可运行；ad-hoc 签名（旧方案）会被判「已损坏」且无法绕过。要「双击直达」需 Apple Developer 证书 + 公证。原「移除安全验证.command」脚本在新 macOS 下无效，已移除不再打包。
- **首次启动需联网**：Node 缺失时下载 Node（~50MB）+ dsh 依赖（pnpm 安装 ~60-90 秒，~270MB 解压）。离线会失败，闪屏给重试按钮。用户可手动装 Node 后重启绕过。
- **宿主进程 PATH**：打包后 .app 启动的 Electron 主进程 PATH 只有系统最小集（`/usr/bin:/bin:/usr/sbin:/sbin`），dsh 宿主继承后其插件 marketplace `spawnSync("pnpm")` 会 ENOENT。修复：spawn dsh 时注入 `hostPathFor` 构造的完整 PATH（受管 pnpm bin 优先 + node bin + 系统常见路径 + 原 PATH），实测最小 PATH 环境下 `pnpm --version` 可正常解析。
- **自动更新**：`electron-updater` 未集成，后续版本可通过 GitHub Releases 实现静默更新。
- **版本角标**：`injectVersionBadge`（`main.ts`）改用 `document.createTextNode` 构建（避开 innerHTML），并在注入前把版本号用 `JSON.stringify` 序列化；保留 MutationObserver 自愈（SPA 导航移除后自动重渲染）与 `DSH_VERSION` 为空时只显示桌面版本一行。`DSH_VERSION` 为**运行时**读取受管 dsh 的 package.json（构建时不可知），在 host 就绪后设置。
- **受管 Node 校验和**：`node-versions.json` 的 checksums 为空时，受管安装会直接报「no SHA256 checksum」——发布前必须从 SHASUMS256.txt 填入，防止静默安装损坏/被篡改的二进制。

## 完成前检查

- `pnpm run typecheck`、`pnpm run build`、`pnpm run test` 均通过。
- 测试套件：vitest，`apps/desktop/src/*.test.ts`；`node-manager.ts` 纯逻辑为主要测试对象（版本解析/归档映射/URL/校验和/npm-cli 定位/下载进度/SHA256/解压/检测）。
