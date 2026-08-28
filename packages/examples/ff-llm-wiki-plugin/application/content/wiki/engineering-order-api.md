---
title: 订单中心接口规范
type: system
topic: engineering
slug: engineering-order-api
sources:
  - raw/engineering-order-api.md
  - raw/engineering-gateway-arch.md
updated: 2025-08-15
---

# 订单中心接口规范

> 订单中心对外接口的契约、版本与幂等语义。

## 结论

接口以版本化契约交付，破坏性变更必须升级主版本号。

鉴权下沉到网关，业务侧只做细粒度权限校验。

## 来源证据

- **接口文档（订单中心 v1.8）**（`raw/engineering-order-api.md` · 研发部）
  - 接口以版本化契约交付，破坏性变更必须升级主版本号。
  - 鉴权下沉到网关，业务侧只做细粒度权限校验。
  - 对外接口必须同时提供错误码与幂等语义。
  - 联调以文档为准，口头约定一律无效。
- **系统架构设计说明书（网关服务）**（`raw/engineering-gateway-arch.md` · 研发部）
  - 网关是统一鉴权与限流的边界，业务服务不重复实现鉴权。
  - 每个对外接口都要具备可观测性：日志、指标、追踪三者齐全。
  - 架构演进需显式标注技术债，避免「能跑」掩盖「难维护」。
  - 接口鉴权遵循最小权限，只暴露业务必需的能力。

## 相关页面

- [[wiki/engineering-gateway-architecture|网关服务架构]]
- [[wiki/security-access-control|访问控制与权限策略]]
