# Agent Note：插件恢复兼容历史锁文件

Status: implemented

[English](2026-08-22-plugin-recovery-lockfile-compatibility.md) | 中文

## Problem

插件恢复会先还原变更前的 Profile manifest 与锁文件，再重新物化依赖。如果这份历史 `pnpm-lock.yaml` 与打包内置的 pnpm 版本或当前平台不兼容，每次显式重试都会重复同一条 `--frozen-lockfile` 命令，使 Desktop 永久阻塞在 `package-restore-failed`。

## Decision

恢复仍然优先尝试精确的冻结锁安装。如果进程失败退出，并且快照原本包含锁文件，Desktop 会根据已还原的 `package.json` 再执行一次 `--no-frozen-lockfile --lockfile=false` 兼容安装。这条回退可以重新物化 `node_modules`，但不能改写历史锁文件。只有既有的目标包存在性检查，以及旧 Host、客户端与 Skill 运行证据全部通过后，恢复才能发布 `rolled-back` 并解除普通启动限制。

进程启动错误不会触发回退，因为再次调用同一个缺失或不可用的打包运行时无法修复问题。快照原本没有锁文件的 Profile 已经使用非冻结命令，不会重复执行。两条命令都失败时，有界诊断会同时包含两次失败摘要，恢复继续保持关闭。

## Alternatives considered

**重复失败后丢弃恢复日志。** 不采用，因为 Profile 可能仍包含只完成一部分的包变更；缺少运行证据时直接启动，可能加载不可信或不一致的插件代码。

**删除 Profile 并静默恢复为内置环境。** 不采用，因为这会在没有明确重置决定的情况下删除用户安装的插件与组合选择。

**重新生成历史锁文件。** 不采用，因为锁文件属于恢复证据；兼容模式会保持它逐字节不变，只改变可丢弃的依赖树。

## Consequences

只要精确包规格仍可解析，旧 Windows Profile 就能跨 pnpm 与平台变化完成恢复，同时不会削弱恢复后的运行校验。打包内置 pnpm 缺失、插件归档不可用或依赖确实无法解析时，恢复仍会安全失败并保留诊断能力。

## Testing

包管理器测试固定两步 Windows 调用，只允许兼容尝试携带 `--lockfile=false`，并证明没有历史锁文件的 Profile 不会重复执行命令。既有恢复控制器测试继续要求目标包存在性与运行证据全部通过后才能恢复启动。
