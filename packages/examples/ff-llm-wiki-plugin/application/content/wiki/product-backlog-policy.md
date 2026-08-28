---
title: 需求优先级与排期策略
type: policy
topic: product
slug: product-backlog-policy
sources:
  - raw/product-roadmap.md
  - raw/product-prd.md
updated: 2025-08-16
---

# 需求优先级与排期策略

> 用统一维度给需求排序并约束排期决策。

## 结论

需求按用户价值、实现成本、风险三个维度统一排序，避免拍脑袋排期。

排期策略与路线图主题对齐，保证每期交付聚焦。

## 来源证据

- **产品路线图（2025）**（`raw/product-roadmap.md` · 产品部）
  - 路线图按主题组织版本，不把功能清单当路线图。
  - 版本主题之间存在依赖，需在规划阶段显式标注。
  - 排期策略要区分「必须做」「应该做」「暂不做」三档。
  - 用户反馈与竞品变化是路线图调整的主要输入。
- **产品需求说明书（2025 Q3）**（`raw/product-prd.md` · 产品部）
  - 每个迭代必须有可验证的验收标准，验收标准随需求一起评审。
  - 需求按「用户价值 × 实现成本 × 风险」三个维度做优先级排序。
  - 产品承诺的能力必须与服务水平（SLA）对齐，避免过度承诺。
  - 验收以「默认进入即装满」为底线，首屏不允许空白态。

## 相关页面

- [[wiki/product-roadmap-planning|路线图与迭代规划]]
- [[wiki/engineering-release-flow|发布流程与代码评审]]
