import type { DocumentTopic, WikiPageType } from '@llmwiki/contracts'

/**
 * 知识单元模型（编译规则层的人类撰写部分）。
 *
 * 这里集中定义了「演示口径」：47 个知识单元、它们的类型、来源与互链。
 * 编译器只依据本模型与 raw/ 的真实内容生成产物，前端与 API 都不散落统计数字。
 */
export interface KnowledgeUnit {
  /** 稳定 slug（kebab-case，产物文件名与互链都基于它） */
  slug: string
  type: WikiPageType
  topic: DocumentTopic
  title: string
  /** 一行摘要（目录与统计卡上下文） */
  summary: string
  /** 结论性正文（跨来源综合，非逐字抄写源文） */
  conclusion: string[]
  /** 回指的源文件路径（content/raw/ 下） */
  sources: string[]
  /** 互链目标 slug（不含 wiki/ 前缀） */
  links: string[]
}

function unit(
  slug: string,
  type: WikiPageType,
  topic: DocumentTopic,
  title: string,
  summary: string,
  conclusion: string[],
  sources: string[],
  links: string[],
): KnowledgeUnit {
  return { slug, type, topic, title, summary, conclusion, sources, links }
}

/** 47 个知识单元：18 份源资料跨来源重组为 47 个知识页（不与源 1:1 对应）。 */
export const KNOWLEDGE_UNITS: KnowledgeUnit[] = [
  // ---------- 产品（product） ----------
  unit(
    'product-lifecycle', 'concept', 'product', '产品生命周期管理',
    '把产品从需求、规划、发布到反馈的完整生命周期纳入统一管理。',
    [
      '产品的生命周期跨越需求、规划、研发、发布与客服反馈，任何一环脱节都会造成承诺与交付不一致。',
      '路线图是生命周期的节奏来源，反馈闭环则让每次迭代都能修正方向。',
    ],
    ['raw/product-prd.md', 'raw/product-roadmap.md'],
    ['product-requirements', 'product-roadmap-planning', 'engineering-release-flow', 'support-sla'],
  ),
  unit(
    'product-requirements', 'concept', 'product', '需求规格与验收标准',
    '定义需求的表达方式与可验证的验收口径。',
    [
      '需求必须以可验证的验收标准交付，评审时一并确认，避免研发与产品对「完成」理解不一致。',
      '验收以默认装满为底线，任何导致首屏空白的交付都视为未完成。',
    ],
    ['raw/product-prd.md', 'raw/product-manual.md'],
    ['product-lifecycle', 'engineering-order-api', 'support-script-system'],
  ),
  unit(
    'product-roadmap-planning', 'concept', 'product', '路线图与迭代规划',
    '把战略意图拆解为可排期的版本主题与依赖关系。',
    [
      '路线图按主题组织版本并显式标注依赖，而不是罗列功能清单。',
      '排期区分必须做、应该做、暂不做三档，确保资源聚焦。',
    ],
    ['raw/product-roadmap.md', 'raw/product-prd.md'],
    ['product-lifecycle', 'engineering-release-flow'],
  ),
  unit(
    'product-user-manual-system', 'system', 'product', '用户操作手册体系',
    '面向用户的功能说明与自助答疑的操作路径体系。',
    [
      '手册保证每个功能操作路径唯一可复现，并把高频问题沉淀为自助条目。',
      '它与客服话术共享术语，是客服知识库的产品侧源头。',
    ],
    ['raw/product-manual.md', 'raw/support-script.md'],
    ['product-requirements', 'support-sla'],
  ),
  unit(
    'product-acceptance-playbook', 'playbook', 'product', '产品验收流程',
    '发布前按验收标准逐项核对、确认可交付的流程。',
    [
      '验收以需求说明书的验收标准为准，逐项核对后由产品与客服共同确认。',
      '验收通过是进入发布流水线的前提，与服务承诺对齐后放行。',
    ],
    ['raw/product-prd.md', 'raw/engineering-release.md', 'raw/support-sla.md'],
    ['product-requirements', 'engineering-release-flow'],
  ),
  unit(
    'product-backlog-policy', 'policy', 'product', '需求优先级与排期策略',
    '用统一维度给需求排序并约束排期决策。',
    [
      '需求按用户价值、实现成本、风险三个维度统一排序，避免拍脑袋排期。',
      '排期策略与路线图主题对齐，保证每期交付聚焦。',
    ],
    ['raw/product-roadmap.md', 'raw/product-prd.md'],
    ['product-roadmap-planning', 'engineering-release-flow'],
  ),
  unit(
    'product-sla-alignment', 'concept', 'product', '产品承诺与服务水平对齐',
    '产品对外承诺的能力必须与 SLA 一致。',
    [
      '产品手册中承诺的能力必须能在约定时限内兑现，否则就是不诚实的承诺。',
      'SLA 一旦变化，手册与话术需同步更新。',
    ],
    ['raw/product-manual.md', 'raw/support-sla.md'],
    ['product-user-manual-system', 'support-sla'],
  ),
  unit(
    'product-feedback-loop', 'system', 'product', '产品反馈闭环',
    '把用户反馈与投诉回流到需求池并驱动迭代的机制。',
    [
      '用户反馈与投诉根因必须回流到需求池，成为路线图调整的输入。',
      '闭环的终点是下一次迭代的规划，而不是停留在客服工单里。',
    ],
    ['raw/product-manual.md', 'raw/support-complaint.md', 'raw/product-roadmap.md'],
    ['product-roadmap-planning', 'support-sla'],
  ),

  // ---------- 研发（engineering） ----------
  unit(
    'engineering-gateway-architecture', 'system', 'engineering', '网关服务架构',
    '统一入口的鉴权、限流与可观测性边界。',
    [
      '网关是统一鉴权与限流的边界，业务服务不重复实现鉴权。',
      '每个对外接口都具备日志、指标、追踪三件套，保证问题可定位。',
    ],
    ['raw/engineering-gateway-arch.md', 'raw/engineering-order-api.md'],
    ['engineering-order-api', 'security-access-control', 'operations-monitoring-alerting'],
  ),
  unit(
    'engineering-order-api', 'system', 'engineering', '订单中心接口规范',
    '订单中心对外接口的契约、版本与幂等语义。',
    [
      '接口以版本化契约交付，破坏性变更必须升级主版本号。',
      '鉴权下沉到网关，业务侧只做细粒度权限校验。',
    ],
    ['raw/engineering-order-api.md', 'raw/engineering-gateway-arch.md'],
    ['engineering-gateway-architecture', 'security-access-control'],
  ),
  unit(
    'engineering-release-flow', 'playbook', 'engineering', '发布流程与代码评审',
    '从代码评审到灰度发布的交付门禁。',
    [
      '所有代码变更必须通过评审门禁，未评审不得合入主干。',
      '发布采用灰度策略，异常时优先回滚而非现场修复。',
    ],
    ['raw/engineering-release.md', 'raw/operations-change.md'],
    ['operations-change-management', 'product-acceptance-playbook', 'security-access-control'],
  ),
  unit(
    'engineering-versioning-policy', 'policy', 'engineering', '版本与兼容性策略',
    '接口与版本的兼容性约束。',
    [
      '破坏性变更必须升级主版本号，兼容变更可沿用次版本。',
      '联调以文档为准，口头约定无效，避免版本漂移。',
    ],
    ['raw/engineering-order-api.md', 'raw/engineering-release.md'],
    ['engineering-order-api', 'engineering-release-flow'],
  ),
  unit(
    'engineering-observability', 'concept', 'engineering', '可观测性设计',
    '日志、指标、追踪三者齐全的观测能力。',
    [
      '可观测性从设计阶段就要预留，而不是线上排障时才补。',
      '监控指标是可观测性的运行时载体，与运维告警体系直接衔接。',
    ],
    ['raw/engineering-gateway-arch.md', 'raw/operations-monitor.md'],
    ['operations-monitoring-alerting', 'engineering-gateway-architecture'],
  ),
  unit(
    'engineering-api-security', 'concept', 'engineering', '接口安全与鉴权',
    '接口鉴权下沉与最小权限的实践。',
    [
      '接口鉴权由网关统一完成，业务侧只校验细粒度权限。',
      '最小权限原则贯穿接口设计，只暴露业务必需的能力。',
    ],
    ['raw/engineering-order-api.md', 'raw/security-access.md'],
    ['security-access-control', 'engineering-gateway-architecture'],
  ),
  unit(
    'engineering-change-review', 'playbook', 'engineering', '变更评审流程',
    '把生产变更纳入评审门禁的执行流程。',
    [
      '生产变更必须经过评审与变更管理，禁止手工直改生产。',
      '评审记录技术债与风险，为后续演进留痕。',
    ],
    ['raw/engineering-release.md', 'raw/operations-change.md', 'raw/security-policy.md'],
    ['operations-change-management', 'engineering-release-flow'],
  ),
  unit(
    'engineering-cicd-system', 'system', 'engineering', '持续集成与发布系统',
    '自动化构建、测试与发布的流水线。',
    [
      '持续集成把评审门禁自动化为流水线卡点，减少人工疏漏。',
      '发布系统与变更窗口联动，保证变更可回滚、可追踪。',
    ],
    ['raw/engineering-release.md', 'raw/operations-change.md'],
    ['engineering-release-flow', 'operations-change-management'],
  ),
  unit(
    'engineering-tech-debt-policy', 'policy', 'engineering', '技术债治理策略',
    '在评审与演进中显式记录并偿还技术债。',
    [
      '技术债必须在评审中显式记录，不能「能跑」就掩盖「难维护」。',
      '版本演进时同步偿还高成本技术债，避免无限期累积。',
    ],
    ['raw/engineering-release.md', 'raw/engineering-gateway-arch.md'],
    ['engineering-release-flow', 'engineering-versioning-policy'],
  ),

  // ---------- 客服（support） ----------
  unit(
    'support-ticket-flow', 'playbook', 'support', '工单处理流程',
    '工单从受理到闭环的标准流程。',
    [
      '工单按话术手册分类，首次响应在约定时限内给出。',
      '疑难工单按升级标准转交，不在同一层级空转。',
    ],
    ['raw/support-script.md', 'raw/support-complaint.md'],
    ['support-sla', 'support-complaint-escalation'],
  ),
  unit(
    'support-complaint-escalation', 'playbook', 'support', '投诉升级标准',
    '投诉分级与跨部门升级的处置标准。',
    [
      '投诉按影响程度分级，高等级投诉立即升级到跨部门协同。',
      '升级后明确责任人与时限，避免层层转手。',
    ],
    ['raw/support-complaint.md', 'raw/support-sla.md'],
    ['support-ticket-flow', 'support-sla'],
  ),
  unit(
    'support-sla', 'policy', 'support', '服务等级协议',
    '响应时限与解决时限的量化承诺。',
    [
      'SLA 分别定义首次响应时限与解决时限并量化考核。',
      'SLA 承诺与产品能力对齐，避免过度承诺。',
    ],
    ['raw/support-sla.md', 'raw/product-manual.md'],
    ['product-sla-alignment', 'support-ticket-flow'],
  ),
  unit(
    'support-script-system', 'system', 'support', '客服话术知识库',
    '标准答复口径的统一沉淀与检索。',
    [
      '高频问题沉淀为标准话术，答复口径全团队统一。',
      '话术以产品操作手册为上游依据，产品变化时同步更新。',
    ],
    ['raw/support-script.md', 'raw/product-manual.md'],
    ['product-user-manual-system', 'support-ticket-flow'],
  ),
  unit(
    'support-satisfaction-metric', 'concept', 'support', '满意度度量体系',
    '用满意度量化服务质量并回溯根因。',
    [
      '满意度按工单抽样度量，低分样本必须回溯根因。',
      '满意度是投诉处理效果的核心度量指标。',
    ],
    ['raw/support-sla.md', 'raw/support-complaint.md'],
    ['support-sla', 'support-complaint-escalation'],
  ),
  unit(
    'support-first-response-policy', 'policy', 'support', '首次响应时限策略',
    '首次响应时限的约束与考核。',
    [
      '首次响应必须在约定时限内给出，不能以「已记录」敷衍。',
      '时限按工单等级区分，与 SLA 保持一致。',
    ],
    ['raw/support-sla.md', 'raw/support-script.md'],
    ['support-sla', 'support-ticket-flow'],
  ),
  unit(
    'support-cross-dept-collab', 'concept', 'support', '跨部门协作处置',
    '客服问题跨产品、研发协作的机制。',
    [
      '投诉根因需跨产品与研发协作才能闭环，客服单方面无法解决。',
      '反馈闭环把问题回流到需求池与发布流程，从源头修复。',
    ],
    ['raw/support-complaint.md', 'raw/engineering-release.md', 'raw/product-roadmap.md'],
    ['product-feedback-loop', 'engineering-release-flow'],
  ),

  // ---------- 安全（security） ----------
  unit(
    'security-info-classification', 'concept', 'security', '信息分级与保护',
    '按敏感程度分级并匹配保护强度。',
    [
      '信息分级是保护强度的前提，敏感度决定访问范围与保留策略。',
      '分级结果是访问控制与数据保留的上游依据。',
    ],
    ['raw/security-policy.md', 'raw/security-access.md'],
    ['security-access-control', 'security-compliance-audit'],
  ),
  unit(
    'security-access-control', 'policy', 'security', '访问控制与权限策略',
    '最小权限与默认拒绝的访问控制。',
    [
      '访问控制遵循最小权限，默认拒绝、按需授权。',
      '权限定期复核，离岗及时回收，避免权限膨胀。',
    ],
    ['raw/security-access.md', 'raw/security-policy.md'],
    ['security-info-classification', 'engineering-api-security'],
  ),
  unit(
    'security-incident-response', 'playbook', 'security', '数据泄露应急响应',
    '数据泄露事件的止损、溯源与复盘。',
    [
      '事件响应先止损、再溯源、后复盘，全程记录时间线。',
      '监控告警是发现泄露的第一道信号。',
    ],
    ['raw/security-incident.md', 'raw/security-policy.md'],
    ['security-compliance-audit', 'operations-monitoring-alerting'],
  ),
  unit(
    'security-compliance-audit', 'concept', 'security', '合规与审计',
    '以授权记录与日志为证据的合规审计。',
    [
      '合规审计以授权记录与日志为证据，是常态动作而非应付检查。',
      '审计结果反哺访问控制与分级策略的修正。',
    ],
    ['raw/security-policy.md', 'raw/security-access.md'],
    ['security-access-control', 'security-info-classification'],
  ),
  unit(
    'security-least-privilege', 'policy', 'security', '最小权限原则',
    '只授予完成职责所需的最小权限。',
    [
      '最小权限适用于账号与接口两层，默认拒绝、按需授权。',
      '接口鉴权同样只暴露业务必需能力，减少攻击面。',
    ],
    ['raw/security-access.md', 'raw/engineering-order-api.md'],
    ['security-access-control', 'engineering-api-security'],
  ),
  unit(
    'security-monitoring', 'system', 'security', '安全监控与告警',
    '安全事件的发现与告警联动。',
    [
      '安全监控与运维告警联动，是数据泄露发现的第一道信号。',
      '告警分级处置，保证安全事件在约定时限内被响应。',
    ],
    ['raw/security-incident.md', 'raw/operations-monitor.md'],
    ['operations-monitoring-alerting', 'security-incident-response'],
  ),
  unit(
    'security-training-awareness', 'playbook', 'security', '安全培训与意识',
    '全员安全意识培训的落地。',
    [
      '安全培训是全员必修项，不因岗位豁免。',
      '培训与入职流程衔接，底线要求前置传递。',
    ],
    ['raw/security-policy.md', 'raw/hr-training.md'],
    ['hr-training-system', 'security-info-classification'],
  ),
  unit(
    'security-data-retention', 'policy', 'security', '数据保留与销毁策略',
    '数据保留周期与泄露后的策略更新。',
    [
      '数据按分级确定保留周期，过期及时销毁。',
      '泄露事件后复盘并更新保留与销毁策略。',
    ],
    ['raw/security-policy.md', 'raw/security-incident.md'],
    ['security-info-classification', 'security-incident-response'],
  ),

  // ---------- 运维（operations） ----------
  unit(
    'operations-change-management', 'playbook', 'operations', '变更管理流程',
    '生产变更的申请、评审、执行与回滚。',
    [
      '生产变更必须先申请、评审，禁止直接改生产。',
      '每个变更都有回滚方案，异常时先回滚。',
    ],
    ['raw/operations-change.md', 'raw/engineering-release.md'],
    ['engineering-release-flow', 'operations-monitoring-alerting'],
  ),
  unit(
    'operations-inspection-routine', 'playbook', 'operations', '服务器巡检规范',
    '每周巡检的检查项与异常处置。',
    [
      '巡检覆盖资源、进程、日志维度，异常项进入工单跟踪。',
      '巡检与监控告警联动，形成隐患闭环。',
    ],
    ['raw/operations-inspection.md', 'raw/operations-monitor.md'],
    ['operations-monitoring-alerting', 'operations-change-management'],
  ),
  unit(
    'operations-monitoring-alerting', 'system', 'operations', '监控告警体系',
    '关键指标采集与告警分级。',
    [
      '关键指标全覆盖，告警按严重程度分级处置。',
      '监控数据是容量规划与故障复盘的数据基础。',
    ],
    ['raw/operations-monitor.md', 'raw/operations-inspection.md'],
    ['operations-inspection-routine', 'security-monitoring'],
  ),
  unit(
    'operations-incident-review', 'concept', 'operations', '故障复盘方法',
    '故障后沉淀改进项的复盘方法。',
    [
      '故障后必须复盘，沉淀可执行的改进项而非止于追责。',
      '复盘结论回流到变更与巡检流程，防止同类问题复发。',
    ],
    ['raw/operations-monitor.md', 'raw/operations-change.md'],
    ['operations-change-management', 'operations-monitoring-alerting'],
  ),
  unit(
    'operations-capacity-planning', 'concept', 'operations', '容量规划',
    '基于监控数据的容量预估与扩容。',
    [
      '容量规划依赖长期监控数据，逼近阈值时提前扩容。',
      '巡检中的水位检查是容量规划的前置信号。',
    ],
    ['raw/operations-monitor.md', 'raw/operations-inspection.md'],
    ['operations-monitoring-alerting', 'engineering-gateway-architecture'],
  ),
  unit(
    'operations-oncall-policy', 'policy', 'operations', '值班与响应策略',
    '告警响应的值班安排与时限。',
    [
      '值班要保证告警在约定时限内被处理，不能无人认领。',
      '安全事件与常规告警共用响应通道，按等级优先处置。',
    ],
    ['raw/operations-monitor.md', 'raw/security-incident.md'],
    ['operations-monitoring-alerting', 'security-incident-response'],
  ),
  unit(
    'operations-change-window', 'policy', 'operations', '变更窗口与冻结期',
    '变更窗口与高峰期的隔离策略。',
    [
      '变更必须落在既定窗口内执行，避开服务高峰。',
      '冻结期禁止非紧急变更，与 SLA 承诺高峰期错开。',
    ],
    ['raw/operations-change.md', 'raw/support-sla.md'],
    ['operations-change-management', 'support-sla'],
  ),
  unit(
    'operations-backup-recovery', 'playbook', 'operations', '备份与恢复演练',
    '备份有效性与恢复演练。',
    [
      '备份有效性需在巡检中验证，不能只看任务是否成功。',
      '恢复演练与数据保留策略联动，保证可恢复。',
    ],
    ['raw/operations-inspection.md', 'raw/security-incident.md'],
    ['security-data-retention', 'operations-change-management'],
  ),

  // ---------- 人力（hr） ----------
  unit(
    'hr-onboarding-flow', 'playbook', 'hr', '员工入职流程',
    '从到岗到试用期考核的完整流程。',
    [
      '入职流程包含安全合规培训，底线要求前置传递。',
      '试用期目标与绩效在入职阶段对齐，避免后续扯皮。',
    ],
    ['raw/hr-onboarding.md', 'raw/security-policy.md'],
    ['hr-training-system', 'security-training-awareness'],
  ),
  unit(
    'hr-performance-system', 'system', 'hr', '绩效管理体系',
    '目标设定、过程反馈与结果评定。',
    [
      '绩效目标可衡量，过程反馈常态化而非一年一次。',
      '绩效结果与晋升、培训投入直接挂钩。',
    ],
    ['raw/hr-performance.md', 'raw/hr-training.md'],
    ['hr-training-system', 'hr-promotion-policy'],
  ),
  unit(
    'hr-training-system', 'system', 'hr', '培训体系',
    '按能力阶梯设计的课程体系。',
    [
      '培训课程按能力阶梯设计，覆盖岗位全周期。',
      '培训投入向绩效短板倾斜，形成能力提升闭环。',
    ],
    ['raw/hr-training.md', 'raw/hr-onboarding.md'],
    ['hr-onboarding-flow', 'hr-performance-system'],
  ),
  unit(
    'hr-promotion-policy', 'policy', 'hr', '晋升评审策略',
    '以绩效与能力为证据的晋升规则。',
    [
      '晋升评审以绩效与能力双重证据为依据。',
      '评审标准与培训、招聘标准对齐，保证一致性。',
    ],
    ['raw/hr-performance.md', 'raw/hr-training.md'],
    ['hr-performance-system', 'hr-training-system'],
  ),
  unit(
    'hr-attendance-policy', 'policy', 'hr', '考勤与休假制度',
    '考勤、休假与合规的规则。',
    [
      '考勤与休假制度在入职时一次性告知。',
      '考勤与合规表现纳入绩效综合评定。',
    ],
    ['raw/hr-onboarding.md', 'raw/hr-performance.md'],
    ['hr-onboarding-flow', 'hr-performance-system'],
  ),
  unit(
    'hr-recruitment-concept', 'concept', 'hr', '招聘与人才标准',
    '招聘标准与能力标准对齐。',
    [
      '招聘标准与能力标准对齐，保证入口质量。',
      '招聘与培训衔接，新员工能快速进入岗位。',
    ],
    ['raw/hr-training.md', 'raw/hr-performance.md'],
    ['hr-onboarding-flow', 'hr-performance-system'],
  ),
  unit(
    'hr-culture-concept', 'concept', 'hr', '企业文化与价值观',
    '通过入职与培训传递企业文化。',
    [
      '企业文化通过入职与培训反复传递，而非挂在墙上。',
      '价值观与行为标准贯穿绩效与晋升，保持一致。',
    ],
    ['raw/hr-onboarding.md', 'raw/hr-training.md'],
    ['hr-onboarding-flow', 'hr-training-system'],
  ),
]
