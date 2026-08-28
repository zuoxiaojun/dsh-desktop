---
title: 发布流程与代码评审
type: playbook
topic: engineering
slug: engineering-release-flow
sources:
  - raw/engineering-release.md
  - raw/operations-change.md
updated: 2025-08-15
---

# 发布流程与代码评审

> 从代码评审到灰度发布的交付门禁。

## 结论

所有代码变更必须通过评审门禁，未评审不得合入主干。

发布采用灰度策略，异常时优先回滚而非现场修复。

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

## 相关页面

- [[wiki/operations-change-management|变更管理流程]]
- [[wiki/product-acceptance-playbook|产品验收流程]]
- [[wiki/security-access-control|访问控制与权限策略]]
