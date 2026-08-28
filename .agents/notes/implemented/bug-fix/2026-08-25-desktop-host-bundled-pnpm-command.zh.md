# Agent Note：Desktop Host 暴露打包内 pnpm 命令

Status: implemented

[English](2026-08-25-desktop-host-bundled-pnpm-command.md) | 中文

## Problem

打包后的 Desktop Host 通过 Electron Node 模式运行，并携带 pnpm 的 JavaScript 入口，但不携带 npm 或 Corepack 命令安装。Desktop 从 Windows shell 或其他图形界面启动器启动时，如果 PATH 中没有另外安装的包管理器，通过普通 `pnpm` 命令解析包管理器的 Host 插件就会失败。

## Decision

Desktop 会在 Host 启动前，把名为 `pnpm` 的平台命令代理原子写入既有受管运行时命令目录。该代理使用 Desktop 选定的 Node 可执行文件调用打包内精确 pnpm JavaScript 入口，并在打包应用中启用 Electron Node 模式。Host 已把这份受管目录放在 PATH 首位，因此插件无需继承终端配置即可使用标准命令名。

每次启动都会根据当前解析路径替换代理，所以应用更新或安装目录变化不会让 Host 继续指向过期的可执行文件。该代理不增加包来源或版本选择；pnpm 版本与入口仍以运行时暂存和打包校验为权威。

## Alternatives considered

**打包 npm 与 Corepack。** 不采用，因为 Desktop 已经携带所需包管理器；再增加两种预置机制会扩大运行时，并暴露额外的可变安装路径。

**要求全局安装 pnpm 或从终端启动。** 不采用，因为图形桌面启动无法稳定继承交互式 shell 配置，一键插件流程不能依赖应用外的工作站设置。

**只修改 dshmarket。** 不采用，因为缺失的命令属于 Desktop Host 环境，其他已安装 Host 插件也可以正当地使用同一套打包内包管理器约定。

## Consequences

受支持桌面平台上的 Host 插件无需 npm、Corepack 或全局 pnpm 安装即可解析 `pnpm`。该命令始终使用 Desktop 暂存的包管理器，并继承 Host 进程环境。受管命令目录缺失或不可写时，Desktop 会在插件加载前阻止启动，而不是继续运行并在稍后的包安装中给出不透明失败。

## Testing

Desktop 运行时测试固定带空格安装路径和 Electron Node 模式的 Windows `.cmd` 代理、可执行的 POSIX 代理，以及受管命令目录位于 Host PATH 首位。Windows 预览版工作流还会使用最小 PATH 启动已安装应用，并要求它生成的命令在安装包发布前报告仓库固定的 pnpm 版本。
