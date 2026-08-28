---
title: 服务器巡检规范
type: playbook
topic: operations
slug: operations-inspection-routine
sources:
  - raw/operations-inspection.md
  - raw/operations-monitor.md
updated: 2025-08-12
---

# 服务器巡检规范

> 每周巡检的检查项与异常处置。

## 结论

巡检覆盖资源、进程、日志维度，异常项进入工单跟踪。

巡检与监控告警联动，形成隐患闭环。

## 来源证据

- **服务器巡检手册（每周点检）**（`raw/operations-inspection.md` · 运维部）
  - 巡检覆盖资源、进程、日志等维度，异常项进入工单跟踪。
  - 巡检结果与监控告警联动，形成隐患闭环。
  - 容量水位是巡检重点，逼近阈值时提前扩容。
  - 备份有效性需在巡检中验证，不能只看备份任务是否成功。
- **监控告警与故障复盘**（`raw/operations-monitor.md` · 运维部）
  - 关键指标全覆盖，告警按严重程度分级处置。
  - 故障后必须复盘，沉淀可执行的改进项。
  - 容量规划依赖历史监控数据，需长期留存。
  - 值班响应要保证告警在约定时限内被处理。

## 相关页面

- [[wiki/operations-monitoring-alerting|监控告警体系]]
- [[wiki/operations-change-management|变更管理流程]]
