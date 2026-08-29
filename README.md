# DSH Desktop

> DeepSeek Harness 的桌面客户端

DSH Desktop 是一个轻量 Electron 壳，在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 官方 `dsh web` 之上提供桌面化体验。

**核心理念：只加一个桌面入口，不改一行 DSH 核心代码。纯壳，不打包任何运行时。**

## 特性

- **纯壳架构**：不打包 dsh 及依赖（包体 ~90MB），运行时使用**用户自己的 Node.js**
- **缺 Node 自动装**：首次启动检测系统 Node，没有（或版本 < 18）时自动从**国内镜像 npmmirror** 下载 Node LTS 安装到用户目录，闪屏实时显示进度
- **国内镜像加速**：dsh 安装走 `registry.npmmirror.com`，npm 缓存隔离在应用数据目录
- **功能与官方 `dsh web` 完全一致**（含 HMR），桌面只加入口

## 快速开始

```sh
# 安装依赖
pnpm install

# 构建并启动桌面应用
pnpm run dev:desktop

# 按 --rebuild 强制重新构建
pnpm run dev:desktop:rebuild
```

### 开发环境要求

- Node.js >= 18（运行时缺 Node 由客户端自动安装，开发环境需手动装）
- pnpm >= 11
- macOS / Windows / Linux

## 架构

```
环境初始化（缺 Node 时：npmmirror 下载 + SHA256 校验 + 解压到用户目录）
        ↓
Electron 主进程 ←→ dsh web 子进程 ←→ Web 渲染器
```

1. **环境初始化** — 检测系统 Node，缺失时自动安装受管 Node + 受管 dsh，闪屏显示进度
2. **Electron 主进程** — 管理窗口、系统托盘、子进程生命周期、安全策略
3. **dsh web 子进程** — `node --expose-internals <dsh入口> web`，监听随机端口
4. **Web 渲染器** — 沙箱化的浏览器窗口，加载 dsh web 前端

## 项目结构

```
dsh-desktop/
├── apps/
│   └── desktop/           # Electron 桌面应用
│       ├── src/
│       │   ├── main.ts              # 主进程入口（窗口、托盘、启动编排）
│       │   ├── preload.ts           # 主窗口沙箱桥接
│       │   ├── boot-preload.ts      # 闪屏沙箱桥接
│       │   ├── boot-window.ts       # 闪屏窗口（初始化进度）
│       │   ├── node-manager.ts      # Node 检测/下载/校验/安装 + 受管 dsh
│       │   ├── host-supervisor.ts   # dsh web 子进程生命周期管理
│       │   ├── window-lifecycle.ts  # 窗口关闭/隐藏/退出
│       │   └── *.test.ts            # vitest 单元测试
│       ├── scripts/
│       │   ├── dev-desktop.ts       # 开发启动器
│       │   ├── verify-app.sh        # 打包后验证
│       │   └── package-dmg.sh       # macOS DMG 打包
│       ├── resources/               # boot.html、图标、版本号、node-versions.json
│       ├── lib/                     # 构建产物（gitignored）
│       ├── build/                   # 打包图标
│       ├── vitest.config.ts
│       ├── electron-builder.config.cjs
│       ├── tsdown.config.ts
│       └── tsconfig.json
├── docs/
│   └── spec-node-runtime.md   # 纯壳架构 spec（决策记录）
├── AGENTS.md              # 设计与代理指南（唯一信息源）
├── README.md              # 项目说明
├── LICENSE                # MIT
├── package.json
├── pnpm-workspace.yaml
└── .gitignore
```

## 开发命令

| 命令 | 用途 |
| ------ | ------ |
| `pnpm run dev:desktop` | 构建并启动桌面应用 |
| `pnpm run dev:desktop:rebuild` | 强制重建后启动 |
| `pnpm run test` | vitest 单元测试 |
| `pnpm run typecheck` | 类型检查 |
| `pnpm run build` | 构建 TypeScript 源码 |
| `pnpm run package` | 构建并打包（unpacked 目录） |
| `pnpm run dist:mac` / `dist:win` / `dist:linux` / `dist:all` | 构建安装程序 |

## 打包

```sh
# macOS（unpacked 目录 + 验证 + DMG）
pnpm run dist:mac

# Windows NSIS / Linux AppImage / 全平台
pnpm run dist:win
pnpm run dist:linux
pnpm run dist:all
```

产物在 `dist/` 目录下。包体 ~90MB（纯 Electron，不包含 Node/dsh）。

## 设计原则

- **不修改 DSH 核心代码**，dsh 是纯运行时依赖（首次启动受管安装，跟随 npm latest）
- **所有功能保持与原生 `dsh web` 一致**，不做功能增强
- **不打包 Node/dsh**，用用户自己的 Node；缺 Node 自动从国内镜像安装
- **标准原生窗口**，不搞自定义标题栏、不注入 CSS

详见 [AGENTS.md](./AGENTS.md)。

## 许可证

[MIT](./LICENSE)
