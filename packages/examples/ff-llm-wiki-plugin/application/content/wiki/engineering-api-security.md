---
title: 接口安全与鉴权
type: concept
topic: engineering
slug: engineering-api-security
sources:
  - raw/engineering-order-api.md
  - raw/security-access.md
updated: 2025-08-15
---

# 接口安全与鉴权

> 接口鉴权下沉与最小权限的实践。

## 结论

接口鉴权由网关统一完成，业务侧只校验细粒度权限。

最小权限原则贯穿接口设计，只暴露业务必需的能力。

## 来源证据

- **接口文档（订单中心 v1.8）**（`raw/engineering-order-api.md` · 研发部）
  - 接口以版本化契约交付，破坏性变更必须升级主版本号。
  - 鉴权下沉到网关，业务侧只做细粒度权限校验。
  - 对外接口必须同时提供错误码与幂等语义。
  - 联调以文档为准，口头约定一律无效。
- **权限与合规管理**（`raw/security-access.md` · 安全部）
  - 权限授予遵循最小权限，默认拒绝、按需授权。
  - 账号权限定期复核，离岗必须及时回收。
  - 合规审计以授权记录与日志为证据。
  - 接口鉴权同样遵循最小权限，只暴露必需能力。

## 相关页面

- [[wiki/security-access-control|访问控制与权限策略]]
- [[wiki/engineering-gateway-architecture|网关服务架构]]
