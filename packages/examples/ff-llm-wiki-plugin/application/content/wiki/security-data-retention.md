---
title: 数据保留与销毁策略
type: policy
topic: security
slug: security-data-retention
sources:
  - raw/security-policy.md
  - raw/security-incident.md
updated: 2025-08-13
---

# 数据保留与销毁策略

> 数据保留周期与泄露后的策略更新。

## 结论

数据按分级确定保留周期，过期及时销毁。

泄露事件后复盘并更新保留与销毁策略。

## 来源证据

- **信息安全管理制度（2025 版）**（`raw/security-policy.md` · 安全部）
  - 信息按敏感程度分级，分级决定保护强度与访问范围。
  - 访问控制遵循最小权限，默认拒绝、按需授权。
  - 数据泄露等安全事件必须走既定应急响应流程。
  - 全员安全意识培训是制度落地的必要条件。
- **数据泄露应急预案**（`raw/security-incident.md` · 安全部）
  - 事件响应先止损、再溯源、后复盘，避免扩大影响。
  - 安全监控与告警是泄露发现的第一道信号。
  - 泄露后必须复盘并更新数据保留与销毁策略。
  - 响应过程全程记录时间线，供合规审计追溯。

## 相关页面

- [[wiki/security-info-classification|信息分级与保护]]
- [[wiki/security-incident-response|数据泄露应急响应]]
