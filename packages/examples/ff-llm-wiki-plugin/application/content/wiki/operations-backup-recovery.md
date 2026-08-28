---
title: 备份与恢复演练
type: playbook
topic: operations
slug: operations-backup-recovery
sources:
  - raw/operations-inspection.md
  - raw/security-incident.md
updated: 2025-08-13
---

# 备份与恢复演练

> 备份有效性与恢复演练。

## 结论

备份有效性需在巡检中验证，不能只看任务是否成功。

恢复演练与数据保留策略联动，保证可恢复。

## 来源证据

- **服务器巡检手册（每周点检）**（`raw/operations-inspection.md` · 运维部）
  - 巡检覆盖资源、进程、日志等维度，异常项进入工单跟踪。
  - 巡检结果与监控告警联动，形成隐患闭环。
  - 容量水位是巡检重点，逼近阈值时提前扩容。
  - 备份有效性需在巡检中验证，不能只看备份任务是否成功。
- **数据泄露应急预案**（`raw/security-incident.md` · 安全部）
  - 事件响应先止损、再溯源、后复盘，避免扩大影响。
  - 安全监控与告警是泄露发现的第一道信号。
  - 泄露后必须复盘并更新数据保留与销毁策略。
  - 响应过程全程记录时间线，供合规审计追溯。

## 相关页面

- [[wiki/security-data-retention|数据保留与销毁策略]]
- [[wiki/operations-change-management|变更管理流程]]
