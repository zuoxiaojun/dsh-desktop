---
title: 安全监控与告警
type: system
topic: security
slug: security-monitoring
sources:
  - raw/security-incident.md
  - raw/operations-monitor.md
updated: 2025-08-13
---

# 安全监控与告警

> 安全事件的发现与告警联动。

## 结论

安全监控与运维告警联动，是数据泄露发现的第一道信号。

告警分级处置，保证安全事件在约定时限内被响应。

## 来源证据

- **数据泄露应急预案**（`raw/security-incident.md` · 安全部）
  - 事件响应先止损、再溯源、后复盘，避免扩大影响。
  - 安全监控与告警是泄露发现的第一道信号。
  - 泄露后必须复盘并更新数据保留与销毁策略。
  - 响应过程全程记录时间线，供合规审计追溯。
- **监控告警与故障复盘**（`raw/operations-monitor.md` · 运维部）
  - 关键指标全覆盖，告警按严重程度分级处置。
  - 故障后必须复盘，沉淀可执行的改进项。
  - 容量规划依赖历史监控数据，需长期留存。
  - 值班响应要保证告警在约定时限内被处理。

## 相关页面

- [[wiki/operations-monitoring-alerting|监控告警体系]]
- [[wiki/security-incident-response|数据泄露应急响应]]
