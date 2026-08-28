---
title: 访问控制与权限策略
type: policy
topic: security
slug: security-access-control
sources:
  - raw/security-access.md
  - raw/security-policy.md
updated: 2025-08-13
---

# 访问控制与权限策略

> 最小权限与默认拒绝的访问控制。

## 结论

访问控制遵循最小权限，默认拒绝、按需授权。

权限定期复核，离岗及时回收，避免权限膨胀。

## 来源证据

- **权限与合规管理**（`raw/security-access.md` · 安全部）
  - 权限授予遵循最小权限，默认拒绝、按需授权。
  - 账号权限定期复核，离岗必须及时回收。
  - 合规审计以授权记录与日志为证据。
  - 接口鉴权同样遵循最小权限，只暴露必需能力。
- **信息安全管理制度（2025 版）**（`raw/security-policy.md` · 安全部）
  - 信息按敏感程度分级，分级决定保护强度与访问范围。
  - 访问控制遵循最小权限，默认拒绝、按需授权。
  - 数据泄露等安全事件必须走既定应急响应流程。
  - 全员安全意识培训是制度落地的必要条件。

## 相关页面

- [[wiki/security-info-classification|信息分级与保护]]
- [[wiki/engineering-api-security|接口安全与鉴权]]
