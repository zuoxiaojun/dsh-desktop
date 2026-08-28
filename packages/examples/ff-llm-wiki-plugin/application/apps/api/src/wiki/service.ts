import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  WikiListResponse,
  WikiPageDetail,
  WikiPageListItem,
  WikiQuery,
  WikiRecompileResult,
} from '@llmwiki/contracts'
import { compileWiki, compileWikiInner, type WikiManifest } from './compiler.js'
import { WIKI_DIR } from './paths.js'
import { withWikiLock } from './lock.js'
import type { SqliteKnowledgeRepository } from '../data/knowledge-sqlite.js'

/**
 * Wiki 数据服务：以 manifest.json（机器可读编译产物）为单一事实来源。
 * 列表 / 搜索 / 类型筛选 / 详情都只读 manifest，不重新通读 raw/。
 */
const MANIFEST_PATH = join(WIKI_DIR, 'manifest.json')

/** 首次启动若产物缺失则自动编译（持锁 + 二次检查，避免与并发编译竞争）。 */
export function ensureWikiCompiled(): void {
  withWikiLock(() => {
    if (!existsSync(MANIFEST_PATH)) {
      compileWikiInner(new Date())
    }
  })
}

export function readManifest(): WikiManifest {
  ensureWikiCompiled()
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as WikiManifest
}

function toListItem(
  p: WikiManifest['pages'][number],
): WikiPageListItem {
  return {
    slug: p.slug,
    title: p.title,
    type: p.type,
    topic: p.topic,
    summary: p.summary,
    sourceCount: p.sources.length,
    linkCount: p.links.length,
    updated: p.updated,
    sourceDocumentId: p.sourceDocumentId ?? null,
    publishedAt: p.publishedAt ?? null,
    isDynamic: p.isDynamic ?? false,
  }
}

/** 列表：搜索（标题 / 摘要 / slug）+ 类型筛选 */
export function listWiki(
  query: WikiQuery = {},
  manifest: WikiManifest = readManifest(),
): WikiListResponse {
  const search = query.search?.trim().toLowerCase() ?? ''
  const type = query.type && query.type !== 'all' ? query.type : null

  let pages = manifest.pages
  if (type) pages = pages.filter(p => p.type === type)
  if (search) {
    pages = pages.filter(
      p =>
        p.title.toLowerCase().includes(search) ||
        p.summary.toLowerCase().includes(search) ||
        p.slug.toLowerCase().includes(search),
    )
  }

  return {
    pages: pages.map(toListItem),
    stats: manifest.stats,
    types: manifest.types,
    sources: manifest.sources,
    total: pages.length,
  }
}

/** 单页详情 */
export function getWikiPage(
  slug: string,
  manifest: WikiManifest = readManifest(),
): WikiPageDetail | null {
  const page = manifest.pages.find(p => p.slug === slug)
  if (!page) return null
  return {
    slug: page.slug,
    title: page.title,
    type: page.type,
    topic: page.topic,
    summary: page.summary,
    updated: page.updated,
    conclusion: page.conclusion,
    sourceEvidence: page.sourceEvidence,
    links: page.links,
    sourceDocumentId: page.sourceDocumentId ?? null,
    publishedAt: page.publishedAt ?? null,
    isDynamic: page.isDynamic ?? false,
  }
}

/** 重新编译：真实重跑编译器并更新产物（不碰 raw/） */
export function recompileWiki(
  knowledgeRepo?: SqliteKnowledgeRepository,
): WikiRecompileResult {
  const staticManifest = compileWiki()
  knowledgeRepo?.sync(staticManifest)
  const manifest = knowledgeRepo?.loadManifest() ?? staticManifest
  return {
    ok: true,
    stats: manifest.stats,
    pages: manifest.stats.pages,
    message: `重新编译完成：${manifest.stats.pages} 个知识页已更新`,
  }
}
