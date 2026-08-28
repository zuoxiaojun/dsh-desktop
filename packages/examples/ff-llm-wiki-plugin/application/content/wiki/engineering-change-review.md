---
title: 变更评审流程
type: playbook
topic: engineering
slug: engineering-change-review
sources:
  - raw/engineering-release.md
  - raw/operations-change.md
  - raw/security-policy.md
updated: 2025-08-15
---

# 变更评审流程

> 把生产变更纳入评审门禁的执行流程。

## 结论

生产变更必须经过评审与变更管理，禁止手工直改生产。

评审记录技术债与风险，为后续演进留痕。

## 来源证据

- **发布与代码评审规范**（`raw/engineering-release.md` · 研发部）
  - 所有代码变更必须通过评审门禁，未评审代码不得合入主干。
  - 发布采用灰度策略，异常时优先回滚而非现场修复。
  - 生产变更与发布窗口统一走变更管理流程。
  - 技术债要在评审中显式记录，避免无限期累积。
- **生产环境变更管理规范**（`raw/operations-change.md` · 运维部）
  - 生产变更必须先申请、评审，禁止直接改生产。
  - 变更必须落在既定窗口内执行，避开服务高峰。
  - 每个变更都要有回滚方案，异常时先回滚。
  - 变更后持续观察监控指标，确认无异常再关闭。
- **信息安全管理制度（2025 版）**（`raw/security-policy.md` · 安全部）
  - 信息按敏感程度分级，分级决定保护强度与访问范围。
  - 访问控制遵循最小权限，默认拒绝、按需授权。
  - 数据泄露等安全事件必须走既定应急响应流程。
  - 全员安全意识培训是制度落地的必要条件。

## 相关页面

- [[wiki/operations-change-management|变更管理流程]]
- [[wiki/engineering-release-flow|发布流程与代码评审]]
