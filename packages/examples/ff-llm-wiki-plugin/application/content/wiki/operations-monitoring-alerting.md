---
title: 监控告警体系
type: system
topic: operations
slug: operations-monitoring-alerting
sources:
  - raw/operations-monitor.md
  - raw/operations-inspection.md
updated: 2025-08-12
---

# 监控告警体系

> 关键指标采集与告警分级。

## 结论

关键指标全覆盖，告警按严重程度分级处置。

监控数据是容量规划与故障复盘的数据基础。

## 来源证据

- **监控告警与故障复盘**（`raw/operations-monitor.md` · 运维部）
  - 关键指标全覆盖，告警按严重程度分级处置。
  - 故障后必须复盘，沉淀可执行的改进项。
  - 容量规划依赖历史监控数据，需长期留存。
  - 值班响应要保证告警在约定时限内被处理。
- **服务器巡检手册（每周点检）**（`raw/operations-inspection.md` · 运维部）
  - 巡检覆盖资源、进程、日志等维度，异常项进入工单跟踪。
  - 巡检结果与监控告警联动，形成隐患闭环。
  - 容量水位是巡检重点，逼近阈值时提前扩容。
  - 备份有效性需在巡检中验证，不能只看备份任务是否成功。

## 相关页面

- [[wiki/operations-inspection-routine|服务器巡检规范]]
- [[wiki/security-monitoring|安全监控与告警]]
