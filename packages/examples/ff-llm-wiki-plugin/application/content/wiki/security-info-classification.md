---
title: 信息分级与保护
type: concept
topic: security
slug: security-info-classification
sources:
  - raw/security-policy.md
  - raw/security-access.md
updated: 2025-08-13
---

# 信息分级与保护

> 按敏感程度分级并匹配保护强度。

## 结论

信息分级是保护强度的前提，敏感度决定访问范围与保留策略。

分级结果是访问控制与数据保留的上游依据。

## 来源证据

- **信息安全管理制度（2025 版）**（`raw/security-policy.md` · 安全部）
  - 信息按敏感程度分级，分级决定保护强度与访问范围。
  - 访问控制遵循最小权限，默认拒绝、按需授权。
  - 数据泄露等安全事件必须走既定应急响应流程。
  - 全员安全意识培训是制度落地的必要条件。
- **权限与合规管理**（`raw/security-access.md` · 安全部）
  - 权限授予遵循最小权限，默认拒绝、按需授权。
  - 账号权限定期复核，离岗必须及时回收。
  - 合规审计以授权记录与日志为证据。
  - 接口鉴权同样遵循最小权限，只暴露必需能力。

## 相关页面

- [[wiki/security-access-control|访问控制与权限策略]]
- [[wiki/security-compliance-audit|合规与审计]]
