# 内核兼容性防护：为何保持纯壳，以及检查放在哪里（决策记录）

> 状态：已实施（2026-09-07）。本文同时记录一个**被否决的备选方案**，避免下次重新论证。

## 1. 起因：一天内两起同源事故

| | 现象 | 根因 |
| --- | --- | --- |
| A | 客户端启动即报错，闪屏贴 ESM stack | 内核 0.1.2-rc.1 删掉 `@deepseek-ai/dsh-settings` 的 `settingsNamespace` 导出，profile 里两个第三方插件仍按旧 API import |
| B | 点「新建会话」毫无反应、无报错 | 内核把公共配置值 `agent-presets: code` 改名为 `ptc`，不迁移 `~/.dsh/settings.yaml`；建会话失败在前端只是一行 `console.warn` |

共同点：内核单方面改变公共契约，而普通用户既看不懂也修不了。

## 2. 备选方案：钉版本、把内核随包分发（已实现又回退）

完整实现过并验证可用：`prepare-dsh-bundle` 用 hoisted 扁平安装产出内核 + pnpm（264MB + 21MB），
`extraResources` 落到 `Resources/dsh`、`Resources/tools/pnpm`，运行时零联网；打包产物冒烟
发现过两个真实缺陷（`extraResources.from` 按仓库根解析导致静默漏拷；照抄 profile 的
`autoInstallPeers:false` 导致 peer 未装、内核起不来），都已修并被 verify-app.sh 的加载冒烟门禁固化。

**否决理由**：

- 它并不能解决 B。配置漂移来自「内核改了值域、用户文件是旧的」，与内核从哪来无关；
  钉版本只是把随机时刻坏变成发版时刻坏。
- 代价却是实打实的：包体 127MB → ~200MB+、每个平台各自构建、官方修复只能等我们发版。
- 更关键：**运行时能直接读到已安装内核的值域**，比构建期快照更强——构建期清单可能
  与用户实际在跑的内核不一致，运行时探测永远一致。于是纯壳也能有完整防护。

结论：纯壳保留（含「检查 dsh 内核更新」），防护落在下面两层。

## 3. 落地方案

### 3.1 插件不兼容 → 安全模式（§3.6）

Host 启动失败时从缓冲输出点名出错 bundle，写 `userData/plugin-safe-mode.json` 并生成
cordis `--patch` 覆盖层（`disabled: true`，loader 在 import 前短路）后重启，直到起来；
菜单/托盘「已停用插件」可检查上游新版本并一键更新启用，仍不兼容则自动再停用。
零网络、可逆、不改用户的 profile 文件。**目标就一条：客户端不能起不来。**

### 3.2 配置值域漂移 → 运行时探测 + 谨慎迁移

```
discoverKernelDomain(kernelRoot)     读已装内核：presets/ 目录 + SANDBOX_MODES 数组 + 版本
planCompat(text, domain, renames)    纯函数：能确定改名的 → 迁移；只知无效的 → 只报告
applyMigrations(text, migrations)    只重写值所在那一行，注释/顺序/引号风格原样保留
```

检查三类值：`agent-presets.default`、`permission.defaultPreset`（两者值域来自内核），
以及 `agent-default-model` 的 provider/model 是否在同一文件里声明（纯自洽，不需要内核知识）。

约束：只在窗口起来后运行，本身出错就静默跳过，永不阻塞启动；只有命中改名表才写盘；
每 (key, from, to, kernel) 只应用一次并记录在 `userData/config-compat.json`；
`DSH_DESKTOP_NO_CONFIG_MIGRATION=1` 可完全只报告不写盘；迁移后仍不自洽就拒绝写。

`resources/config-renames.json` 是我们手维护的改名表（`code -> ptc` 这类），
每次内核 bump 值得核对一次值域变化——这是本方案唯一的人工成本。

## 4. 验收

- 单元：真实 0.1.2-rc.1 报错文本驱动的恢复循环；配置解析/迁移/幂等/拒绝猜测；
  合成内核下的值域发现。
- 真机：对真实已装内核跑通「发现 4 预设 + 3 权限档 → code 迁移为 ptc → 只改一行、
  注释保留 → 复跑 0 迁移 → 关写盘开关不改文件」。
- `verify-app.sh` 在纯壳下继续断言「未打包 dsh」。
