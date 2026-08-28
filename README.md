# DSH Desktop

> DeepSeek Harness 的桌面客户端

DSH Desktop 是一个轻量 Electron 壳，在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 官方 `dsh web` 之上提供桌面化体验。

**核心理念：只加一个桌面入口，不改一行 DSH 核心代码。**

## 快速开始

```sh
# 安装依赖
pnpm install

# 构建并启动桌面应用
pnpm run dev:desktop

# 按 --rebuild 强制重新构建
pnpm run dev:desktop:rebuild
```

### 环境要求

- Node.js >= 22
- pnpm >= 11
- macOS / Windows / Linux

## 项目结构

```
dsh-desktop/
├── apps/
│   └── desktop/           # Electron 桌面应用
│       ├── src/
│       │   ├── main.ts              # 主进程入口（窗口、托盘、子进程）
│       │   ├── preload.ts           # 沙箱桥接（contextBridge）
│       │   ├── host-supervisor.ts   # dsh web 子进程生命周期管理
│       │   └── window-lifecycle.ts  # 窗口关闭/隐藏/退出
│       ├── scripts/
│       │   └── dev-desktop.ts       # 开发启动器
│       ├── lib/                     # 构建产物（gitignored）
│       ├── resources/               # 图标资源
│       ├── build/                   # 打包图标
│       ├── electron-builder.config.cjs
│       ├── tsdown.config.ts
│       └── tsconfig.json
├── DESIGN.md              # 设计文档
├── README.md              # 项目说明
├── LICENSE                # MIT
├── package.json
├── pnpm-workspace.yaml
└── .gitignore
```

## 架构

```
Electron 主进程 ←→ dsh web 子进程 ←→ Web 渲染器
```

1. **Electron 主进程** — 管理窗口、系统托盘、子进程生命周期
2. **dsh web 子进程** — `npx @deepseek-ai/dsh web`，监听随机端口
3. **Web 渲染器** — 沙箱化的浏览器窗口，加载 dsh web 前端

## 开发命令

| 命令 | 用途 |
| ------ | ------ |
| `pnpm run dev:desktop` | 构建并启动桌面应用 |
| `pnpm run dev:desktop:rebuild` | 强制重建后启动 |
| `pnpm run build` | 构建 TypeScript 源码 |
| `pnpm run typecheck` | 类型检查 |
| `pnpm run package` | 构建并打包（unpacked 目录） |
| `pnpm run dist` | 构建并打包（安装程序） |

## 打包

```sh
# macOS（unpacked 目录）
pnpm run package

# 或直接构建安装程序
pnpm run dist
```

产物在 `dist/` 目录下。

## 设计原则

- **不修改 DSH 核心代码**，DSH 是纯依赖
- **所有功能保持与原生 `dsh web` 一致**，不做功能增强
- **方便跟随 DSH 官方更新**，升级只需 `pnpm update @deepseek-ai/dsh`
- **标准原生窗口**，不搞自定义标题栏、不注入 CSS

详见 [DESIGN.md](./DESIGN.md)。

## 许可证

[MIT](./LICENSE)
