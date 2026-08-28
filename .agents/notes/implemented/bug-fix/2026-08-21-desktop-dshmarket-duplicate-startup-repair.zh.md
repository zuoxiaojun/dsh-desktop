# Agent Note：Desktop dshmarket 重复启动修复

状态：已实现

[English](2026-08-21-desktop-dshmarket-duplicate-startup-repair.md) | 中文

## 问题

旧版 Desktop 创建的 Profile 可能会在 `cordis.patch.yml` 中手动插入 `dshmarket`。当前 Desktop 安装流程还会通过 `dsh.profile.bundles` 激活 `dshmarket`，因此两个层级会分别实例化这个包；第二个实例注册已经存在的 `dsh-market` locale namespace 时，会在 Host 就绪前失败。

## 决策

Desktop 现在会在普通 Host 启动前执行一项窄范围迁移。只有所选 Profile 把 `dshmarket` 列为活动或停用 Bundle、实际安装的包清单声明了真实 Bundle patch，并且该 patch 自身插入 `dshmarket` 时，迁移才会执行。迁移只移除包名恰好为 `dshmarket` 的嵌套手动 `insert` 条目；直接的 `id: dsh-market` 配置覆盖、无关条目、注释和受支持的 YAML 标签均会保留。修改后的 Profile patch 以原子方式写入。

## 验证

Desktop 测试夹具复现了两个激活层，执行迁移后再通过生产 Profile loader 组合最终配置。测试证明最终只剩一个 `dshmarket` 条目，按 id 指定的配置仍然生效，无关条目和 YAML 内容得到保留，第二次迁移不再产生变化。负向夹具还证明，在不存在经过验证的 Bundle 激活时，不会修改手动安装。

## 考虑过的替代方案

**忽略重复的 locale 注册。** 未采用，因为这会掩盖重复插件实例，而它们的其他服务、路由和副作用仍会重复。

**删除 Profile patch 或全部 `dshmarket` 引用。** 未采用，因为该文件可能包含用户配置与其他插件，而直接按 id 覆盖正是配置 Bundle 所拥有条目的预期方式。

**对所有层级中的全部包做去重。** 未采用，因为其他包可能有意支持多实例，目前也不存在通用迁移合同。

## 后果

受影响的既有安装会在下次启动 Desktop 时自动修复，无需用户删除 Profile。修复范围刻意限制在已确认的 `dshmarket` 迁移形态；其他跨层冲突仍会明确失败，而不会被猜测性处理。
