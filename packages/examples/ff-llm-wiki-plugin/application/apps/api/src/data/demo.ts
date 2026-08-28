import { createHash } from 'node:crypto'
import {
  createDemoOverview,
  type DocumentKind,
  type DocumentOrigin,
  type DocumentRecord,
  type DocumentStatus,
  type DocumentTopic,
  type OverviewResponse,
} from '@llmwiki/contracts'
import type { OverviewRepository } from './repository.js'

/** 演示数据仓储：返回与契约结构一致的稳定演示数据（首页总览）。 */
export class DemoOverviewRepository implements OverviewRepository {
  async getOverview(): Promise<OverviewResponse> {
    return createDemoOverview()
  }
}

/* ============================================================
 * 企业演示资料种子（STAGE-03）
 * 128 条确定性、可追溯的演示资料：前 12 条为真实可读文件名，
 * 其余 116 条按主题稳定生成。所有字段均可由输入确定性推导，
 * 不依赖随机数与当前时间，保证「载入演示资料」幂等。
 * ============================================================ */

const TOPICS: DocumentTopic[] = [
  'product',
  'engineering',
  'support',
  'security',
  'operations',
  'hr',
]

/** 主题 → 来源部门 */
const TOPIC_SOURCE: Record<DocumentTopic, string> = {
  product: '产品部',
  engineering: '研发部',
  support: '客服部',
  security: '安全部',
  operations: '运维部',
  hr: '人力资源部',
}

interface TopicMeta {
  /** 生成标题用的可读词干 */
  stems: string[]
  /** 该主题下轮换使用的文件类型 */
  kinds: DocumentKind[]
}

const TOPIC_META: Record<DocumentTopic, TopicMeta> = {
  product: {
    stems: ['产品需求文档', '产品功能说明书', '产品迭代规划', '产品验收标准', '产品路线图'],
    kinds: ['pdf', 'docx', 'md'],
  },
  engineering: {
    stems: ['技术设计方案', '接口规范文档', '代码评审记录', '研发测试报告', '架构演进说明'],
    kinds: ['md', 'pdf', 'docx'],
  },
  support: {
    stems: ['客服知识库条目', '工单处理规范', '客户回访记录', '服务SLA说明', '满意度调研报告'],
    kinds: ['docx', 'md', 'pdf'],
  },
  security: {
    stems: ['安全审计报告', '漏洞修复记录', '权限管理制度', '合规检查清单', '安全培训材料'],
    kinds: ['pdf', 'docx', 'md'],
  },
  operations: {
    stems: ['运维操作手册', '监控告警规范', '容量规划报告', '故障复盘报告', '发布记录'],
    kinds: ['pdf', 'md', 'docx'],
  },
  hr: {
    stems: ['员工手册章节', '培训课程讲义', '招聘面试记录', '晋升评审材料', '考勤制度说明'],
    kinds: ['docx', 'pdf', 'md'],
  },
}

/** 演示数据基准时间（固定，保证确定性） */
const BASE_TS = Date.parse('2025-08-16T10:00:00.000Z')

/** 生成资料的失败原因（面向业务用户的可读描述） */
const FAILED_REASONS = [
  '文件内容无法识别，可能已损坏或加密',
  '文件格式与扩展名不一致，请核对后重试',
  '文件过大，已超过单文件处理上限',
  '文件为空白内容，未检测到可用文字',
]

interface DemoSeedSpec {
  title: string
  originalName: string
  kind: DocumentKind
  topic: DocumentTopic
  status: DocumentStatus
  progress: number
  sizeBytes: number
  /** 相对 BASE_TS 的分钟偏移（越小越新） */
  updatedOffsetMinutes: number
  /** 相对更新时间的创建偏移（小时，向前） */
  createdOffsetHours: number
  error?: string
}

/** 前 12 条真实可读文件名（覆盖六大主题，含成功/处理中/待处理/异常各态） */
const REAL_SEEDS: DemoSeedSpec[] = [
  {
    title: '产品需求说明书-2025-Q3',
    originalName: '产品需求说明书-2025-Q3.pdf',
    kind: 'pdf',
    topic: 'product',
    status: 'ready',
    progress: 100,
    sizeBytes: 19_500_000,
    updatedOffsetMinutes: 8,
    createdOffsetHours: 30,
  },
  {
    title: '用户操作手册-v2.3',
    originalName: '用户操作手册-v2.3.md',
    kind: 'md',
    topic: 'product',
    status: 'ready',
    progress: 100,
    sizeBytes: 1_400_000,
    updatedOffsetMinutes: 22,
    createdOffsetHours: 26,
  },
  {
    title: '系统架构设计说明书-网关服务',
    originalName: '系统架构设计说明书-网关服务.pdf',
    kind: 'pdf',
    topic: 'engineering',
    status: 'ready',
    progress: 100,
    sizeBytes: 23_500_000,
    updatedOffsetMinutes: 45,
    createdOffsetHours: 20,
  },
  {
    title: '接口文档-订单中心-v1.8',
    originalName: '接口文档-订单中心-v1.8.md',
    kind: 'md',
    topic: 'engineering',
    status: 'processing',
    progress: 64,
    sizeBytes: 890_000,
    updatedOffsetMinutes: 63,
    createdOffsetHours: 18,
  },
  {
    title: '客服话术手册-常见问题处理',
    originalName: '客服话术手册-常见问题处理.docx',
    kind: 'docx',
    topic: 'support',
    status: 'ready',
    progress: 100,
    sizeBytes: 3_200_000,
    updatedOffsetMinutes: 76,
    createdOffsetHours: 40,
  },
  {
    title: '投诉处理流程与升级标准',
    originalName: '投诉处理流程与升级标准.pdf',
    kind: 'pdf',
    topic: 'support',
    status: 'ready',
    progress: 100,
    sizeBytes: 5_600_000,
    updatedOffsetMinutes: 100,
    createdOffsetHours: 36,
  },
  {
    title: '信息安全管理制度-2025版',
    originalName: '信息安全管理制度-2025版.pdf',
    kind: 'pdf',
    topic: 'security',
    status: 'ready',
    progress: 100,
    sizeBytes: 9_800_000,
    updatedOffsetMinutes: 122,
    createdOffsetHours: 50,
  },
  {
    title: '数据泄露应急预案',
    originalName: '数据泄露应急预案.docx',
    kind: 'docx',
    topic: 'security',
    status: 'failed',
    progress: 0,
    sizeBytes: 4_100_000,
    updatedOffsetMinutes: 145,
    createdOffsetHours: 60,
    error: '文件内容无法识别，可能已损坏或加密',
  },
  {
    title: '生产环境变更管理规范',
    originalName: '生产环境变更管理规范.pdf',
    kind: 'pdf',
    topic: 'operations',
    status: 'queued',
    progress: 0,
    sizeBytes: 7_300_000,
    updatedOffsetMinutes: 170,
    createdOffsetHours: 44,
  },
  {
    title: '服务器巡检手册-每周点检',
    originalName: '服务器巡检手册-每周点检.docx',
    kind: 'docx',
    topic: 'operations',
    status: 'ready',
    progress: 100,
    sizeBytes: 2_700_000,
    updatedOffsetMinutes: 192,
    createdOffsetHours: 30,
  },
  {
    title: '员工入职指引手册',
    originalName: '员工入职指引手册.pdf',
    kind: 'pdf',
    topic: 'hr',
    status: 'ready',
    progress: 100,
    sizeBytes: 6_000_000,
    updatedOffsetMinutes: 215,
    createdOffsetHours: 52,
  },
  {
    title: '绩效考核管理办法-2025',
    originalName: '绩效考核管理办法-2025.docx',
    kind: 'docx',
    topic: 'hr',
    status: 'processing',
    progress: 38,
    sizeBytes: 1_900_000,
    updatedOffsetMinutes: 238,
    createdOffsetHours: 48,
  },
]

/** 人类可读的文件大小 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(1)} GB`
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

/** 生成资料（后 116 条）的确定性状态分布 */
function statusForOrdinal(n: number): DocumentStatus {
  if (n % 17 === 0) return 'failed'
  if (n % 13 === 0) return 'processing'
  if (n % 9 === 0) return 'queued'
  return 'ready'
}

/** 生成资料中 processing 状态的确定性进度（10-90） */
function progressForOrdinal(n: number): number {
  return 20 + ((n * 13) % 70)
}

/** 依据主题关键词推断资料主题（上传用），无法匹配时归为产品 */
export function inferTopic(name: string): DocumentTopic {
  const rules: [DocumentTopic, string[]][] = [
    ['product', ['产品', '需求', '说明书', '操作手册', '功能', '路线图']],
    ['engineering', ['研发', '架构', '接口', '设计', '代码', '技术', '测试']],
    ['support', ['客服', '话术', '投诉', '工单', '客户', '满意度']],
    ['security', ['安全', '漏洞', '权限', '合规', '审计', '加密', '应急']],
    ['operations', ['运维', '监控', '巡检', '变更', '故障', '服务器', '发布']],
    ['hr', ['员工', '绩效', '入职', '培训', '考勤', '招聘', '晋升']],
  ]
  for (const [topic, keywords] of rules) {
    if (keywords.some(k => name.includes(k))) return topic
  }
  return 'product'
}

/** 由规格构造一条 DocumentRecord（id / 时间 / 大小 / sha256 均确定性推导） */
function buildRecord(
  id: string,
  spec: DemoSeedSpec,
  origin: DocumentOrigin = 'demo',
): DocumentRecord {
  const updatedAt = new Date(
    BASE_TS - spec.updatedOffsetMinutes * 60_000,
  ).toISOString()
  const createdAt = new Date(
    BASE_TS - spec.updatedOffsetMinutes * 60_000 - spec.createdOffsetHours * 3_600_000,
  ).toISOString()

  return {
    id,
    title: spec.title,
    originalName: spec.originalName,
    kind: spec.kind,
    topic: spec.topic,
    origin,
    status: spec.status,
    progress: spec.progress,
    size: formatBytes(spec.sizeBytes),
    sizeBytes: spec.sizeBytes,
    sha256: sha256Hex(
      `demo:${spec.topic}:${spec.originalName}:${spec.sizeBytes}`,
    ),
    source: TOPIC_SOURCE[spec.topic],
    error: spec.error ?? null,
    createdAt,
    updatedAt,
  }
}

/**
 * 生成 128 条确定性演示资料。
 * 前 12 条为真实可读文件名，其余 116 条按主题轮换稳定生成。
 */
export function createDemoDocuments(): DocumentRecord[] {
  const docs: DocumentRecord[] = []

  REAL_SEEDS.forEach((spec, i) => {
    docs.push(buildRecord(`doc-${String(i + 1).padStart(4, '0')}`, spec))
  })

  const generatedCount = 128 - REAL_SEEDS.length

  for (let n = 0; n < generatedCount; n++) {
    const topic = TOPICS[n % TOPICS.length]
    const meta = TOPIC_META[topic]
    const q = Math.floor(n / TOPICS.length)
    const stem = meta.stems[q % meta.stems.length]
    const kind = meta.kinds[q % meta.kinds.length]
    const year = 2024 + (q % 2)
    const seq = String(q + 1).padStart(3, '0')
    const title = `${stem}-${year}-${seq}`
    const originalName = `${title}.${kind}`

    const status = statusForOrdinal(n)
    const progress =
      status === 'ready' ? 100 : status === 'processing' ? progressForOrdinal(n) : 0
    const sizeBytes = 180_000 + ((n * 137_011) % 23_500_000)

    const spec: DemoSeedSpec = {
      title,
      originalName,
      kind,
      topic,
      status,
      progress,
      sizeBytes,
      // 生成资料整体晚于前 12 条，保证「最近资料」优先展示真实文件名
      updatedOffsetMinutes: 300 + n * 43,
      createdOffsetHours: 24 + (n % 48),
      error:
        status === 'failed' ? FAILED_REASONS[n % FAILED_REASONS.length] : undefined,
    }

    docs.push(buildRecord(`doc-${String(REAL_SEEDS.length + n + 1).padStart(4, '0')}`, spec))
  }

  return docs
}
