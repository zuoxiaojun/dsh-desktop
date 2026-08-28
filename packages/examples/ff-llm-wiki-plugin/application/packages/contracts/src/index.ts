/**
 * LLM Wiki 共享契约（contracts）
 *
 * 该包同时被 apps/api 与 apps/web 依赖，负责定义前后端之间传输的
 * 数据结构，并提供一份与 API 结构完全一致的演示数据，供前端在
 * API 不可用时兜底，保证首屏不为空白。
 */

/** 文档类型 */
export type DocumentKind = 'pdf' | 'docx' | 'md' | 'txt' | 'xlsx' | 'html'

/** 文档处理状态 */
export type DocumentStatus = 'ready' | 'processing' | 'queued' | 'failed'

/** 处理阶段状态 */
export type StageStatus = 'pending' | 'running' | 'done' | 'error'

/** 统计卡标识（与首页四张卡一一对应） */
export type StatKey = 'documents' | 'entries' | 'relationships' | 'todayQa'

/** /health 响应 */
export interface HealthResponse {
  status: 'ok'
  service: string
  version: string
  uptime: number
  timestamp: string
}

/** 首页统计卡数据 */
export interface OverviewStat {
  key: StatKey
  label: string
  value: number
  /** 相对上一周期的变化量，正负皆可 */
  delta: number
  /** 变化量的说明文案，如「本周新增」 */
  deltaLabel: string
}

/** 文档条目 */
export interface DocumentItem {
  id: string
  title: string
  kind: DocumentKind
  size: string
  status: DocumentStatus
  updatedAt: string
}

/** 处理阶段 */
export interface ProcessingStage {
  id: string
  name: string
  /** 0-100 */
  progress: number
  status: StageStatus
  detail: string
}

/** /api/overview 响应（前端演示数据与此结构完全一致） */
export interface OverviewResponse {
  stats: OverviewStat[]
  recentDocuments: DocumentItem[]
  processingProgress: ProcessingStage[]
  generatedAt: string
}

/** 生成一份演示用的首页总览数据（时间戳取当前时刻，便于演示） */
export function createDemoOverview(): OverviewResponse {
  return {
    stats: [
      {
        key: 'documents',
        label: '文档数',
        value: 128,
        delta: 12,
        deltaLabel: '本周新增',
      },
      {
        key: 'entries',
        label: '知识条目',
        value: 1243,
        delta: 86,
        deltaLabel: '本周新增',
      },
      {
        key: 'relationships',
        label: '关系数',
        value: 3210,
        delta: 214,
        deltaLabel: '本周新增',
      },
      {
        key: 'todayQa',
        label: '今日问答',
        value: 47,
        delta: 9,
        deltaLabel: '较昨日',
      },
    ],
    recentDocuments: [
      {
        id: 'doc-1008',
        title: '2025 年度设备维护手册 v3.2',
        kind: 'pdf',
        size: '24.6 MB',
        status: 'ready',
        updatedAt: '2025-08-16T09:24:00.000Z',
      },
      {
        id: 'doc-1007',
        title: '生产线安全操作规程（2025 修订）',
        kind: 'docx',
        size: '8.1 MB',
        status: 'ready',
        updatedAt: '2025-08-16T08:51:00.000Z',
      },
      {
        id: 'doc-1006',
        title: '供应商准入与资质清单 Q3',
        kind: 'xlsx',
        size: '3.4 MB',
        status: 'processing',
        updatedAt: '2025-08-15T18:02:00.000Z',
      },
      {
        id: 'doc-1005',
        title: '质量体系内审报告（上半年）',
        kind: 'pdf',
        size: '11.2 MB',
        status: 'ready',
        updatedAt: '2025-08-15T15:40:00.000Z',
      },
      {
        id: 'doc-1004',
        title: '设备台账与点检记录导出',
        kind: 'xlsx',
        size: '5.7 MB',
        status: 'queued',
        updatedAt: '2025-08-15T14:13:00.000Z',
      },
      {
        id: 'doc-1003',
        title: '应急预案与演练方案汇编',
        kind: 'md',
        size: '1.2 MB',
        status: 'failed',
        updatedAt: '2025-08-15T11:05:00.000Z',
      },
    ],
    processingProgress: [
      {
        id: 'stage-parse',
        name: '文件解析',
        progress: 100,
        status: 'done',
        detail: '128 / 128 份文档',
      },
      {
        id: 'stage-entity',
        name: '实体与条目抽取',
        progress: 100,
        status: 'done',
        detail: '已生成 1243 条知识条目',
      },
      {
        id: 'stage-graph',
        name: '关系与图谱构建',
        progress: 82,
        status: 'running',
        detail: '已构建 3210 条关系',
      },
      {
        id: 'stage-index',
        name: '向量化与索引',
        progress: 64,
        status: 'running',
        detail: '正在为知识条目生成向量',
      },
      {
        id: 'stage-qa',
        name: '问答服务就绪',
        progress: 0,
        status: 'pending',
        detail: '等待上游阶段完成',
      },
    ],
    generatedAt: new Date().toISOString(),
  }
}

/** 文档页使用的演示文档列表 */
export const DEMO_DOCUMENTS: DocumentItem[] = [
  {
    id: 'doc-1012',
    title: '高炉炼铁工艺标准作业指导书',
    kind: 'pdf',
    size: '18.9 MB',
    status: 'ready',
    updatedAt: '2025-08-16T10:02:00.000Z',
  },
  {
    id: 'doc-1011',
    title: '仓储物流与条码追溯规范',
    kind: 'docx',
    size: '6.3 MB',
    status: 'ready',
    updatedAt: '2025-08-16T09:44:00.000Z',
  },
  {
    id: 'doc-1010',
    title: '2025 年度设备维护手册 v3.2',
    kind: 'pdf',
    size: '24.6 MB',
    status: 'ready',
    updatedAt: '2025-08-16T09:24:00.000Z',
  },
  {
    id: 'doc-1009',
    title: '能源消耗统计与分析报表',
    kind: 'xlsx',
    size: '2.8 MB',
    status: 'processing',
    updatedAt: '2025-08-16T08:57:00.000Z',
  },
  {
    id: 'doc-1008',
    title: '生产线安全操作规程（2025 修订）',
    kind: 'docx',
    size: '8.1 MB',
    status: 'ready',
    updatedAt: '2025-08-16T08:51:00.000Z',
  },
  {
    id: 'doc-1007',
    title: '供应商准入与资质清单 Q3',
    kind: 'xlsx',
    size: '3.4 MB',
    status: 'processing',
    updatedAt: '2025-08-15T18:02:00.000Z',
  },
  {
    id: 'doc-1006',
    title: '质量体系内审报告（上半年）',
    kind: 'pdf',
    size: '11.2 MB',
    status: 'ready',
    updatedAt: '2025-08-15T15:40:00.000Z',
  },
  {
    id: 'doc-1005',
    title: '设备台账与点检记录导出',
    kind: 'xlsx',
    size: '5.7 MB',
    status: 'queued',
    updatedAt: '2025-08-15T14:13:00.000Z',
  },
  {
    id: 'doc-1004',
    title: '应急预案与演练方案汇编',
    kind: 'md',
    size: '1.2 MB',
    status: 'failed',
    updatedAt: '2025-08-15T11:05:00.000Z',
  },
]

/**
 * ============================================================
 * 资料导入与处理队列（STAGE-03）
 * 前后端共享的文档资料契约。演示数据/上传数据均遵循此结构，
 * 供「资料中心」列表、统计、导入、重新处理使用。
 * ============================================================
 */

/** 资料主题分类（演示资料覆盖的六大业务方向） */
export type DocumentTopic =
  | 'product'
  | 'engineering'
  | 'support'
  | 'security'
  | 'operations'
  | 'hr'

/** 资料来源：演示内置 / 手动上传 */
export type DocumentOrigin = 'demo' | 'upload'

/** 资料主题 → 业务语言标签 */
export const DOCUMENT_TOPIC_LABELS: Record<DocumentTopic, string> = {
  product: '产品',
  engineering: '研发',
  support: '客服',
  security: '安全',
  operations: '运维',
  hr: '人力',
}

/** 一份资料的完整记录（列表与详情共用） */
export interface DocumentRecord {
  id: string
  /** 显示名（不含扩展名） */
  title: string
  /** 原始文件名（含扩展名） */
  originalName: string
  kind: DocumentKind
  topic: DocumentTopic
  origin: DocumentOrigin
  status: DocumentStatus
  /** 处理进度 0-100 */
  progress: number
  /** 人类可读大小，如 "18.6 MB" */
  size: string
  /** 原始字节数 */
  sizeBytes: number
  /** 文件内容 sha256（重复检测依据） */
  sha256: string
  /** 来源部门 / 上传说明 */
  source: string
  /** 处理失败时的可读原因 */
  error: string | null
  createdAt: string
  updatedAt: string
}

/** 状态筛选值：具体状态，或 "all" 表示不过滤 */
export type DocumentsStatusFilter = DocumentStatus | 'all'
export type DocumentsKindFilter = DocumentKind | 'all'
export type DocumentsTopicFilter = DocumentTopic | 'all'
export type DocumentsOriginFilter = DocumentOrigin | 'all'

/** 列表查询参数 */
export interface DocumentsQuery {
  search?: string
  status?: DocumentsStatusFilter
  kind?: DocumentsKindFilter
  topic?: DocumentsTopicFilter
  origin?: DocumentsOriginFilter
  page?: number
  pageSize?: number
}

/** 全量统计（不受当前筛选影响） */
export interface DocumentsStats {
  total: number
  /** 已完成 */
  ready: number
  /** 处理中 */
  processing: number
  /** 待处理 */
  queued: number
  /** 异常 */
  failed: number
}

/** 单份资料从上传到可检索入库的处理阶段。 */
export type DocumentProcessingStageKey =
  | 'upload'
  | 'parse'
  | 'segment'
  | 'index'
  | 'complete'

export type DocumentProcessingStageStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'

export interface DocumentProcessingStage {
  key: DocumentProcessingStageKey
  label: string
  status: DocumentProcessingStageStatus
  progress: number
  message: string
  startedAt: string | null
  completedAt: string | null
}

/** 后端真实处理任务快照，前端通过轮询展示实时进度。 */
export interface DocumentProcessingJob {
  documentId: string
  status: DocumentStatus
  progress: number
  currentStage: DocumentProcessingStageKey
  stages: DocumentProcessingStage[]
  extractedChars: number
  chunkCount: number
  error: string | null
  startedAt: string
  updatedAt: string
  completedAt: string | null
}

/** GET /api/documents/:id/processing 响应 */
export interface DocumentProcessingResponse {
  ok: boolean
  document: DocumentRecord | null
  job: DocumentProcessingJob | null
  message: string
}

/** GET /api/documents 响应 */
export interface DocumentsListResponse {
  items: DocumentRecord[]
  stats: DocumentsStats
  page: number
  pageSize: number
  /** 符合当前筛选条件的总条数 */
  total: number
  totalPages: number
}

/** POST /api/documents（上传）响应 */
export interface UploadDocumentResult {
  ok: boolean
  /** 是否为重复文件 */
  duplicate: boolean
  document: DocumentRecord | null
  message: string
  /** 重复文件对应的既有资料 id */
  existingId?: string
  /** 新导入资料对应的真实处理任务 */
  processing?: DocumentProcessingJob
}

/** POST /api/documents/demo-seed 响应 */
export interface DemoSeedResult {
  ok: boolean
  /** 本次新写入条数 */
  seeded: number
  /** 已存在被跳过条数 */
  skipped: number
  total: number
}

/** POST /api/documents/:id/reprocess 响应 */
export interface ReprocessResult {
  ok: boolean
  document: DocumentRecord | null
  message: string
}

/** 文档解析后写入数据库的可追溯分段。 */
export interface DocumentChunkView {
  ordinal: number
  content: string
  charStart: number
  charEnd: number
}

/** 文档与自动生成 Wiki 页之间的一对一关联。 */
export interface DocumentWikiLink {
  slug: string
  title: string
  publishedAt: string
  updatedAt: string
}

/** GET /api/documents/:id 响应。 */
export interface DocumentDetailResponse {
  ok: boolean
  document: DocumentRecord | null
  processing: DocumentProcessingJob | null
  extractedText: string
  chunks: DocumentChunkView[]
  wikiPages: DocumentWikiLink[]
  message: string
}

/** PATCH /api/documents/:id 请求。 */
export interface UpdateDocumentRequest {
  title?: string
  topic?: DocumentTopic
  source?: string
}

/** PATCH /api/documents/:id 响应。 */
export interface UpdateDocumentResult {
  ok: boolean
  document: DocumentRecord | null
  wikiPages: DocumentWikiLink[]
  message: string
}

/** DELETE /api/documents/:id 响应。 */
export interface DeleteDocumentResult {
  ok: boolean
  id: string
  removedWikiSlugs: string[]
  message: string
}

/**
 * ============================================================
 * 编译式 Wiki（STAGE-04）
 * 编译产物 / API / 前端的共享契约。统计口径由编译器集中定义，
 * 前端只消费 API 返回的统计，不在组件里散落数字。
 * ============================================================
 */

/** 知识页类型（遵循 content/CLAUDE.md 规则层的 schema） */
export type WikiPageType = 'concept' | 'system' | 'playbook' | 'policy'

/** 知识页类型 → 业务语言标签 */
export const WIKI_PAGE_TYPE_LABELS: Record<WikiPageType, string> = {
  concept: '概念',
  system: '系统',
  playbook: '手册',
  policy: '策略',
}

/** 列表项（目录与搜索结果用，不含正文） */
export interface WikiPageListItem {
  slug: string
  title: string
  type: WikiPageType
  topic: DocumentTopic
  summary: string
  sourceCount: number
  linkCount: number
  updated: string
  /** 来自资料中心自动发布时，指向源资料。静态编译页为 null。 */
  sourceDocumentId?: string | null
  /** 自动发布/更新的时间，用于将新知识置前。 */
  publishedAt?: string | null
  isDynamic?: boolean
}

/** 全库统计（编译口径的单一来源） */
export interface WikiStats {
  /** 知识页总数 */
  pages: number
  /** 来源引用总数（所有页 sources 长度之和） */
  sourceCitations: number
  /** 互链总数（所有页 links 长度之和） */
  interlinks: number
  /** 覆盖主题数（去重） */
  topicsCovered: number
  /** 最近编译时间 */
  lastCompiledAt: string
}

/** 每个页面类型的数量分布 */
export interface WikiTypeCount {
  type: WikiPageType
  count: number
}

/** 来源概览（目录区的「来源数」） */
export interface WikiSourceSummary {
  path: string
  title: string
  topic: DocumentTopic
  department: string
  pageCount: number
}

/** 结构化正文的一个小节 */
export interface WikiSection {
  heading: string
  paragraphs: string[]
}

/** 来源证据（回指 raw 源文件的提取结论） */
export interface SourceEvidence {
  source: string
  title: string
  topic: DocumentTopic
  department: string
  points: string[]
}

/** 可点击的内部链接目标 */
export interface WikiLinkTarget {
  slug: string
  title: string
  type: WikiPageType
}

/** 单页详情 */
export interface WikiPageDetail {
  slug: string
  title: string
  type: WikiPageType
  topic: DocumentTopic
  summary: string
  updated: string
  /** 结论性正文（跨来源综合，非抄写） */
  conclusion: string[]
  sourceEvidence: SourceEvidence[]
  links: WikiLinkTarget[]
  sourceDocumentId?: string | null
  publishedAt?: string | null
  isDynamic?: boolean
}

/** GET /api/wiki 响应 */
export interface WikiListResponse {
  pages: WikiPageListItem[]
  stats: WikiStats
  types: WikiTypeCount[]
  sources: WikiSourceSummary[]
  total: number
}

/** 类型筛选值：具体类型，或 "all" 表示不过滤 */
export type WikiTypeFilter = WikiPageType | 'all'

/** 列表查询参数 */
export interface WikiQuery {
  search?: string
  type?: WikiTypeFilter
}

/** POST /api/wiki/recompile 响应 */
export interface WikiRecompileResult {
  ok: boolean
  stats: WikiStats
  pages: number
  message: string
}

/**
 * ============================================================
 * 知识图谱数据地基（STAGE-05）
 * 本地规则抽取演示模式：不调用大模型、不联网，只依据编译产物
 * （manifest.json + wiki 页面 frontmatter/正文标题/来源证据/[[wiki/..]] 内链）
 * 确定性生成节点与边。基础字段 relation 恒为 CO_OCCURS_IN 以兼容
 * Skill 的产物检查器，更具体的语义存到可选扩展字段 semantic。
 * ============================================================
 */

/** 图谱节点类型：知识页 / 来源文档 / 主题 / 页面类型 */
export type GraphNodeType = 'PAGE' | 'SOURCE' | 'TOPIC' | 'PAGE_TYPE'

/** 图谱边语义（扩展字段，基础字段 relation 恒为 CO_OCCURS_IN） */
export type GraphEdgeSemantic =
  | 'LINKS_TO'
  | 'HAS_SOURCE'
  | 'HAS_TOPIC'
  | 'HAS_TYPE'

/** 节点对齐质量（与 Skill 检查器 ACCEPTED_ALIGNMENTS 一致） */
export type GraphAlignment = 'match_exact' | 'match_greater' | 'match_lesser'

/** 图谱节点（字段契约见 rag-graphrag-pack 的 check_kg_output.py） */
export interface GraphNode {
  id: string
  name: string
  type: GraphNodeType
  source_doc: string
  char_start: number
  char_end: number
  confidence: GraphAlignment
  page: number
  /** 可选扩展字段：主题 / 类型节点的业务语言标签 */
  label?: string
}

/** 图谱边（字段契约见 check_kg_output.py；semantic/label 为可选扩展字段） */
export interface GraphEdge {
  source: string
  target: string
  relation: 'CO_OCCURS_IN'
  doc_id: string
  page: number
  /** 可选扩展字段：更具体的语义（不破坏 CO_OCCURS_IN 兼容） */
  semantic: GraphEdgeSemantic
  /** 可选扩展字段：语义的业务语言标签 */
  label: string
}

/** 图谱计数（全部从真实输出文件计算，不散落硬编码数字） */
export interface GraphCounts {
  nodes: number
  edges: number
  pageNodes: number
  sourceNodes: number
  topicNodes: number
  pageTypeNodes: number
  interlinkEdges: number
  sourceEdges: number
  topicEdges: number
  typeEdges: number
}

/** 节点类型分布 */
export interface GraphNodeTypeCount {
  type: GraphNodeType
  count: number
}

/** 边语义分布 */
export interface GraphEdgeSemanticCount {
  semantic: GraphEdgeSemantic
  count: number
}

/** 抽取模式标识（本地规则抽取演示模式） */
export type GraphExtractionMode = 'local-rule-extraction'

/** GET /api/graph 响应（图谱概览） */
export interface GraphOverviewResponse {
  mode: GraphExtractionMode
  stats: GraphCounts
  nodeTypes: GraphNodeTypeCount[]
  edgeSemantics: GraphEdgeSemanticCount[]
  /** 本次抽取的生成时间（来自 kg_meta.json） */
  generatedAt: string
  /** 抽取所依据的 manifest 编译时间（可追溯） */
  sourceManifestCompiledAt: string
}

/** GET /api/graph/nodes 响应 */
export interface GraphNodesResponse {
  nodes: GraphNode[]
  total: number
  types: GraphNodeTypeCount[]
}

/** GET /api/graph/edges 响应 */
export interface GraphEdgesResponse {
  edges: GraphEdge[]
  total: number
  semantics: GraphEdgeSemanticCount[]
}

/** POST /api/graph/extract 响应 */
export interface GraphExtractResult {
  ok: boolean
  mode: GraphExtractionMode
  stats: GraphCounts
  generatedAt: string
  message: string
}

/**
 * ============================================================
 * 可溯源知识问答（STAGE-08）
 * 检索只消费当前编译产物（manifest.json + wiki 页面结论/来源证据），
 * 不可复现、不可伪装的在线模型。答案必须由命中的真实片段组装。
 * ============================================================
 */

/** 问答请求 */
export interface QaRequest {
  /** 自然语言问题（非空） */
  question: string
  /** 生成模式：deepseek 使用模型生成，local 仅返回确定性检索片段 */
  generationMode?: 'deepseek' | 'local'
  /** DeepSeek 官方模型别名 */
  model?: QaModelId
  /** 生成温度（范围 0-1.5） */
  temperature?: number
  /** 单次回答的最大输出 Token 数（范围 256-4096） */
  maxTokens?: number
}

/** 当前支持的 DeepSeek 模型 */
export type QaModelId = 'deepseek-v4-flash' | 'deepseek-v4-pro'

/** 可公开给前端的模型配置（永不包含明文 API Key） */
export interface QaModelConfigResponse {
  provider: 'deepseek'
  configured: boolean
  endpoint: string
  credentialLabel: 'sk-****' | '未配置'
  credentialSource: 'environment' | 'credentials-file' | 'missing'
  defaultModel: QaModelId
  models: Array<{
    id: QaModelId
    label: string
    description: string
  }>
  knowledgeStore: {
    engine: 'SQLite'
    pages: number
    chunks: number
    persistent: boolean
  }
}

/** 前端“测试连接”响应 */
export interface QaConnectionTestResponse {
  ok: boolean
  provider: 'deepseek'
  model: QaModelId
  latencyMs: number
  message: string
}

/** 单条引用：命中一个真实片段（回指某个知识页的结论或来源证据点） */
export interface QaCitation {
  /** 全局递增引用编号（从 1 开始，.answers 中 [n] 与之对应） */
  id: number
  /** 知识页 slug（「查看原文」跳 /wiki?slug=…） */
  pageSlug: string
  /** 知识页标题 */
  pageTitle: string
  /** 命中的原文片段（真实文本，非改写） */
  snippet: string
  /** 片段来源：结论正文 / 来源证据点 */
  origin: 'conclusion' | 'evidence'
  /** 证据点的来源文档路径（origin=evidence 时回指 raw/…，结论时为空） */
  sourcePath: string | null
  /** 片段所在知识页的类型 */
  pageType: WikiPageType
  /** 检索得分（加权重排后，用于排序与置信度） */
  score: number
  /** 片段被采用的置信等级 */
  confidence: QaConfidence
}

/** 引用置信等级 */
export type QaConfidence = 'high' | 'medium' | 'low'

/** 回答段落：一段结论 + 引用角标编号列表 */
export interface QaAnswer {
  /** 文本（其中的 [n] 与 QaCitation.id 对应，前端渲染为角标） */
  text: string
  /** 本段引用的引用编号 */
  citations: number[]
}

/** 检索到但相关度不足、未采用的可核查资料（用于「无充分证据」兜底展示） */
export interface QaFallbackItem {
  pageSlug: string
  pageTitle: string
  summary: string
  pageType: WikiPageType
  score: number
}

/** 问答状态：有充分证据 / 证据不足 */
export type QaStatus = 'answered' | 'no_evidence'

/** POST /api/qa 响应 */
export interface QaResponse {
  status: QaStatus
  /** 结构化回答段落（status=answered 时非空） */
  answers: QaAnswer[]
  /** 命中的引用（与 answers 中 [n] 一一对应；status=no_evidence 时为空） */
  citations: QaCitation[]
  /** 证据不足时可核查的最相近资料 */
  fallback: QaFallbackItem[]
  /** 检索命中的文档数 / 采用的文档数（可追溯口径） */
  metrics: {
    searched: number
    matched: number
    adopted: number
  }
  /** 检索所依据的编译时间（manifest.compiledAt，可追溯） */
  compiledAt: string
  /** 总体置信等级（answered 时取引用最高档，no_evidence 时为 low） */
  confidence: QaConfidence
  /** 生成方式标识：模型 RAG / 本地检索 / 模型故障后的可追溯降级 */
  mode: 'deepseek-rag' | 'deepseek-chat' | 'local-weighted-retrieval' | 'local-fallback'
  /** 本次生成执行信息；纯检索函数可不携带，由服务层补充 */
  generation?: {
    provider: 'deepseek' | 'local'
    model: QaModelId | null
    latencyMs: number
    promptTokens: number | null
    completionTokens: number | null
    totalTokens: number | null
    /** 仅在模型不可用、回退本地答案时返回，不包含密钥与原始响应 */
    fallbackReason: string | null
  }
}

/**
 * ============================================================
 * 问答可复现评估（STAGE-09）
 * 题库 + 多维评估器 + 可复现环境 + 优化闭环。评估只消费编译产物
 * 与本地确定性检索纯函数，不调用在线模型、不碰生产数据。
 * ============================================================
 */

/** 题库用例类型（覆盖六类输入形态） */
export type EvalCaseKind =
  | 'direct_fact' // 直接事实：单页单一事实
  | 'cross_source' // 跨来源归纳：多源/多页共同主题
  | 'concept_link' // 概念关联：经内部链接/概念串联
  | 'citation_jump' // 引用跳转：期望命中指定来源证据点
  | 'no_evidence' // 无充分证据：期望诚实 no_evidence
  | 'adversarial' // 干扰输入：噪声/超长/无关表述

/** 一道题库用例（参考答案只写期望命中的 page/source/topic，不写死整段答案） */
export interface EvalCase {
  id: string
  kind: EvalCaseKind
  /** 自然语言问句 */
  question: string
  /** 期望状态：有证据 / 无证据 */
  expectStatus: QaStatus
  /** 期望命中的知识页 slug（子串/精确均可，供命中评估器收紧比对） */
  expectPageSlugs?: string[]
  /** 期望回指的来源文档路径（citation origin=evidence 时应回指 raw/…） */
  expectSourcePaths?: string[]
  /** 期望涵盖的主题（business 主题） */
  expectTopics?: DocumentTopic[]
  /**
   * 期望答案语义（关键词列表，用于证据覆盖评估器的宽松语义匹配）。
   * 非 exact_match——只要求回答片段覆盖这些语义片段，不写死整段答案。
   */
  expectAnswerCovers?: string[]
}

/** 单个评估器对单个用例的打分（契约：key/score/comment；不适用 score=null） */
export interface EvalScore {
  key: string
  score: number | null
  comment: string
}

/** 单个用例的评估结果（真实：question + 状态 + 命中 + 各指标打分） */
export interface EvalCaseResult {
  caseId: string
  kind: EvalCaseKind
  question: string
  status: QaStatus
  /** 命中的引用（去敏感后一段用于展示） */
  citations: {
    pageSlug: string
    pageTitle: string
    origin: 'conclusion' | 'evidence'
    sourcePath: string | null
  }[]
  /** 各评估器打分（含 score=null 的不适用项） */
  scores: EvalScore[]
}

/** 一次评估运行的汇总（一份成绩单） */
export interface EvalReport {
  /** 报告标识（base / after / …，用于优化前后对比） */
  runId: string
  /** 固定评估时间（EVAL_NOW，可复现） */
  evalNow: string
  /** 评估所依据的 manifest 编译时间 */
  manifestCompiledAt: string
  /** 题库总用例数 */
  caseCount: number
  /** 通过用例数（全部非 null 指标均为满分 1.0） */
  passed: number
  /** 总分（所有非 null 指标均分的百分制） */
  totalScore: number
  /** 逐指标均分（key -> {mean, n}；跳过 null 不污染分母） */
  metricMeans: Record<string, { mean: number; n: number }>
  /** 逐例结果（真实数据） */
  cases: EvalCaseResult[]
  /** 运行耗时（毫秒） */
  elapsedMs: number
  /** 运行时间戳（真实运行时刻） */
  generatedAt: string
  /** 可复现条件声明（供页面展示） */
  reproducibility: {
    fixedTime: boolean
    serial: boolean
    isolatedState: boolean
    prodDataTouched: boolean
  }
  /** 每例独立临时状态（本评估为每例独立构造 manifest，无共享可变状态） */
  seedResetPerCase: boolean
}

/** 评估指标键（七类指标，对应 coverage-accepting 的七类角度） */
export type EvalMetricKey =
  | 'answer_completed' // 回答是否完成（任务结果）
  | 'retrieval_hit' // 检索是否命中（工具与动作）
  | 'evidence_coverage' // 证据是否覆盖（依据与状态一致性）
  | 'citation_valid' // 引用是否存在且可打开（依据一致性）
  | 'answer_faithful' // 回答是否忠于证据（依据一致性）
  | 'no_answer_honest' // 无答案是否诚实（过程轨迹/安全）
  | 'input_robust' // 异常输入是否稳健（抗扰与回归）

/** GET /api/evaluation/latest 响应（前端 /evaluation 页数据源） */
export interface EvalLatestResponse {
  /** 最近一次报告；尚无评估产物时为 null（前端据实展示空态） */
  report: EvalReport | null
  /** 优化前基准报告（若存在，供优化前后对比展示） */
  baseline: EvalReport | null
  /** 对比结果（真实由 Skill eval_score_aggregate.py --compare 产出） */
  comparison: EvalComparison | null
}

/** 优化前后对比结果（结构对齐 Skill eval_score_aggregate.py --compare 输出） */
export interface EvalComparison {
  regressionFree: boolean
  regressions: string[]
  metrics: {
    key: string
    before: number | null
    after: number | null
    trend: '涨' | '跌' | '持平' | '仅一侧有'
  }[]
}
