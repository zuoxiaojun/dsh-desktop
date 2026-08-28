import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import type {
  DocumentProcessingJob,
  DocumentProcessingStage,
  DocumentProcessingStageKey,
  DocumentRecord,
} from '@llmwiki/contracts'
import type { DocumentChunkInput, DocumentRepository } from '../data/repository.js'
import type { DynamicWikiPublisher } from '../wiki/dynamic.js'

const STAGE_LABELS: Record<DocumentProcessingStageKey, string> = {
  upload: '文件接收',
  parse: '内容解析',
  segment: '文本分段',
  index: '知识入库',
  complete: '处理完成',
}

const STAGE_MESSAGES: Record<DocumentProcessingStageKey, string> = {
  upload: '原文件已持久化并完成完整性校验',
  parse: '正在提取正文与可检索文本',
  segment: '正在清洗文本并生成语义分段',
  index: '正在写入 SQLite 知识分段索引',
  complete: '资料已进入可检索状态',
}

const STAGE_PROGRESS: Record<DocumentProcessingStageKey, number> = {
  upload: 10,
  parse: 35,
  segment: 62,
  index: 90,
  complete: 100,
}

function stageList(now: string): DocumentProcessingStage[] {
  return (Object.keys(STAGE_LABELS) as DocumentProcessingStageKey[]).map(key => ({
    key,
    label: STAGE_LABELS[key],
    status: key === 'upload' ? 'done' : 'pending',
    progress: key === 'upload' ? STAGE_PROGRESS.upload : 0,
    message: key === 'upload' ? STAGE_MESSAGES.upload : '等待上一步完成',
    startedAt: key === 'upload' ? now : null,
    completedAt: key === 'upload' ? now : null,
  }))
}

function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function segmentText(text: string, maxChars = 900, overlap = 100): DocumentChunkInput[] {
  const chunks: DocumentChunkInput[] = []
  let cursor = 0

  while (cursor < text.length) {
    let end = Math.min(cursor + maxChars, text.length)
    if (end < text.length) {
      const newline = text.lastIndexOf('\n', end)
      const sentence = Math.max(
        text.lastIndexOf('。', end),
        text.lastIndexOf('！', end),
        text.lastIndexOf('？', end),
      )
      const boundary = Math.max(newline, sentence)
      if (boundary > cursor + Math.floor(maxChars * 0.55)) end = boundary + 1
    }

    const raw = text.slice(cursor, end)
    const leading = raw.length - raw.trimStart().length
    const content = raw.trim()
    if (content) {
      chunks.push({
        ordinal: chunks.length,
        content,
        charStart: cursor + leading,
        charEnd: cursor + leading + content.length,
      })
    }

    if (end >= text.length) break
    cursor = Math.max(cursor + 1, end - overlap)
  }

  return chunks
}

async function extractText(buffer: Buffer, kind: DocumentRecord['kind']): Promise<string> {
  if (kind === 'txt' || kind === 'md') return buffer.toString('utf8')

  if (kind === 'docx') {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }

  if (kind === 'pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      const result = await parser.getText()
      return result.text
    } finally {
      await parser.destroy()
    }
  }

  throw new Error(`暂不支持解析 ${kind.toUpperCase()} 文件`)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return '资料解析失败，请检查文件内容后重试'
}

/**
 * 单机异步资料处理器：原文件落盘 → 真实文本解析 → 分段 → SQLite 入库。
 * 任务快照与资料状态均持久化，前端只消费事实状态，不模拟进度。
 */
export class DocumentProcessor {
  private readonly uploadDir: string
  private readonly processedDir: string
  private readonly active = new Map<string, Promise<void>>()

  constructor(
    private readonly repo: DocumentRepository,
    storageRoot: string,
    private readonly stageDelayMs = 0,
    private readonly wikiPublisher?: DynamicWikiPublisher,
  ) {
    this.uploadDir = join(storageRoot, 'uploads')
    this.processedDir = join(storageRoot, 'processed')
  }

  private sourcePath(doc: DocumentRecord): string {
    return join(this.uploadDir, `${doc.id}.${doc.kind}`)
  }

  private outputDir(doc: DocumentRecord): string {
    return join(this.processedDir, doc.id)
  }

  private async holdForVisibility(): Promise<void> {
    if (this.stageDelayMs <= 0) return
    await new Promise(resolve => setTimeout(resolve, this.stageDelayMs))
  }

  private async persist(job: DocumentProcessingJob): Promise<void> {
    job.updatedAt = new Date().toISOString()
    await this.repo.saveProcessingJob(job)
    await this.repo.updateProcessingState(
      job.documentId,
      job.status,
      job.progress,
      job.error,
      job.updatedAt,
    )
  }

  private async markStage(
    job: DocumentProcessingJob,
    key: DocumentProcessingStageKey,
    status: DocumentProcessingStage['status'],
    message: string,
  ): Promise<void> {
    const now = new Date().toISOString()
    const stage = job.stages.find(item => item.key === key)
    if (!stage) throw new Error(`未知处理阶段：${key}`)

    job.currentStage = key
    stage.status = status
    stage.message = message
    if (status === 'running') {
      stage.startedAt ??= now
      job.status = 'processing'
      job.progress = Math.max(job.progress, Math.max(1, STAGE_PROGRESS[key] - 15))
    }
    if (status === 'done') {
      stage.startedAt ??= now
      stage.completedAt = now
      stage.progress = 100
      job.progress = STAGE_PROGRESS[key]
    }
    await this.persist(job)
  }

  private createJob(doc: DocumentRecord): DocumentProcessingJob {
    const now = new Date().toISOString()
    return {
      documentId: doc.id,
      status: 'queued',
      progress: STAGE_PROGRESS.upload,
      currentStage: 'upload',
      stages: stageList(now),
      extractedChars: 0,
      chunkCount: 0,
      error: null,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    }
  }

  private start(doc: DocumentRecord, job: DocumentProcessingJob): void {
    const previous = this.active.get(doc.id) ?? Promise.resolve()
    const task = previous
      .catch(() => undefined)
      .then(() => this.process(doc, job))
      .finally(() => {
        if (this.active.get(doc.id) === task) this.active.delete(doc.id)
      })
    this.active.set(doc.id, task)
  }

  async enqueue(doc: DocumentRecord, buffer: Buffer): Promise<DocumentProcessingJob> {
    await mkdir(this.uploadDir, { recursive: true })
    await writeFile(this.sourcePath(doc), buffer)
    const job = this.createJob(doc)
    await this.repo.saveProcessingJob(job)
    this.start(doc, job)
    return job
  }

  async reprocess(doc: DocumentRecord): Promise<DocumentProcessingJob> {
    const job = this.createJob(doc)
    await this.repo.saveProcessingJob(job)
    this.start(doc, job)
    return job
  }

  async get(documentId: string): Promise<DocumentProcessingJob | null> {
    return this.repo.getProcessingJob(documentId)
  }

  async getArtifacts(doc: DocumentRecord): Promise<{
    extractedText: string
    chunks: Awaited<ReturnType<DocumentRepository['getDocumentChunks']>>
  }> {
    const chunks = await this.repo.getDocumentChunks(doc.id)
    let extractedText = ''
    try {
      extractedText = await readFile(join(this.outputDir(doc), 'extracted.txt'), 'utf8')
    } catch {
      extractedText = chunks.map(chunk => chunk.content).join('\n\n')
    }
    return { extractedText, chunks }
  }

  async publishCurrent(doc: DocumentRecord): Promise<void> {
    if (!this.wikiPublisher || doc.status !== 'ready') return
    const { extractedText, chunks } = await this.getArtifacts(doc)
    if (extractedText && chunks.length > 0) {
      this.wikiPublisher.publish(doc, extractedText, chunks)
    }
  }

  getWikiLinks(documentId: string) {
    return this.wikiPublisher?.links(documentId) ?? []
  }

  /** 仅补齐历史已解析资料，已有 Wiki 关联不重复刷新发布时间。 */
  async publishReadyDocuments(): Promise<void> {
    if (!this.wikiPublisher) return
    for (const doc of await this.repo.listReadyUploads()) {
      if (this.wikiPublisher.links(doc.id).length > 0 && this.wikiPublisher.isCurrent(doc.id)) {
        continue
      }
      await this.publishCurrent(doc)
    }
  }

  async remove(doc: DocumentRecord): Promise<string[]> {
    await this.active.get(doc.id)?.catch(() => undefined)
    const removedWikiSlugs = this.wikiPublisher?.remove(doc.id) ?? []
    await Promise.all([
      rm(this.sourcePath(doc), { force: true }),
      rm(this.outputDir(doc), { recursive: true, force: true }),
    ])
    return removedWikiSlugs
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.active.values())
  }

  private async process(doc: DocumentRecord, job: DocumentProcessingJob): Promise<void> {
    try {
      await this.markStage(job, 'parse', 'running', STAGE_MESSAGES.parse)
      await this.holdForVisibility()
      const buffer = await readFile(this.sourcePath(doc))
      const text = normalizeText(await extractText(buffer, doc.kind))
      if (!text) throw new Error('未从文件中提取到可用文本，请检查文件是否为空或仅包含扫描图片')
      job.extractedChars = text.length
      await this.markStage(job, 'parse', 'done', `已提取 ${text.length.toLocaleString('zh-CN')} 个字符`)

      await this.markStage(job, 'segment', 'running', STAGE_MESSAGES.segment)
      await this.holdForVisibility()
      const chunks = segmentText(text)
      if (chunks.length === 0) throw new Error('文本分段失败，未生成有效知识片段')
      job.chunkCount = chunks.length
      const outputDir = this.outputDir(doc)
      await mkdir(outputDir, { recursive: true })
      await Promise.all([
        writeFile(join(outputDir, 'extracted.txt'), text, 'utf8'),
        writeFile(join(outputDir, 'chunks.json'), JSON.stringify(chunks, null, 2), 'utf8'),
      ])
      await this.markStage(job, 'segment', 'done', `已生成 ${chunks.length} 个可追溯分段`)

      await this.markStage(job, 'index', 'running', STAGE_MESSAGES.index)
      await this.holdForVisibility()
      const inserted = await this.repo.replaceDocumentChunks(doc.id, chunks)
      job.chunkCount = inserted
      const latest = (await this.repo.getById(doc.id)) ?? doc
      this.wikiPublisher?.publish(latest, text, chunks)
      await this.markStage(
        job,
        'index',
        'done',
        `已写入 ${inserted} 个知识分段，并发布关联 Wiki`,
      )

      await this.markStage(job, 'complete', 'running', '正在校验处理结果')
      await this.holdForVisibility()
      job.status = 'ready'
      job.error = null
      job.completedAt = new Date().toISOString()
      await this.markStage(job, 'complete', 'done', STAGE_MESSAGES.complete)
    } catch (error) {
      const message = errorMessage(error)
      const stage = job.stages.find(item => item.key === job.currentStage)
      if (stage) {
        stage.status = 'failed'
        stage.message = message
        stage.completedAt = new Date().toISOString()
      }
      job.status = 'failed'
      job.error = message
      job.completedAt = new Date().toISOString()
      await this.persist(job)
    }
  }
}
