---
title: 技术债治理策略
type: policy
topic: engineering
slug: engineering-tech-debt-policy
sources:
  - raw/engineering-release.md
  - raw/engineering-gateway-arch.md
updated: 2025-08-15
---

# 技术债治理策略

> 在评审与演进中显式记录并偿还技术债。

## 结论

技术债必须在评审中显式记录，不能「能跑」就掩盖「难维护」。

版本演进时同步偿还高成本技术债，避免无限期累积。

## 来源证据

- **发布与代码评审规范**（`raw/engineering-release.md` · 研发部）
  - 所有代码变更必须通过评审门禁，未评审代码不得合入主干。
  - 发布采用灰度策略，异常时优先回滚而非现场修复。
  - 生产变更与发布窗口统一走变更管理流程。
  - 技术债要在评审中显式记录，避免无限期累积。
- **系统架构设计说明书（网关服务）**（`raw/engineering-gateway-arch.md` · 研发部）
  - 网关是统一鉴权与限流的边界，业务服务不重复实现鉴权。
  - 每个对外接口都要具备可观测性：日志、指标、追踪三者齐全。
  - 架构演进需显式标注技术债，避免「能跑」掩盖「难维护」。
  - 接口鉴权遵循最小权限，只暴露业务必需的能力。

## 相关页面

- [[wiki/engineering-release-flow|发布流程与代码评审]]
- [[wiki/engineering-versioning-policy|版本与兼容性策略]]
