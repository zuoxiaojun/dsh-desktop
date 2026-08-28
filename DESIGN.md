# DSH Desktop 设计文档

> 为 DeepSeek Harness 提供桌面客户端入口

## 1. 项目定位

DSH Desktop 是一个**轻量 Electron 壳**，在 DeepSeek Harness 官方 `dsh web` 之上提供桌面化体验。

**核心原则：**

- 不修改 DSH 核心代码
- 所有功能保持与原生 `dsh web` 一致
- 只加一个 Electron 桌面入口
- 方便后续跟随 DSH 官方更新

## 2. 架构设计

### 2.1 三层架构

```
┌─────────────────────────────────────────────────┐
│  Layer 1: Electron 主进程 (main process)         │
│  窗口管理 | 系统托盘 | 自动更新                   │
│  子进程管理 | IPC 桥接                           │
├─────────────────────────────────────────────────┤
│  Layer 2: dsh web 子进程 (child process)          │
│  npx @deepseek-ai/dsh web (或本地构建)            │
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
DSH 官方源码                          DSH Desktop
deepseek-ai/deepseek-harness         我们的项目
┌──────────────────────┐            ┌──────────────────────┐
│  apps/cli/           │            │  apps/desktop/        │
│    dsh web           │  ──使用──►  │    Electron 壳        │
│  apps/web/           │            │    main.ts            │
│    Web 前端           │  ──加载──►  │    preload.ts         │
│  packages/           │            │    host-supervisor.ts │
│    58 个核心包        │  不修改     │    window-lifecycle.ts│
│  vendor/             │            │                      │
│    Cordis 框架        │  不修改     │  scripts/            │
└──────────────────────┘            │    构建脚本           │
                                    └──────────────────────┘
```

**关键决策：DSH 官方源码作为依赖，不复制进项目。**

| 方案 | 说明 | 选型 |
| --- | --- | --- |
| 复制源码 | 把整个 DSH 仓库复制进来 | ❌ 维护负担大 |
| npm 依赖 | 通过 `npx @deepseek-ai/dsh web` 或本地构建引用 | ✅ **推荐** |
| 子模块 | git submodule 引用 DSH 仓库 | ⚠️ 可选 |

**推荐方案**：开发时引用本地 DSH 仓库的构建产物，生产时通过 `npx @deepseek-ai/dsh web` 或发布时打包内置。

### 2.3 数据流

```
用户操作
    ↓
 Electron 主进程                    子进程 (dsh web)
 ┌─────────────────┐              ┌──────────────────┐
 │ 窗口关闭 → 隐藏  │              │  dsh web          │
 │ 托盘点击 → 恢复  │  spawn +     │  监听随机端口      │
 │ 退出 → 停子进程  │  stdout      │  输出就绪 URL     │
 │                  │  ────────►  │                  │
 │ 渲染器 ←→ IPC ←→ │              │  Web 服务         │
 └─────────────────┘              └──────────────────┘
        │                                 │
        │  contextBridge                  │  HTTP
        │  (固定方法)                       │
        ▼                                 ▼
 ┌──────────────────────────────────────────┐
 │  Web 渲染器 (Electron BrowserWindow)       │
 │  加载 http://127.0.0.1:XXXXX              │
 │  完全相同的 Web 前端                        │
 └──────────────────────────────────────────┘
```

## 3. 当前 Studio 项目的设计优点分析

### 3.1 HostSupervisor — 子进程生命周期管理

**文件：** `apps/desktop/src/host-supervisor.ts`

```
HostSupervisor
├── start()      → 启动一代 Host，等待就绪 URL
├── restart()    → 停止当前代，启动新的
├── shutdown()   → 永久关闭
└── current      → 当前活跃的 HostGeneration
    ├── id: number     (单调递增)
    └── origin: string  (http://127.0.0.1:XXXXX)
```

**关键设计：**

- **代（Generation）管理**：每次重启递增 ID，旧代被标记为停止
- **ReadinessParser**：逐行解析 stdout，匹配 `dsh web:` 前缀提取 URL
- **超时控制**：90s 启动超时，5s 关闭宽限期
- **意外退出处理**：子进程非预期退出时自动退出桌面应用
- **SIGTERM → SIGKILL**：优雅关闭，超时后强制终止

**优点：** 健壮的子进程管理，可应对启动失败、崩溃、重启等场景。

### 3.2 窗口生命周期

**文件：** `apps/desktop/src/window-lifecycle.ts`

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

**优点：** 用户体验好，类似微信/QQ 的托盘常驻模式。

### 3.3 安全模型

**文件：** `apps/desktop/src/preload.ts`

```
sandbox: true 的渲染器
    │
    ├── contextBridge.exposeInMainWorld('dshDesktop', ...)
    │     只暴露固定方法，没有通用 IPC
    │
    ├── 目录选择 → dialog.showOpenDialog（主进程）
    ├── 外观设置 → 读写 JSON 文件
    ├── 插件操作 → 序列化事务 + 快照回滚
    └── 更新 → electron-updater
```

**优点：** 沙箱渲染器无法访问 Node.js API，所有操作通过固定 IPC 通道，安全性高。

### 3.4 渲染器导航

**文件：** `apps/desktop/src/renderer-navigation.ts`

```
desktopRendererUrl({
  origin: 'http://127.0.0.1:54321',
  platform: 'darwin',
  primaryPage: 'plugin-center',
  previousUrl: '...',
})
    ↓
    http://127.0.0.1:54321/?dsh-desktop-platform=darwin
    &dsh-primary-page=plugin-center
    &dsh-plugin-center-view=installed
```

**优点：** 通过 URL 参数传递平台信息，不影响 Host 核心逻辑。

### 3.5 窗口替换过渡

**文件：** `apps/desktop/src/window-reload-transition.ts`

```
Host 重启时：
1. 截取当前窗口截图
2. 创建 WebContentsView 显示截图
3. 后台加载新 Host
4. 新页面渲染完成后移除截图
```

**优点：** 插件安装/卸载导致 Host 重启时，用户不会看到白屏或闪烁。

### 3.6 IPC 桥接协议

**文件：** `apps/desktop/src/desktop-bridge-contract.ts`

固定通道集合，覆盖：

| 通道 | 用途 |
| --- | --- |
| `workspace:pick-directory` | 目录选择器 |
| `appearance:get/save/reset` | 外观设置 |
| `updates:get/check/download/install` | 自动更新 |
| `catalog:list/refresh/detail` | 插件目录 |
| `preset-square:list/detail/install` | Preset 广场 |
| `plugin-operation:start/get` | 插件操作 |
| `plugin-recovery:get/retry/export` | 恢复操作 |

**优点：** 所有 IPC 通道常量集中管理，类型安全，渲染器无法发明新通道。

### 3.7 外观存储

**文件：** `apps/desktop/src/appearance-storage.ts`

```
appearance.json 文件结构：
{
  builtinTheme: 'official' | null,
  imageDataUrl: string | null,
  focusY: number,
  glassStrength: number,
  palette: [string, string, string, string]
}
```

**优点：** 简单文件存储，不依赖数据库，读写原子操作。

### 3.8 自动更新

**文件：** `apps/desktop/src/update-controller.ts`

- 基于 `electron-updater`
- 发布后 5s 延迟检查
- 状态机：`idle → checking → available → downloading → ready → install`
- 安装前自动停 Host 进程

**优点：** 标准 electron-updater 方案，无需自建更新服务。

## 4. 当前 Studio 项目的过度设计（我们不需要的）

以下功能是 Studio 项目特有的，我们**保留选项**但不一定需要：

| 功能 | 说明 | 决策 |
| --- | --- | --- |
| **插件中心** | npm 插件发现、下载、安装、恢复 | 可用但非必须 |
| **Preset 广场** | Agent Preset 自动安装 | 可用但非必须 |
| **应用中心** | 独立 AI 应用入口 | 非必须 |
| **恢复安全模式** | 插件操作失败后的恢复流程 | 非必须 |
| **插件快照回滚** | 操作前快照，失败后恢复 | 非必须 |
| **BrandBadge** | 侧栏品牌标签 | 需要但简单 |
| **视觉增强** | 图片自动路由视觉模型 | 非必须 |

## 5. 从零重构方案

### 5.1 项目结构

```
dsh-desktop/
├── apps/
│   └── desktop/          # Electron 桌面应用（唯一入口）
│       ├── src/
│       │   ├── main.ts           # 主进程入口
│       │   ├── preload.ts        # 沙箱桥接
│       │   ├── host-supervisor.ts # 子进程管理
│       │   ├── window-lifecycle.ts # 窗口生命周期
│       │   ├── renderer-navigation.ts # URL 导航
│       │   ├── update-controller.ts  # 自动更新
│       │   └── appearance-storage.ts # 外观存储
│       ├── resources/           # 图标、恢复页面
│       ├── build/               # 构建图标
│       ├── scripts/             # 构建脚本
│       ├── package.json
│       └── tsconfig.json
├── DESIGN.md                # 设计文档
├── README.md                # 项目说明
├── LICENSE                  # MIT
├── package.json             # 根 package.json
└── .gitignore
```

### 5.2 核心文件清单

| 文件 | 职责 | 来源 |
| --- | --- | --- |
| `main.ts` | Electron 主进程入口 | 参考 Studio 精简 |
| `preload.ts` | contextBridge 沙箱桥接 | 参考 Studio 精简 |
| `host-supervisor.ts` | 子进程生命周期管理 | 复用 Studio 设计 |
| `window-lifecycle.ts` | 窗口关闭/恢复/退出 | 复用 Studio 设计 |
| `renderer-navigation.ts` | URL 参数组合 | 参考 Studio 精简 |
| `update-controller.ts` | 自动更新状态机 | 参考 Studio 精简 |
| `appearance-storage.ts` | 外观设置持久化 | 参考 Studio 精简 |

### 5.3 与 DSH 官方的集成方式

```
开发模式：
  dsh-desktop/
    ├── electron 启动
    ├── spawn('node', ['path/to/dsh-repo/apps/cli/lib/bin.js', 'web', ...])
    └── 加载 http://127.0.0.1:XXXXX

生产模式（打包）：
  方案 A：npx @deepseek-ai/dsh web（需要用户安装 Node.js）
  方案 B：打包内置 dsh 的 node_modules（推荐，类似 Studio）
  方案 C：内置 Node.js + dsh 的可执行文件（单文件分发）
```

**推荐方案 B**：打包时通过 `pnpm` 安装 `@deepseek-ai/dsh` 及其依赖到 `resources/host/` 目录，打包发布。

### 5.4 与 DSH 官方同步策略

1. **不 fork DSH 源码**，只作为 npm 依赖或构建时引用
2. 更新 DSH 版本时：

   ```
   pnpm update @deepseek-ai/dsh               # 升级 CLI
   pnpm update @deepseek-ai/dsh-web-frontend   # 升级 Web 前端
   pnpm run build                              # 重新构建
   ```

3. 无需合并代码，无需处理冲突

### 5.5 开发工作流

```sh
# 1. 克隆 DSH 官方源码（用于开发）
git clone https://github.com/deepseek-ai/deepseek-harness.git ../dsh

# 2. 构建 DSH（第一次或升级后）
cd ../dsh
pnpm install
pnpm run build

# 3. 启动桌面开发
cd ../dsh-desktop
pnpm install
pnpm run dev:desktop
```

## 6. 后续计划

### Phase 1: 基础壳（当前）

- Electron 窗口加载本地 `dsh web`
- 系统托盘
- 窗口关闭隐藏
- 自动更新框架

### Phase 2: 桌面增强

- 外观设置（背景主题）
- 原生窗口样式（macOS/Windows/Linux）
- 窗口最大化/最小化/恢复

### Phase 3: 插件与 Preset（可选）

- 简化版插件中心
- Preset 广场
- 应用中心

## 7. 关于当前项目

当前项目（`dsh-desktop/`）是从 Studio 项目复制而来，包含了完整的 58 个核心包和大量 Studio 特有的功能。如果要从零开始，这些文件可以全部清理，只保留必要的设计文档，然后用 Electron 重新搭建。

## 8. 与 DSH 官方版本兼容性

| DSH 版本 | 桌面端兼容性 |
| --- | --- |
| 0.1.0-rc.8+ | 兼容（持续验证） |
| 0.1.1-rc.1 | 兼容 ✓ |
| 0.1.1-rc.2 | 兼容 ✓（当前） |

桌面端只需关注 `dsh web` 的启动接口和就绪协议，只要这两个不破坏性变更，桌面端就不需要改。
