---
title: 产品验收流程
type: playbook
topic: product
slug: product-acceptance-playbook
sources:
  - raw/product-prd.md
  - raw/engineering-release.md
  - raw/support-sla.md
updated: 2025-08-16
---

# 产品验收流程

> 发布前按验收标准逐项核对、确认可交付的流程。

## 结论

验收以需求说明书的验收标准为准，逐项核对后由产品与客服共同确认。

验收通过是进入发布流水线的前提，与服务承诺对齐后放行。

## 来源证据

- **产品需求说明书（2025 Q3）**（`raw/product-prd.md` · 产品部）
  - 每个迭代必须有可验证的验收标准，验收标准随需求一起评审。
  - 需求按「用户价值 × 实现成本 × 风险」三个维度做优先级排序。
  - 产品承诺的能力必须与服务水平（SLA）对齐，避免过度承诺。
  - 验收以「默认进入即装满」为底线，首屏不允许空白态。
- **发布与代码评审规范**（`raw/engineering-release.md` · 研发部）
  - 所有代码变更必须通过评审门禁，未评审代码不得合入主干。
  - 发布采用灰度策略，异常时优先回滚而非现场修复。
  - 生产变更与发布窗口统一走变更管理流程。
  - 技术债要在评审中显式记录，避免无限期累积。
- **服务 SLA 与满意度说明**（`raw/support-sla.md` · 客服部）
  - SLA 承诺必须与产品能力对齐，避免过度承诺。
  - 首次响应时限与解决时限要分别定义并量化考核。
  - 满意度按工单抽样度量，低分样本必须回溯根因。
  - 变更窗口等服务行为要避免落在 SLA 承诺的高峰期。

## 相关页面

- [[wiki/product-requirements|需求规格与验收标准]]
- [[wiki/engineering-release-flow|发布流程与代码评审]]
