---
title: 故障复盘方法
type: concept
topic: operations
slug: operations-incident-review
sources:
  - raw/operations-monitor.md
  - raw/operations-change.md
updated: 2025-08-12
---

# 故障复盘方法

> 故障后沉淀改进项的复盘方法。

## 结论

故障后必须复盘，沉淀可执行的改进项而非止于追责。

复盘结论回流到变更与巡检流程，防止同类问题复发。

## 来源证据

- **监控告警与故障复盘**（`raw/operations-monitor.md` · 运维部）
  - 关键指标全覆盖，告警按严重程度分级处置。
  - 故障后必须复盘，沉淀可执行的改进项。
  - 容量规划依赖历史监控数据，需长期留存。
  - 值班响应要保证告警在约定时限内被处理。
- **生产环境变更管理规范**（`raw/operations-change.md` · 运维部）
  - 生产变更必须先申请、评审，禁止直接改生产。
  - 变更必须落在既定窗口内执行，避开服务高峰。
  - 每个变更都要有回滚方案，异常时先回滚。
  - 变更后持续观察监控指标，确认无异常再关闭。

## 相关页面

- [[wiki/operations-change-management|变更管理流程]]
- [[wiki/operations-monitoring-alerting|监控告警体系]]
