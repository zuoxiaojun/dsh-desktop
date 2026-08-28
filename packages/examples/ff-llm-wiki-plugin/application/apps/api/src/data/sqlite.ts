import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  DemoSeedResult,
  DocumentRecord,
  DocumentsListResponse,
  DocumentsQuery,
  DocumentsStats,
  DocumentProcessingJob,
  DocumentChunkView,
  UpdateDocumentRequest,
} from '@llmwiki/contracts'
import type { DocumentChunkInput, DocumentRepository } from './repository.js'

/**
 * 资料导入与处理队列 SQLite 数据层（better-sqlite3 真实持久化）。
 *
 * 表结构只保存「原始文件元数据」，文件内容解析留待后续阶段；
 * sha256 建唯一索引，作为重复检测的事实来源。
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  topic TEXT NOT NULL,
  origin TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  size TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at);

CREATE TABLE IF NOT EXISTS document_processing_jobs (
  document_id TEXT PRIMARY KEY,
  job_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS document_chunks (
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  content TEXT NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(document_id, ordinal),
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id
  ON document_chunks(document_id);
`

const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 100

/** SQLite 行（snake_case）→ 契约结构（camelCase） */
function rowToRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    title: row.title,
    originalName: row.original_name,
    kind: row.kind as DocumentRecord['kind'],
    topic: row.topic as DocumentRecord['topic'],
    origin: row.origin as DocumentRecord['origin'],
    status: row.status as DocumentRecord['status'],
    progress: row.progress,
    size: row.size,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    source: row.source,
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

interface DocumentRow {
  id: string
  title: string
  original_name: string
  kind: string
  topic: string
  origin: string
  status: string
  progress: number
  size: string
  size_bytes: number
  sha256: string
  source: string
  error: string | null
  created_at: string
  updated_at: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export class SqliteDocumentRepository implements DocumentRepository {
  private db: Database.Database

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true })
    }
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA)
  }

  async list(query: DocumentsQuery): Promise<DocumentsListResponse> {
    const page = toPositiveInt(query.page, 1)
    const pageSize = clamp(toPositiveInt(query.pageSize, DEFAULT_PAGE_SIZE), 1, MAX_PAGE_SIZE)

    const conditions: string[] = []
    const params: (string | number)[] = []

    if (query.status && query.status !== 'all') {
      conditions.push('status = ?')
      params.push(query.status)
    }

    if (query.kind && query.kind !== 'all') {
      conditions.push('kind = ?')
      params.push(query.kind)
    }

    if (query.topic && query.topic !== 'all') {
      conditions.push('topic = ?')
      params.push(query.topic)
    }

    if (query.origin && query.origin !== 'all') {
      conditions.push('origin = ?')
      params.push(query.origin)
    }

    const search = query.search?.trim()
    if (search) {
      conditions.push('(title LIKE ? OR original_name LIKE ? OR source LIKE ?)')
      const like = `%${search}%`
      params.push(like, like, like)
    }

    const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS c FROM documents ${whereSql}`)
        .get(...params) as { c: number }
    ).c

    const offset = (page - 1) * pageSize
    const rows = this.db
      .prepare(
        `SELECT * FROM documents ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, offset) as DocumentRow[]

    return {
      items: rows.map(rowToRecord),
      stats: await this.getStats(),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    }
  }

  async getStats(): Promise<DocumentsStats> {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END), 0) AS ready,
          COALESCE(SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END), 0) AS processing,
          COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0) AS queued,
          COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
        FROM documents`,
      )
      .get() as { total: number; ready: number; processing: number; queued: number; failed: number }

    return row
  }

  async getById(id: string): Promise<DocumentRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM documents WHERE id = ?')
      .get(id) as DocumentRow | undefined
    return row ? rowToRecord(row) : null
  }

  async findBySha256(sha256: string): Promise<DocumentRecord | null> {
    const row = this.db
      .prepare('SELECT * FROM documents WHERE sha256 = ?')
      .get(sha256) as DocumentRow | undefined
    return row ? rowToRecord(row) : null
  }

  async insert(doc: DocumentRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO documents (
          id, title, original_name, kind, topic, origin, status, progress,
          size, size_bytes, sha256, source, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        doc.id,
        doc.title,
        doc.originalName,
        doc.kind,
        doc.topic,
        doc.origin,
        doc.status,
        doc.progress,
        doc.size,
        doc.sizeBytes,
        doc.sha256,
        doc.source,
        doc.error,
        doc.createdAt,
        doc.updatedAt,
      )
  }

  async updateProcessingState(
    id: string,
    status: DocumentRecord['status'],
    progress: number,
    error: string | null = null,
    now = new Date().toISOString(),
  ): Promise<DocumentRecord | null> {
    const result = this.db
      .prepare(
        `UPDATE documents
         SET status = ?, progress = ?, error = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(status, clamp(Math.round(progress), 0, 100), error, now, id)
    return result.changes > 0 ? this.getById(id) : null
  }

  async saveProcessingJob(job: DocumentProcessingJob): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO document_processing_jobs (document_id, job_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(document_id) DO UPDATE SET
           job_json = excluded.job_json,
           updated_at = excluded.updated_at`,
      )
      .run(job.documentId, JSON.stringify(job), job.updatedAt)
  }

  async getProcessingJob(documentId: string): Promise<DocumentProcessingJob | null> {
    const row = this.db
      .prepare('SELECT job_json FROM document_processing_jobs WHERE document_id = ?')
      .get(documentId) as { job_json: string } | undefined
    return row ? (JSON.parse(row.job_json) as DocumentProcessingJob) : null
  }

  async replaceDocumentChunks(
    documentId: string,
    chunks: DocumentChunkInput[],
  ): Promise<number> {
    const remove = this.db.prepare('DELETE FROM document_chunks WHERE document_id = ?')
    const insert = this.db.prepare(
      `INSERT INTO document_chunks (
        document_id, ordinal, content, char_start, char_end, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const now = new Date().toISOString()
    const replace = this.db.transaction((items: DocumentChunkInput[]) => {
      remove.run(documentId)
      for (const chunk of items) {
        insert.run(
          documentId,
          chunk.ordinal,
          chunk.content,
          chunk.charStart,
          chunk.charEnd,
          now,
        )
      }
    })
    replace(chunks)
    return chunks.length
  }

  async getDocumentChunks(documentId: string): Promise<DocumentChunkView[]> {
    return this.db
      .prepare(
        `SELECT ordinal, content, char_start AS charStart, char_end AS charEnd
         FROM document_chunks
         WHERE document_id = ?
         ORDER BY ordinal ASC`,
      )
      .all(documentId) as DocumentChunkView[]
  }

  async updateMetadata(
    id: string,
    patch: UpdateDocumentRequest,
    now = new Date().toISOString(),
  ): Promise<DocumentRecord | null> {
    const current = await this.getById(id)
    if (!current) return null
    this.db
      .prepare(
        `UPDATE documents
         SET title = ?, topic = ?, source = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.title ?? current.title,
        patch.topic ?? current.topic,
        patch.source ?? current.source,
        now,
        id,
      )
    return this.getById(id)
  }

  async delete(id: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM documents WHERE id = ?').run(id).changes > 0
  }

  async listReadyUploads(): Promise<DocumentRecord[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM documents
         WHERE origin = 'upload' AND status = 'ready'
         ORDER BY updated_at DESC`,
      )
      .all() as DocumentRow[]
    return rows.map(rowToRecord)
  }

  async reprocess(id: string, now = new Date().toISOString()): Promise<DocumentRecord | null> {
    const existing = this.db.prepare('SELECT id FROM documents WHERE id = ?').get(id)
    if (!existing) return null

    this.db
      .prepare(
        `UPDATE documents
         SET status = 'processing', progress = 0, error = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, id)

    return this.getById(id)
  }

  async seed(docs: DocumentRecord[]): Promise<DemoSeedResult> {
    let seeded = 0
    let skipped = 0

    const hasId = this.db.prepare('SELECT id FROM documents WHERE id = ?')
    const hasSha = this.db.prepare('SELECT id FROM documents WHERE sha256 = ?')
    const insert = this.db.prepare(
      `INSERT INTO documents (
        id, title, original_name, kind, topic, origin, status, progress,
        size, size_bytes, sha256, source, error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    const run = this.db.transaction((list: DocumentRecord[]) => {
      for (const doc of list) {
        const exists = hasId.get(doc.id) ?? hasSha.get(doc.sha256)
        if (exists) {
          skipped += 1
          continue
        }
        insert.run(
          doc.id,
          doc.title,
          doc.originalName,
          doc.kind,
          doc.topic,
          doc.origin,
          doc.status,
          doc.progress,
          doc.size,
          doc.sizeBytes,
          doc.sha256,
          doc.source,
          doc.error,
          doc.createdAt,
          doc.updatedAt,
        )
        seeded += 1
      }
    })

    run(docs)

    return { ok: true, seeded, skipped, total: docs.length }
  }

  async count(): Promise<number> {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number }
    return row.c
  }

  close(): void {
    this.db.close()
  }
}
