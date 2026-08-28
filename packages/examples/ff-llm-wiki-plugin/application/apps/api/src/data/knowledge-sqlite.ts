import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DocumentWikiLink, WikiPageType } from '@llmwiki/contracts'
import type { WikiManifest } from '../wiki/compiler.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  compiled_at TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  types_json TEXT NOT NULL,
  sources_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_pages (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  page_type TEXT NOT NULL,
  topic TEXT NOT NULL,
  summary TEXT NOT NULL,
  page_json TEXT NOT NULL,
  compiled_at TEXT NOT NULL,
  is_dynamic INTEGER NOT NULL DEFAULT 0,
  source_document_id TEXT,
  published_at TEXT
);
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  page_slug TEXT NOT NULL,
  chunk_order INTEGER NOT NULL,
  origin TEXT NOT NULL,
  source_path TEXT,
  text TEXT NOT NULL,
  compiled_at TEXT NOT NULL,
  FOREIGN KEY(page_slug) REFERENCES knowledge_pages(slug) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_page ON knowledge_chunks(page_slug);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_origin ON knowledge_chunks(origin);
`

export interface KnowledgeStoreStats {
  pages: number
  chunks: number
  compiledAt: string | null
  persistent: boolean
}

/**
 * 问答知识层的 SQLite 仓库。
 * 编译产物只在版本变化时同步一次；运行期检索始终从数据库快照读取。
 */
export class SqliteKnowledgeRepository {
  private readonly db: Database.Database
  private readonly persistent: boolean

  constructor(dbPath: string) {
    this.persistent = dbPath !== ':memory:'
    if (this.persistent) mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.exec(SCHEMA)
    this.ensureColumn('knowledge_pages', 'is_dynamic', 'INTEGER NOT NULL DEFAULT 0')
    this.ensureColumn('knowledge_pages', 'source_document_id', 'TEXT')
    this.ensureColumn('knowledge_pages', 'published_at', 'TEXT')
  }

  private ensureColumn(table: string, name: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!columns.some(column => column.name === name)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
    }
  }

  sync(manifest: WikiManifest): void {
    const current = this.db
      .prepare('SELECT compiled_at FROM knowledge_meta WHERE id = 1')
      .get() as { compiled_at: string } | undefined
    if (current?.compiled_at === manifest.compiledAt) return

    const replaceMeta = this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_meta
        (id, schema_version, compiled_at, stats_json, types_json, sources_json)
      VALUES (1, ?, ?, ?, ?, ?)
    `)
    const insertPage = this.db.prepare(`
      INSERT INTO knowledge_pages
        (slug, title, page_type, topic, summary, page_json, compiled_at,
         is_dynamic, source_document_id, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)
    `)
    const insertChunk = this.db.prepare(`
      INSERT INTO knowledge_chunks
        (id, page_slug, chunk_order, origin, source_path, text, compiled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM knowledge_chunks
           WHERE page_slug IN (SELECT slug FROM knowledge_pages WHERE is_dynamic = 0)`,
        )
        .run()
      this.db.prepare('DELETE FROM knowledge_pages WHERE is_dynamic = 0').run()
      replaceMeta.run(
        manifest.schemaVersion,
        manifest.compiledAt,
        JSON.stringify(manifest.stats),
        JSON.stringify(manifest.types),
        JSON.stringify(manifest.sources),
      )

      for (const page of manifest.pages) {
        insertPage.run(
          page.slug,
          page.title,
          page.type,
          page.topic,
          page.summary,
          JSON.stringify(page),
          manifest.compiledAt,
        )

        let order = 0
        for (const text of page.conclusion) {
          insertChunk.run(
            `${page.slug}:conclusion:${order}`,
            page.slug,
            order++,
            'conclusion',
            null,
            text,
            manifest.compiledAt,
          )
        }
        for (const evidence of page.sourceEvidence) {
          for (const text of evidence.points) {
            insertChunk.run(
              `${page.slug}:evidence:${order}`,
              page.slug,
              order++,
              'evidence',
              evidence.source,
              text,
              manifest.compiledAt,
            )
          }
        }
      }
    })

    transaction()
  }

  /** 写入或更新一份由上传资料生成的 Wiki 页与问答检索分段。 */
  upsertDynamicPage(
    documentId: string,
    page: WikiManifest['pages'][number],
    publishedAt: string,
  ): void {
    const insertPage = this.db.prepare(`
      INSERT INTO knowledge_pages
        (slug, title, page_type, topic, summary, page_json, compiled_at,
         is_dynamic, source_document_id, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `)
    const insertChunk = this.db.prepare(`
      INSERT INTO knowledge_chunks
        (id, page_slug, chunk_order, origin, source_path, text, compiled_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    this.db.transaction(() => {
      const oldSlugs = this.db
        .prepare('SELECT slug FROM knowledge_pages WHERE source_document_id = ?')
        .all(documentId) as Array<{ slug: string }>
      for (const old of oldSlugs) {
        this.db.prepare('DELETE FROM knowledge_chunks WHERE page_slug = ?').run(old.slug)
        this.db.prepare('DELETE FROM knowledge_pages WHERE slug = ?').run(old.slug)
      }

      insertPage.run(
        page.slug,
        page.title,
        page.type,
        page.topic,
        page.summary,
        JSON.stringify(page),
        publishedAt,
        documentId,
        publishedAt,
      )

      let order = 0
      for (const text of page.conclusion) {
        insertChunk.run(
          `${page.slug}:conclusion:${order}`,
          page.slug,
          order++,
          'conclusion',
          null,
          text,
          publishedAt,
        )
      }
      for (const evidence of page.sourceEvidence) {
        for (const text of evidence.points) {
          insertChunk.run(
            `${page.slug}:evidence:${order}`,
            page.slug,
            order++,
            'evidence',
            evidence.source,
            text,
            publishedAt,
          )
        }
      }
    })()
  }

  removeDynamicByDocument(documentId: string): string[] {
    const rows = this.db
      .prepare('SELECT slug FROM knowledge_pages WHERE source_document_id = ?')
      .all(documentId) as Array<{ slug: string }>
    this.db.transaction(() => {
      for (const row of rows) {
        this.db.prepare('DELETE FROM knowledge_chunks WHERE page_slug = ?').run(row.slug)
        this.db.prepare('DELETE FROM knowledge_pages WHERE slug = ?').run(row.slug)
      }
    })()
    return rows.map(row => row.slug)
  }

  getDynamicLinksByDocument(documentId: string): DocumentWikiLink[] {
    const rows = this.db
      .prepare(
        `SELECT slug, title, published_at, compiled_at
         FROM knowledge_pages WHERE source_document_id = ?
         ORDER BY published_at DESC`,
      )
      .all(documentId) as Array<{
      slug: string
      title: string
      published_at: string | null
      compiled_at: string
    }>
    return rows.map(row => ({
      slug: row.slug,
      title: row.title,
      publishedAt: row.published_at ?? row.compiled_at,
      updatedAt: row.compiled_at,
    }))
  }

  getDynamicPipelineVersion(documentId: string): number {
    const row = this.db
      .prepare('SELECT page_json FROM knowledge_pages WHERE source_document_id = ? LIMIT 1')
      .get(documentId) as { page_json: string } | undefined
    if (!row) return 0
    try {
      const page = JSON.parse(row.page_json) as { pipelineVersion?: number }
      return page.pipelineVersion ?? 0
    } catch {
      return 0
    }
  }

  loadManifest(): WikiManifest {
    const meta = this.db.prepare('SELECT * FROM knowledge_meta WHERE id = 1').get() as
      | {
        schema_version: number
        compiled_at: string
        stats_json: string
        types_json: string
        sources_json: string
      }
      | undefined
    if (!meta) throw new Error('SQLite 知识库尚未同步编译产物')

    const rows = this.db
      .prepare(
        `SELECT page_json, is_dynamic, source_document_id, published_at
         FROM knowledge_pages
         ORDER BY is_dynamic DESC, published_at DESC, slug ASC`,
      )
      .all() as Array<{
      page_json: string
      is_dynamic: number
      source_document_id: string | null
      published_at: string | null
    }>

    const pages = rows.map(row => ({
      ...(JSON.parse(row.page_json) as WikiManifest['pages'][number]),
      sourceDocumentId: row.source_document_id,
      publishedAt: row.published_at,
      isDynamic: row.is_dynamic === 1,
    }))
    const compiledAt = pages
      .map(page => page.publishedAt ?? page.updated)
      .filter(Boolean)
      .sort()
      .at(-1) ?? meta.compiled_at
    const pageTypes: WikiPageType[] = ['concept', 'system', 'playbook', 'policy']
    const sourceMap = new Map<string, WikiManifest['sources'][number]>()
    for (const page of pages) {
      for (const evidence of page.sourceEvidence) {
        const current = sourceMap.get(evidence.source)
        sourceMap.set(evidence.source, {
          path: evidence.source,
          title: evidence.title,
          topic: evidence.topic,
          department: evidence.department,
          pageCount: (current?.pageCount ?? 0) + 1,
        })
      }
    }

    return {
      schemaVersion: meta.schema_version as 1,
      compiledAt,
      stats: {
        pages: pages.length,
        sourceCitations: pages.reduce((sum, page) => sum + page.sources.length, 0),
        interlinks: pages.reduce((sum, page) => sum + page.links.length, 0),
        topicsCovered: new Set(pages.map(page => page.topic)).size,
        lastCompiledAt: compiledAt,
      },
      types: pageTypes.map(type => ({
        type,
        count: pages.filter(page => page.type === type).length,
      })),
      sources: [...sourceMap.values()],
      pages,
    }
  }

  getStats(): KnowledgeStoreStats {
    const meta = this.db
      .prepare('SELECT compiled_at FROM knowledge_meta WHERE id = 1')
      .get() as { compiled_at: string } | undefined
    const pages = (this.db.prepare('SELECT COUNT(*) AS count FROM knowledge_pages').get() as { count: number }).count
    const chunks = (this.db.prepare('SELECT COUNT(*) AS count FROM knowledge_chunks').get() as { count: number }).count
    return { pages, chunks, compiledAt: meta?.compiled_at ?? null, persistent: this.persistent }
  }

  close() {
    this.db.close()
  }
}
