# Agent Note：Windows node-pty 运行时校验

Status: implemented

[English](2026-08-20-windows-node-pty-runtime-validation.md) | 中文

## Problem

桌面包校验器强制要求 `node-pty/prebuilds/win32-x64/pty.node`。在 `node-pty` 1.2.0 beta 中，`pty.node` 是 Unix 绑定；Windows 实际加载 `conpty.node` 和 `conpty_console_list.node`。因此，正确的 Windows x64 运行时也会在生成安装器前被误判失败。

## Decision

Windows 包校验改为要求当前 Windows 实现实际加载的两个原生模块：`conpty.node` 和 `conpty_console_list.node`。校验器继续要求 Koffi、内置模块加载器、Sharp、Host、前端和包管理器等其他运行时产物。

## Verification

校验器单元测试夹具包含两个 Windows `node-pty` 模块，并验证移除 `conpty_console_list.node` 后打包校验失败。GitHub Windows 预览工作流仍是平台验收边界，必须继续完成真实安装、Host 启动、卸载、残留安装修复和已验证安装器上传。

## Alternatives considered

**添加空的或复制的 `pty.node` 文件。** 不采用，因为这只会满足文件名检查，并不能代表可加载的 Windows 运行时。

**移除所有 `node-pty` 校验。** 不采用，因为安装包可能成功生成，却在终端功能首次启动时才发现缺少原生模块。

## Consequences

Windows 打包校验与当前固定 `node-pty` 版本的真实运行时合同一致，同时保留原生模块覆盖。未来升级 `node-pty` 时，只有 Windows 实际加载的模块发生变化才应更新该清单。
