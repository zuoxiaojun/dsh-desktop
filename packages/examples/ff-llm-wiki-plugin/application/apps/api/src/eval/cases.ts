import type { EvalCase } from '@llmwiki/contracts'

/**
 * 问答评估题库（STAGE-09）
 *
 * 16 条用例，全部问题与参考答案均来自当前 47 篇 Wiki 的真实结论/来源证据，
 * 覆盖六类输入形态。参考答案只写「期望命中的 page/source/topic 与语义关键词」，
 * 不写死整段生成答案——评估器据此收紧比对，避免把「改写措辞」误判为「答错」。
 *
 * 冻结约定：本文件在基线与优化后共用同一份，任何情况下都不允许为分数改写。
 */
export const EVAL_CASES: EvalCase[] = [
  // ---------- 1. 直接事实（direct_fact）：单页单一事实 ----------
  {
    id: 'direct-gateway-auth',
    kind: 'direct_fact',
    question: '网关是如何做统一鉴权和限流的？',
    expectStatus: 'answered',
    expectPageSlugs: ['engineering-gateway-architecture'],
    expectTopics: ['engineering'],
    expectAnswerCovers: ['鉴权', '限流', '网关'],
  },
  {
    id: 'direct-release-rollback',
    kind: 'direct_fact',
    question: '发布出问题了应该先回滚还是现场修复？',
    expectStatus: 'answered',
    expectPageSlugs: ['engineering-release-flow'],
    expectTopics: ['engineering'],
    expectAnswerCovers: ['回滚', '灰度'],
  },
  {
    id: 'direct-first-response',
    kind: 'direct_fact',
    question: '客服首次响应有时限要求吗？',
    expectStatus: 'answered',
    expectPageSlugs: ['support-first-response-policy', 'support-sla'],
    expectTopics: ['support'],
    expectAnswerCovers: ['时限', '响应'],
  },
  {
    id: 'direct-incident-stop',
    kind: 'direct_fact',
    question: '数据泄露后第一件事应该做什么？',
    expectStatus: 'answered',
    expectPageSlugs: ['security-incident-response'],
    expectTopics: ['security'],
    expectAnswerCovers: ['止损'],
  },
  // ---------- 2. 跨来源归纳（cross_source）：多源/多页共同主题 ----------
  {
    id: 'cross-change-approval',
    kind: 'cross_source',
    question: '生产环境变更需要走哪些门禁？',
    expectStatus: 'answered',
    expectPageSlugs: [
      'operations-change-management',
      'engineering-change-review',
      'engineering-release-flow',
    ],
    expectTopics: ['operations', 'engineering'],
    expectAnswerCovers: ['评审', '回滚', '窗口'],
  },
  {
    id: 'cross-sla-commit',
    kind: 'cross_source',
    question: '产品对外承诺的服务水平为什么要和 SLA 对齐？',
    expectStatus: 'answered',
    expectPageSlugs: ['product-sla-alignment', 'support-sla'],
    expectTopics: ['product', 'support'],
    expectAnswerCovers: ['SLA', '承诺', '对齐'],
  },
  {
    id: 'cross-security-full',
    kind: 'cross_source',
    question: '信息分级和访问控制之间是什么关系？',
    expectStatus: 'answered',
    expectPageSlugs: ['security-info-classification', 'security-access-control', 'security-least-privilege'],
    expectTopics: ['security'],
    expectAnswerCovers: ['分级', '最小权限', '默认拒绝'],
  },
  // ---------- 3. 概念关联（concept_link）：经内部链接/概念串联 ----------
  {
    id: 'link-lifecycle-roadmap',
    kind: 'concept_link',
    question: '产品生命周期管理的节奏是靠什么驱动的？',
    expectStatus: 'answered',
    expectPageSlugs: ['product-lifecycle', 'product-roadmap-planning'],
    expectTopics: ['product'],
    expectAnswerCovers: ['路线图', '反馈', '迭代'],
  },
  {
    id: 'link-feedback-loop',
    kind: 'concept_link',
    question: '用户反馈和投诉最终会流到哪里去？',
    expectStatus: 'answered',
    expectPageSlugs: ['product-feedback-loop', 'support-cross-dept-collab'],
    expectTopics: ['product', 'support'],
    expectAnswerCovers: ['需求池', '迭代', '闭环'],
  },
  {
    id: 'link-monitor-incident',
    kind: 'concept_link',
    question: '监控告警在安全事件里起什么作用？',
    expectStatus: 'answered',
    expectPageSlugs: ['security-monitoring', 'security-incident-response'],
    expectTopics: ['security'],
    expectAnswerCovers: ['第一道信号', '发现'],
  },
  // ---------- 4. 引用跳转（citation_jump）：期望命中指定来源证据点 ----------
  {
    id: 'cite-order-api-version',
    kind: 'citation_jump',
    question: '订单中心接口的破坏性变更是怎么处理版本号的？',
    expectStatus: 'answered',
    expectPageSlugs: ['engineering-order-api', 'engineering-versioning-policy'],
    expectSourcePaths: ['raw/engineering-order-api.md'],
    expectTopics: ['engineering'],
    expectAnswerCovers: ['主版本号', '版本'],
  },
  {
    id: 'cite-inspection-backup',
    kind: 'citation_jump',
    question: '备份的有效性是怎么验证的？',
    expectStatus: 'answered',
    expectPageSlugs: ['operations-backup-recovery'],
    expectSourcePaths: ['raw/operations-inspection.md'],
    expectTopics: ['operations'],
    expectAnswerCovers: ['巡检', '验证', '恢复'],
  },
  // ---------- 5. 无充分证据（no_evidence）：期望诚实 no_evidence ----------
  {
    id: 'noevidence-sales',
    kind: 'no_evidence',
    question: '销售提成的计算比例是多少？',
    expectStatus: 'no_evidence',
    expectTopics: [],
  },
  {
    id: 'noevidence-canteen',
    kind: 'no_evidence',
    question: '今天食堂周三中午有什么菜？',
    expectStatus: 'no_evidence',
    expectTopics: [],
  },
  // ---------- 6. 干扰输入（adversarial）：噪声/超长/无关表述 ----------
  {
    id: 'advir-noise',
    kind: 'adversarial',
    question: '嗯那个，就是想问一下啊，网关，就是统一鉴权限流那个，是怎么做的来着？',
    expectStatus: 'answered',
    expectPageSlugs: ['engineering-gateway-architecture'],
    expectTopics: ['engineering'],
    expectAnswerCovers: ['鉴权', '网关'],
  },
  {
    id: 'advir-empty-ish',
    kind: 'adversarial',
    question: '，，，？？？！！！',
    expectStatus: 'no_evidence',
    expectTopics: [],
  },
]
