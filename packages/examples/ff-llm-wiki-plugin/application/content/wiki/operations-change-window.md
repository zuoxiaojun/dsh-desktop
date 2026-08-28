---
title: 变更窗口与冻结期
type: policy
topic: operations
slug: operations-change-window
sources:
  - raw/operations-change.md
  - raw/support-sla.md
updated: 2025-08-14
---

# 变更窗口与冻结期

> 变更窗口与高峰期的隔离策略。

## 结论

变更必须落在既定窗口内执行，避开服务高峰。

冻结期禁止非紧急变更，与 SLA 承诺高峰期错开。

## 来源证据

- **生产环境变更管理规范**（`raw/operations-change.md` · 运维部）
  - 生产变更必须先申请、评审，禁止直接改生产。
  - 变更必须落在既定窗口内执行，避开服务高峰。
  - 每个变更都要有回滚方案，异常时先回滚。
  - 变更后持续观察监控指标，确认无异常再关闭。
- **服务 SLA 与满意度说明**（`raw/support-sla.md` · 客服部）
  - SLA 承诺必须与产品能力对齐，避免过度承诺。
  - 首次响应时限与解决时限要分别定义并量化考核。
  - 满意度按工单抽样度量，低分样本必须回溯根因。
  - 变更窗口等服务行为要避免落在 SLA 承诺的高峰期。

## 相关页面

- [[wiki/operations-change-management|变更管理流程]]
- [[wiki/support-sla|服务等级协议]]
