---
title: 跨部门协作处置
type: concept
topic: support
slug: support-cross-dept-collab
sources:
  - raw/support-complaint.md
  - raw/engineering-release.md
  - raw/product-roadmap.md
updated: 2025-08-16
---

# 跨部门协作处置

> 客服问题跨产品、研发协作的机制。

## 结论

投诉根因需跨产品与研发协作才能闭环，客服单方面无法解决。

反馈闭环把问题回流到需求池与发布流程，从源头修复。

## 来源证据

- **投诉处理流程与升级标准**（`raw/support-complaint.md` · 客服部）
  - 投诉按影响程度分级，高等级投诉立即升级而非层层转手。
  - 升级需跨部门协同，明确责任人与时限。
  - 投诉根因必须回流产品与研发，形成反馈闭环。
  - 满意度指标是投诉处理效果的核心度量。
- **发布与代码评审规范**（`raw/engineering-release.md` · 研发部）
  - 所有代码变更必须通过评审门禁，未评审代码不得合入主干。
  - 发布采用灰度策略，异常时优先回滚而非现场修复。
  - 生产变更与发布窗口统一走变更管理流程。
  - 技术债要在评审中显式记录，避免无限期累积。
- **产品路线图（2025）**（`raw/product-roadmap.md` · 产品部）
  - 路线图按主题组织版本，不把功能清单当路线图。
  - 版本主题之间存在依赖，需在规划阶段显式标注。
  - 排期策略要区分「必须做」「应该做」「暂不做」三档。
  - 用户反馈与竞品变化是路线图调整的主要输入。

## 相关页面

- [[wiki/product-feedback-loop|产品反馈闭环]]
- [[wiki/engineering-release-flow|发布流程与代码评审]]
