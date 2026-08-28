import type {
  OverviewResponse,
  DocumentRecord,
  DocumentsListResponse,
  DocumentsQuery,
  DocumentsStats,
  DemoSeedResult,
  DocumentProcessingJob,
  DocumentChunkView,
  UpdateDocumentRequest,
} from '@llmwiki/contracts'

export interface DocumentChunkInput {
  ordinal: number
  content: string
  charStart: number
  charEnd: number
}

/**
 * 首页总览数据访问层契约（预留 SQLite）。
 */
export interface OverviewRepository {
  getOverview(): Promise<OverviewResponse>
}

/**
 * 资料导入与处理队列数据访问层契约。
 *
 * 当前由 SqliteDocumentRepository（better-sqlite3）实现真实持久化；
 * 后续替换存储实现时只需提供另一个实现本接口的仓储类，路由层无需改动。
 */
export interface DocumentRepository {
  /** 按搜索 / 状态筛选 + 分页返回资料列表与全量统计 */
  list(query: DocumentsQuery): Promise<DocumentsListResponse>

  /** 全量状态统计（已完成 / 处理中 / 待处理 / 异常） */
  getStats(): Promise<DocumentsStats>

  getById(id: string): Promise<DocumentRecord | null>

  /** 按文件内容 sha256 查重 */
  findBySha256(sha256: string): Promise<DocumentRecord | null>

  insert(doc: DocumentRecord): Promise<void>

  /** 更新资料处理状态与总进度。 */
  updateProcessingState(
    id: string,
    status: DocumentRecord['status'],
    progress: number,
    error?: string | null,
    now?: string,
  ): Promise<DocumentRecord | null>

  /** 持久化并读取处理任务快照。 */
  saveProcessingJob(job: DocumentProcessingJob): Promise<void>
  getProcessingJob(documentId: string): Promise<DocumentProcessingJob | null>

  /** 原子替换该资料的分段索引，返回实际写入数量。 */
  replaceDocumentChunks(documentId: string, chunks: DocumentChunkInput[]): Promise<number>
  getDocumentChunks(documentId: string): Promise<DocumentChunkView[]>

  /** 更新资料的业务元数据；文件指纹与处理事实不变。 */
  updateMetadata(
    id: string,
    patch: UpdateDocumentRequest,
    now?: string,
  ): Promise<DocumentRecord | null>

  /** 删除资料、处理任务和分段（外键级联）。 */
  delete(id: string): Promise<boolean>

  /** 服务启动时恢复已解析上传资料与 Wiki 的关联。 */
  listReadyUploads(): Promise<DocumentRecord[]>

  /** 将资料重新提交处理：状态置为 processing、进度清零、清除错误 */
  reprocess(id: string, now?: string): Promise<DocumentRecord | null>

  /** 幂等写入演示种子：已存在（按 id 或 sha256）则跳过 */
  seed(docs: DocumentRecord[]): Promise<DemoSeedResult>

  count(): Promise<number>

  close(): void
}
