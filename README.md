# DSH Desktop

<p align="center">
  <img src="https://img.shields.io/badge/Desktop-App-2563EB" alt="Desktop App">
  <img src="https://img.shields.io/badge/Electron-Desktop-47848F?logo=electron&logoColor=white" alt="Electron Desktop">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/deepseek-ai/deepseek-harness?color=22C55E" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows-supported-3B82F6" alt="macOS and Windows">
</p>

<p align="center">DSH Desktop 是 <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a> 的桌面客户端，提供完整的 Electron 桌面体验。</p>

## 功能

DSH Desktop 在 DeepSeek Harness 的 Web 工作区基础上，增加了桌面端专有能力：

- **系统托盘常驻** — 关窗不退出，后台继续运行
- **插件中心** — 浏览、搜索、安装与管理 DSH 插件
- **Preset 广场** — 一键安装 Agent Preset 工作流
- **应用中心** — 拥有专属界面与数据的完整 AI 应用
- **主题皮肤** — 内置多套背景主题，支持自定义
- **视觉增强** — 自动路由图片到兼容的视觉模型
- **自动更新** — 静默检查与下载更新
- **原生窗口** — macOS 毛玻璃、Windows acrylic、Linux 支持

## 快速开始

### 环境要求

- Node.js `^22.19.0 || >=24.0.0`
- pnpm `11.7.0`

### 安装与启动

```sh
git clone <your-repo-url>
cd dsh-desktop
pnpm install
pnpm run dev:desktop
```

首次启动会自动构建必要模块，然后打开 Electron 桌面窗口。

### 打包

```sh
pnpm run package:desktop   # 当前平台 unpacked 目录
pnpm run dist:mac          # macOS DMG + ZIP
pnpm run dist:win          # Windows NSIS 安装程序
```

## 目录结构

```text
dsh-desktop/
├── apps/
│   ├── desktop/     # Electron 主进程、preload、Host 生命周期
│   ├── web/         # Web 工作区前端
│   └── cli/         # dsh CLI
├── packages/        # Agent、模型、工具、会话、插件等能力包
├── vendor/          # Cordis 框架
├── native/          # 原生模块
├── python/          # Python SDK
└── scripts/         # 构建与检查脚本
```

## 核心架构

DSH Desktop 采用三层架构：

```
Electron 主进程 ←→ 子进程 (dsh web) ←→ Web 渲染器
```

- **Electron 主进程**：管理窗口、托盘、插件安装、更新
- **dsh web 子进程**：运行 Harness 核心逻辑
- **Web 渲染器**：沙箱化的用户界面

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `pnpm run dev:desktop` | 构建并启动桌面应用 |
| `pnpm run dev:desktop:rebuild` | 强制完整重建后启动 |
| `pnpm run build` | 构建所有模块 |
| `pnpm run typecheck` | 类型检查 |
| `pnpm run test` | 运行测试 |

## 许可证

[MIT](LICENSE)
