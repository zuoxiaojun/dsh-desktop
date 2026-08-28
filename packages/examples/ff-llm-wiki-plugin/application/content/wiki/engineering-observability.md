---
title: 可观测性设计
type: concept
topic: engineering
slug: engineering-observability
sources:
  - raw/engineering-gateway-arch.md
  - raw/operations-monitor.md
updated: 2025-08-15
---

# 可观测性设计

> 日志、指标、追踪三者齐全的观测能力。

## 结论

可观测性从设计阶段就要预留，而不是线上排障时才补。

监控指标是可观测性的运行时载体，与运维告警体系直接衔接。

## 来源证据

- **系统架构设计说明书（网关服务）**（`raw/engineering-gateway-arch.md` · 研发部）
  - 网关是统一鉴权与限流的边界，业务服务不重复实现鉴权。
  - 每个对外接口都要具备可观测性：日志、指标、追踪三者齐全。
  - 架构演进需显式标注技术债，避免「能跑」掩盖「难维护」。
  - 接口鉴权遵循最小权限，只暴露业务必需的能力。
- **监控告警与故障复盘**（`raw/operations-monitor.md` · 运维部）
  - 关键指标全覆盖，告警按严重程度分级处置。
  - 故障后必须复盘，沉淀可执行的改进项。
  - 容量规划依赖历史监控数据，需长期留存。
  - 值班响应要保证告警在约定时限内被处理。

## 相关页面

- [[wiki/operations-monitoring-alerting|监控告警体系]]
- [[wiki/engineering-gateway-architecture|网关服务架构]]
