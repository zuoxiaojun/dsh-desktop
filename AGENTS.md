# AGENTS.md

> DSH Desktop 设计与代理指南（唯一信息源）。人看的概览见 [README.md](./README.md)；本文件是给 AI 代理的完整设计 + 操作说明。所有信息在这里单一维护，不要在别处复述。

## 1. 定位

DSH Desktop 是一个**轻量 Electron 壳**，在 DeepSeek Harness 官方 `dsh web` 之上提供桌面化体验。

**核心原则：**

- **把 DSH 当纯 npm 依赖**：加桌面行为只改壳（`apps/desktop/src/`），不改 DSH 核心，升级只 bump `@deepseek-ai/dsh`。
- 功能与原生 `dsh web` 完全一致，桌面只加「入口」，不做功能增强。
- 只加一个 Electron 桌面入口：窗口管理 + 系统托盘 + 子进程管理。
- 一键打包流水线，支持 macOS / Windows / Linux。
- 用户无需安装 Node.js（内嵌 Node.js + dsh 依赖）。

## 2. 架构

### 2.1 三层架构

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Electron 主进程                         │
│  窗口管理 | 系统托盘 | 子进程 spawn | 安全策略      │
│  resolveDshEntry() → 优先内嵌 dsh，兜底 npx        │
├─────────────────────────────────────────────────┤
│  Layer 2: dsh web 子进程                           │
│  process.execPath + ELECTRON_RUN_AS_NODE=1        │
│  --expose-internals 启动 dsh（HMR 需要）            │
│  监听 127.0.0.1:随机端口，输出就绪 URL              │
│  ─── 所有 Harness 核心逻辑在这里运行 ───            │
├─────────────────────────────────────────────────┤
│  Layer 3: Web 渲染器                               │
│  Electron 窗口加载子进程的 URL                      │
│  contextBridge 暴露固定 API，沙箱化，无通用 IPC      │
└─────────────────────────────────────────────────┘
```

### 2.2 与 DSH 官方的关系

DSH 官方 npm 包 `@deepseek-ai/dsh` 是纯依赖（非子模块、非 fork）。**关键决策：DSH 是 npm 依赖。**

| 方式 | 说明 | 选型 |
| ------ | ------ | ------ |
| npm 依赖 | `@deepseek-ai/dsh` 发布到 npm，桌面端直接引用 | ✅ 当前方案 |
| 子模块 | git submodule 引用 DSH 仓库 | ❌ 维护负担大 |
| 复制源码 | 把整个 DSH 仓库复制进来 | ❌ 不可维护 |

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

**职责：** 窗口创建、系统托盘、子进程 spawn、安全策略、退出流程。

**关键路径：**

```
app.whenReady()
  → boot()
    → createHostSupervisor(spawnDshWeb)
    → hardenSession()      // 拒绝所有权限请求
    → host.start()         // 启动 dsh 子进程，等待就绪 URL
    → createTray()
    → lifecycle.showWindow()
      → createMainWindow() // 加载 dsh URL
```

**dsh 启动策略：**

```
spawnDshWeb()
  → resolveDshEntry() 检查两个路径：
    1. process.resourcesPath + "dsh/node_modules/..."   // 生产环境
    2. DESKTOP_DIR + "resources/dsh/node_modules/..."    // 开发环境
  → 找到: process.execPath + ELECTRON_RUN_AS_NODE=1 运行
  → 没找到: npx @deepseek-ai/dsh web 兜底
```

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

> **The Host（leading word）**：每一项任务都会碰到 Host——被监督的 `dsh web` 子进程。它绑定 `127.0.0.1:0`，就绪时打印唯一的 **readiness line**：
> ```
> dsh web: http://127.0.0.1:PORT
> ```
> `ReadinessParser` 断言该行为 loopback HTTP + 显式端口，否则拒绝。Host 在窗口显示前启动；`resolveDshEntry` 优先内嵌 dsh，兜底 `npx`。

### 3.3 window-lifecycle.ts — 窗口生命周期

```
窗口关闭 → event.preventDefault() → 隐藏窗口
托盘点击 → 恢复窗口并聚焦
显式退出 → 停子进程 → 释放应用
```

**关键设计：** 窗口关闭不退出，托盘中常驻；多次退出请求合并（pendingQuit 共享）；窗口重建时等待 Host 就绪；安装器退出信号（`--dsh-installer-quit`）特殊处理；单实例锁 `app.requestSingleInstanceLock()`。

### 3.4 preload.ts — 沙箱桥接

```
sandbox: true 的渲染器
    ├── dshDesktop.platform              → 'darwin' | 'win32' | 'linux'
    └── dshDesktop.workspace.pickDirectory() → 目录选择器
```

**安全模型：** `sandbox: true` 让渲染器无法访问 Node.js API；`contextBridge` 只暴露**固定方法**，没有通用 IPC 通道；所有权限请求被拒绝（`hardenSession()`）；导航限制只允许加载 Host 同源 URL，外部链接走系统浏览器。

## 4. 命令与开发工作流

```
pnpm install
pnpm run dev:desktop           # 构建（仅当指纹变化）+ 启动
pnpm run dev:desktop:rebuild   # 强制重建后启动
pnpm run typecheck             # tsc --noEmit
pnpm run build                 # tsdown → lib/  (gitignored)
pnpm run prepare:dsh           # 重新生成捆绑 dsh → resources/dsh  (gitignored)
pnpm run dist:mac              # macOS DMG
pnpm run dist:win              # Windows NSIS
pnpm run dist:linux            # Linux AppImage
pnpm run dist:all              # 全平台
```

`scripts/dev-desktop.ts` 在 `lib/.dev-fingerprint` 缓存指纹，仅当 `src/**` 或配置变化时才重建。`lib/` 和 `resources/dsh/` 是 gitignored 构建产物——用 `build`/`prepare:dsh` 重新生成，而不是直接编辑其内容。

## 5. 窗口与生命周期

- **关闭即隐藏，永不退出**：窗口隐藏到托盘（`window-lifecycle.ts`）；显式退出才先停 Host。
- **安全是硬约束**：`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；`preload.ts` 只暴露固定桥接方法，无通用 IPC。加能力就走固定桥，不要加 catch-all。

## 6. 打包与分发

**内嵌 dsh 依赖（用户无需安装 Node.js）：**

```
pnpm run prepare:dsh
  → 在 /tmp/dsh-bundle-{timestamp} 创建临时项目
  → pnpm install @deepseek-ai/dsh（node-linker=hoisted）
  → cp -RL 复制到 apps/desktop/resources/dsh/
  → 打平 .pnpm/ 虚拟 store
  → 冒烟测试：dsh --version
```

产物：`resources/dsh/node_modules/`（约 193 个顶层依赖，~260MB）。

**electron-builder 核心配置：**

```cjs
files: ["lib/**", "package.json", "resources/icon.svg", "build/icon.png"]
extraResources: [
  { from: "resources/dsh/node_modules",  to: "dsh/node_modules" },
  { from: "resources/dsh/package.json",  to: "dsh/package.json" },
]
```

**macOS 特殊处理：** electron-builder 的 DMG 目标因 `@electron/get` 兼容性问题不可用，改由手写 `scripts/package-dmg.sh`（`hdiutil`）制作。

**`dist:*` 步骤顺序**（顺序很重要）：`prepare:dsh` → `build` → `electron-builder --dir` → `verify-app.sh` → `package-dmg.sh`。

**产物：**

| 平台 | 产物 | 大小 |
| ------ | ------ | ------ |
| macOS | `DSH Desktop-{version}-arm64.dmg` | ~287MB |
| Windows | `DSH Desktop-{version}-setup-x64.exe` | TBD |
| Linux | `DSH Desktop-{version}-x64.AppImage` | TBD |

## 7. 项目结构

```
dsh-desktop/
├── apps/desktop/              # Electron 桌面应用（唯一入口）
│   ├── src/
│   │   ├── main.ts            # 主进程入口
│   │   ├── preload.ts         # 沙箱桥接
│   │   ├── host-supervisor.ts # 子进程生命周期管理
│   │   └── window-lifecycle.ts # 窗口生命周期
│   ├── scripts/
│   │   ├── dev-desktop.ts     # 开发启动器（指纹缓存 + 增量构建）
│   │   ├── prepare-dsh.ts     # 打包 dsh 依赖
│   │   ├── verify-app.sh      # 打包后验证
│   │   └── package-dmg.sh     # macOS DMG 打包
│   ├── resources/             # 图标、版本号、移除安全验证脚本
│   ├── build/                 # 构建图标（icns/iconset/png）
│   ├── electron-builder.config.cjs
│   ├── tsdown.config.ts
│   ├── tsconfig.json
│   └── package.json
├── README.md                  # 面向人的概览
├── LICENSE
├── AGENTS.md                  # 本文件
└── package.json               # workspace 根配置
```

## 8. 与 DSH 版本兼容性

| DSH 版本 | 桌面端兼容性 |
|----------|-------------|
| 0.1.1-rc.2 | 兼容 ✅（当前） |

桌面端只需关注 `dsh web` 的启动接口和就绪协议；只要这两者不破坏性变更，桌面端就不需要改。

## 9. 已知问题

- **代码签名**：未配置签名证书，macOS 会提示「无法验证开发者」，需付费 Apple Developer 账号。DMG 内附 `移除安全验证.command` 脚本可一键绕过。
- **自动更新**：`electron-updater` 未集成，后续版本可通过 GitHub Releases 实现静默更新。
- **版本角标（已修复）**：`injectVersionBadge`（`main.ts`）改用 `document.createTextNode` 构建（避开 innerHTML），并在注入前把版本号用 `JSON.stringify` 序列化；保留 MutationObserver 自愈（SPA 导航移除后自动重渲染）与 `DSH_VERSION` 为空时只显示桌面版本一行；重注入时断开旧观察者，避免 SPA 长会话中观察者累积。注意：模板字符串中的 `${DESKTOP_VERSION}`/`${DSH_VERSION}` 在主进程作用域内被求值，注入渲染器的是实际值——旧的「显示为字面文本」判断不成立。

## 完成前检查

- `pnpm run typecheck` 与 `pnpm run build` 均通过。
- 目前无测试套件，虽装了 `vitest`；`host-supervisor.ts` 是首个补测的合理目标。
