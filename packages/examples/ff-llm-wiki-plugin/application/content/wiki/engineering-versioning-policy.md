---
title: 版本与兼容性策略
type: policy
topic: engineering
slug: engineering-versioning-policy
sources:
  - raw/engineering-order-api.md
  - raw/engineering-release.md
updated: 2025-08-15
---

# 版本与兼容性策略

> 接口与版本的兼容性约束。

## 结论

破坏性变更必须升级主版本号，兼容变更可沿用次版本。

联调以文档为准，口头约定无效，避免版本漂移。

## 来源证据

- **接口文档（订单中心 v1.8）**（`raw/engineering-order-api.md` · 研发部）
  - 接口以版本化契约交付，破坏性变更必须升级主版本号。
  - 鉴权下沉到网关，业务侧只做细粒度权限校验。
  - 对外接口必须同时提供错误码与幂等语义。
  - 联调以文档为准，口头约定一律无效。
- **发布与代码评审规范**（`raw/engineering-release.md` · 研发部）
  - 所有代码变更必须通过评审门禁，未评审代码不得合入主干。
  - 发布采用灰度策略，异常时优先回滚而非现场修复。
  - 生产变更与发布窗口统一走变更管理流程。
  - 技术债要在评审中显式记录，避免无限期累积。

## 相关页面

- [[wiki/engineering-order-api|订单中心接口规范]]
- [[wiki/engineering-release-flow|发布流程与代码评审]]
