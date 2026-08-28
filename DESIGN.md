# DSH Desktop 设计文档

> 为 DeepSeek Harness 提供桌面客户端入口，纯 Electron 壳，零修改 DSH 核心

## 1. 项目定位

DSH Desktop 是一个**轻量 Electron 壳**，在 DeepSeek Harness 官方 `dsh web` 之上提供桌面化体验。

**核心原则：**

- 不修改 DSH 核心代码，仅作为 npm 依赖引入
- 所有功能保持与原生 `dsh web` 一致
- 只加一个 Electron 桌面入口：窗口管理 + 系统托盘 + 子进程管理
- 配套一键打包流水线，支持 macOS / Windows / Linux
- 用户无需安装 Node.js（内嵌 Node.js + dsh 依赖）

## 2. 架构

### 2.1 三层架构

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Electron 主进程 (main process)         │
│  窗口管理 | 系统托盘                              │
│  子进程 spawn | 安全策略                          │
│  resolveDshEntry() → 优先内嵌 dsh，兜底 npx      │
├─────────────────────────────────────────────────┤
│  Layer 2: dsh web 子进程 (child process)          │
│  process.execPath + ELECTRON_RUN_AS_NODE=1       │
│  --expose-internals 启动 dsh（HMR 需要）          │
│  监听 127.0.0.1:随机端口                          │
│  输出 "dsh web: http://127.0.0.1:XXXXX"         │
│  ─── 所有 Harness 核心逻辑在这里运行 ───          │
├─────────────────────────────────────────────────┤
│  Layer 3: Web 渲染器 (renderer process)           │
│  Electron 窗口加载子进程的 URL                     │
│  通过 contextBridge 暴露固定 API                  │
│  沙箱化运行，无通用 IPC 逃逸                      │
└─────────────────────────────────────────────────┘
```

### 2.2 与 DSH 官方的关系

```
DSH 官方 (npm)                       DSH Desktop (本项目)
@deepseek-ai/dsh                     ┌──────────────────────┐
┌──────────────────────┐            │  apps/desktop/        │
│  dsh web             │  spawn ──► │    Electron 壳        │
│  Web 前端             │  load  ──►│    main.ts            │
│  58 个核心包          │            │    preload.ts         │
│  Cordis 框架          │            │    host-supervisor.ts │
│                      │            │    window-lifecycle.ts│
│                      │            │  scripts/             │
│                      │            │    prepare-dsh.ts     │
│                      │            │    package-dmg.sh     │
└──────────────────────┘            └──────────────────────┘
```

**关键决策：DSH 是 npm 依赖，不是子模块，不是 fork。**

| 方式 | 说明 | 选型 |
| ------ | ------ | ------ |
| npm 依赖 | `@deepseek-ai/dsh` 发布到 npm，桌面端直接引用 | ✅ **当前方案** |
| 子模块 | git submodule 引用 DSH 仓库 | ❌ 维护负担大 |
| 复制源码 | 把整个 DSH 仓库复制进来 | ❌ 不可维护 |

### 2.3 数据流

```
用户操作
    ↓
 Electron 主进程                   子进程 (dsh web)
 ┌───────────────┐                ┌──────────────────┐
 │ 窗口关闭 → 隐藏  │              │  dsh web          │
 │ 托盘点击 → 恢复  │  spawn +     │  监听随机端口      │
 │ 退出 → 停子进程  │  stdout      │  输出就绪 URL     │
 │                │  ────────►   │                  │
 │ 渲染器 ←→ IPC ←→│              │  Web 服务         │
 └───────────────┘                └──────────────────┘
        │                                │
        │  contextBridge                 │  HTTP
        │  (固定方法)                     │
        ▼                                ▼
 ┌──────────────────────────────────────────┐
 │  Web 渲染器 (Electron BrowserWindow)       │
 │  加载 http://127.0.0.1:XXXXX              │
 │  完全相同的 dsh Web 前端                    │
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

**窗口配置：**

- 标准 macOS 原生窗口（`frame: true`，默认）
- `sandbox: true`，`contextIsolation: true`，`nodeIntegration: false`
- 最小尺寸 960×640
- 关闭时隐藏到托盘，非退出

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

- **ReadinessParser**：逐行解析 stdout，匹配 `dsh web:` 前缀提取 URL，拒绝非 loopback URL
- **超时控制**：90s 启动超时，5s 关闭宽限期
- **SIGTERM → SIGKILL**：优雅关闭，超时后强制终止
- **意外退出处理**：子进程非预期退出时自动退出桌面应用
- **输出缓冲**：保留最多 32KB 启动输出用于诊断

### 3.3 window-lifecycle.ts — 窗口生命周期

```
窗口关闭 → event.preventDefault() → 隐藏窗口
托盘点击 → 恢复窗口并聚焦
显式退出 → 停子进程 → 释放应用
```

**关键设计：**

- 窗口关闭不退出，托盘中常驻
- 多次退出请求合并（pendingQuit 共享）
- 窗口重建时等待 Host 就绪
- 安装器退出信号（`--dsh-installer-quit`）特殊处理
- 单实例锁：`app.requestSingleInstanceLock()`

### 3.4 preload.ts — 沙箱桥接

```
sandbox: true 的渲染器
    │
    ├── dshDesktop.platform              → 'darwin' | 'win32' | 'linux'
    └── dshDesktop.workspace.pickDirectory() → 目录选择器
```

**安全模型：**

- `sandbox: true`，渲染器无法访问 Node.js API
- `contextBridge` 只暴露固定方法，没有通用 IPC 通道
- 所有权限请求被拒绝（`hardenSession()`）
- 导航限制：只允许加载 Host 同源 URL，外部链接走系统浏览器

## 4. 打包与分发

### 4.1 内嵌 dsh 依赖

用户无需安装 Node.js。打包流程：

```
pnpm run prepare:dsh
  → 在 /tmp/dsh-bundle-{timestamp} 创建临时项目
  → pnpm install @deepseek-ai/dsh（node-linker=hoisted）
  → cp -RL 复制到 apps/desktop/resources/dsh/
  → 打平 .pnpm/ 虚拟 store
  → 冒烟测试：dsh --version
```

产物：`resources/dsh/node_modules/`（193 个顶层依赖，~260MB）

### 4.2 electron-builder 配置

```cjs
// 核心配置
files: ["lib/**", "package.json", "resources/icon.svg", "build/icon.png"]
extraResources: [
  { from: "resources/dsh/node_modules",  to: "dsh/node_modules" },
  { from: "resources/dsh/package.json",  to: "dsh/package.json" },
]
```

### 4.3 打包脚本

| 命令 | 产出 |
| ------ | ------ |
| `pnpm run dist:mac` | `.app` + DMG（arm64） |
| `pnpm run dist:win` | NSIS 安装器（x64） |
| `pnpm run dist:linux` | AppImage（x64） |
| `pnpm run dist:all` | 全部平台 |

**macOS 特殊处理：** electron-builder 的 DMG 目标因 `@electron/get` 兼容性问题不可用，改由 `package-dmg.sh` 脚本用 `hdiutil` 制作。

### 4.4 产物

| 平台 | 产物 | 大小 |
| ------ | ------ | ------ |
| macOS | `DSH Desktop-{version}-arm64.dmg` | ~287MB |
| Windows | `DSH Desktop-{version}-setup-x64.exe` | TBD |
| Linux | `DSH Desktop-{version}-x64.AppImage` | TBD |

## 5. 项目结构

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
│   │   └── package-dmg.sh     # macOS DMG 打包
│   ├── resources/             # 图标
│   ├── build/                 # 构建图标
│   ├── electron-builder.config.cjs
│   ├── tsdown.config.ts
│   ├── tsconfig.json
│   └── package.json
├── DESIGN.md
├── README.md
├── LICENSE
└── package.json               # workspace 根配置
```

## 6. 开发工作流

```bash
# 首次
pnpm install
pnpm run build

# 开发
pnpm run dev:desktop

# 类型检查
pnpm run typecheck

# 打包
pnpm run dist:mac              # macOS DMG
pnpm run dist:win              # Windows NSIS
pnpm run dist:all              # 全平台
```

## 7. 与 DSH 版本兼容性

| DSH 版本 | 桌面端兼容性 |
|----------|-------------|
| 0.1.1-rc.2 | 兼容 ✅（当前） |

桌面端只需关注 `dsh web` 的启动接口和就绪协议，只要这两个不破坏性变更，桌面端就不需要改。

## 8. 已知问题

- **代码签名**：未配置签名证书，macOS 会提示"无法验证开发者"，需付费 Apple Developer 账号。DMG 内附 `移除安全验证.command` 脚本可一键绕过
- **自动更新**：`electron-updater` 未集成，后续版本可通过 GitHub Releases 实现静默更新
