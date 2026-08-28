---
title: 数据泄露应急响应
type: playbook
topic: security
slug: security-incident-response
sources:
  - raw/security-incident.md
  - raw/security-policy.md
updated: 2025-08-13
---

# 数据泄露应急响应

> 数据泄露事件的止损、溯源与复盘。

## 结论

事件响应先止损、再溯源、后复盘，全程记录时间线。

监控告警是发现泄露的第一道信号。

## 来源证据

- **数据泄露应急预案**（`raw/security-incident.md` · 安全部）
  - 事件响应先止损、再溯源、后复盘，避免扩大影响。
  - 安全监控与告警是泄露发现的第一道信号。
  - 泄露后必须复盘并更新数据保留与销毁策略。
  - 响应过程全程记录时间线，供合规审计追溯。
- **信息安全管理制度（2025 版）**（`raw/security-policy.md` · 安全部）
  - 信息按敏感程度分级，分级决定保护强度与访问范围。
  - 访问控制遵循最小权限，默认拒绝、按需授权。
  - 数据泄露等安全事件必须走既定应急响应流程。
  - 全员安全意识培训是制度落地的必要条件。

## 相关页面

- [[wiki/security-compliance-audit|合规与审计]]
- [[wiki/operations-monitoring-alerting|监控告警体系]]
