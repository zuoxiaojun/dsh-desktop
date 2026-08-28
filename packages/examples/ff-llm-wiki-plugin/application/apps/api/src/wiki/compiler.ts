import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  WIKI_PAGE_TYPE_LABELS,
  type DocumentTopic,
  type SourceEvidence,
  type WikiLinkTarget,
  type WikiPageType,
  type WikiSourceSummary,
  type WikiStats,
  type WikiTypeCount,
} from '@llmwiki/contracts'
import { KNOWLEDGE_UNITS } from './knowledge.js'
import { CLAUDE_MD_PATH, RAW_DIR, WIKI_DIR } from './paths.js'
import { withWikiLock } from './lock.js'

/* ============================================================
 * 确定性编译器（Ingest）
 * 读 raw/（只读）→ 按知识单元跨来源重组 → 写 wiki/（可再生）。
 * raw/ 一个字节不改、一个文件不增（红线，见 verify 脚本）。
 * ============================================================ */

const TOPICS = new Set<DocumentTopic>([
  'product',
  'engineering',
  'support',
  'security',
  'operations',
  'hr',
])

/** 源资料（raw/ 下 .md）的解析结果 */
export interface RawSource {
  path: string
  topic: DocumentTopic
  department: string
  updated: string
  title: string
  overview: string
  points: string[]
}

/** 机器可读 manifest 中的一个知识页 */
export interface ManifestPage {
  slug: string
  title: string
  type: WikiPageType
  topic: DocumentTopic
  summary: string
  updated: string
  sources: string[]
  conclusion: string[]
  sourceEvidence: SourceEvidence[]
  links: WikiLinkTarget[]
  /** 资料中心自动发布页的源文档；静态编译页为空。 */
  sourceDocumentId?: string | null
  publishedAt?: string | null
  isDynamic?: boolean
  /** 动态知识清洗管道版本，用于仅在规则升级时重建历史页面。 */
  pipelineVersion?: number
}

/** 机器可读 manifest（产物层的单一事实来源） */
export interface WikiManifest {
  schemaVersion: 1
  compiledAt: string
  stats: WikiStats
  types: WikiTypeCount[]
  sources: WikiSourceSummary[]
  pages: ManifestPage[]
}

/** 极简 frontmatter 解析（key: value，本阶段源文件只需扁平键值） */
function parseFrontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

function parseRawFile(path: string, content: string): RawSource {
  let fm: Record<string, string> = {}
  let body = content
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (m) {
    fm = parseFrontmatter(m[1])
    body = m[2]
  }

  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path
  const overview = body.match(/^>\s*(.+)$/m)?.[1]?.trim() ?? ''

  // 抽取「## 关键结论」下的列表项作为来源证据
  const points: string[] = []
  const lines = body.split('\n')
  let inPoints = false
  for (const line of lines) {
    if (/^##\s+关键结论/.test(line)) {
      inPoints = true
      continue
    }
    if (inPoints && /^##\s+/.test(line)) {
      inPoints = false
      continue
    }
    if (inPoints) {
      const pm = line.match(/^\s*-\s*(.+)$/)
      if (pm) points.push(pm[1].trim())
    }
  }

  const topic = TOPICS.has(fm.topic as DocumentTopic)
    ? (fm.topic as DocumentTopic)
    : 'product'

  return {
    path,
    topic,
    department: fm.department ?? '',
    updated: fm.updated ?? '',
    title,
    overview,
    points,
  }
}

/** 读取全部源资料（raw/ 只读） */
export function readRawSources(): RawSource[] {
  const files = readdirSync(RAW_DIR)
    .filter(f => f.endsWith('.md'))
    .sort()
  return files.map(file =>
    parseRawFile(`raw/${file}`, readFileSync(join(RAW_DIR, file), 'utf8')),
  )
}

/** 编译前的模型校验（Lint）：类型合法、来源存在、互链无悬空、无自链 */
function validateModel(rawByPath: Map<string, RawSource>): Map<string, string> {
  const slugs = new Set<string>()
  for (const u of KNOWLEDGE_UNITS) {
    if (slugs.has(u.slug)) throw new Error(`编译失败：重复 slug「${u.slug}」`)
    slugs.add(u.slug)
    for (const s of u.sources) {
      if (!rawByPath.has(s)) {
        throw new Error(`编译失败：知识单元「${u.slug}」引用了不存在的源「${s}」`)
      }
    }
  }
  for (const u of KNOWLEDGE_UNITS) {
    for (const l of u.links) {
      if (!slugs.has(l)) {
        throw new Error(`编译失败：知识单元「${u.slug}」指向不存在的页面「${l}」`)
      }
      if (l === u.slug) {
        throw new Error(`编译失败：知识单元「${u.slug}」不能自链`)
      }
    }
  }
  const titleBySlug = new Map(KNOWLEDGE_UNITS.map(u => [u.slug, u.title]))
  return titleBySlug
}

/**
 * 编译：读规则层 + 源层，生成 wiki/ 产物（47 页 + index.md + log.md + manifest.json）。
 * 返回 manifest（内存态），并落盘。对 raw/ 零写入。
 *
 * 对外暴露带跨进程锁的版本，防止并行测试/CLI/API 同时 rmSync 重建 content/wiki/
 * 引发 ENOTEMPTY 或读到半成品。内部无锁版 compileWikiInner 供 ensureWikiCompiled
 * 在「自持锁 + 二次检查」后调用，避免锁重入死锁。
 */
export function compileWiki(now = new Date()): WikiManifest {
  return withWikiLock(() => compileWikiInner(now))
}

export function compileWikiInner(now: Date): WikiManifest {
  // 1. 规则层（编译器动手前必须先读 CLAUDE.md）
  if (!existsSync(CLAUDE_MD_PATH)) {
    throw new Error(`编译失败：规则层 ${CLAUDE_MD_PATH} 不存在`)
  }
  const claude = readFileSync(CLAUDE_MD_PATH, 'utf8')
  for (const t of ['concept', 'system', 'playbook', 'policy'] as const) {
    if (!claude.includes(t)) {
      throw new Error(`编译失败：规则层 CLAUDE.md 缺少页面类型定义「${t}」`)
    }
  }

  // 2. 源层（只读）
  const rawSources = readRawSources()
  const rawByPath = new Map(rawSources.map(r => [r.path, r]))

  // 3. 校验知识模型（lint）
  const titleBySlug = validateModel(rawByPath)

  // 4. 跨来源重组：为每个知识单元组装结构化页面
  const pages: ManifestPage[] = KNOWLEDGE_UNITS.map((u) => {
    const cited = u.sources.map(s => rawByPath.get(s)!)
    const updated = cited.map(r => r.updated).sort().at(-1) ?? ''

    const sourceEvidence: SourceEvidence[] = cited.map(r => ({
      source: r.path,
      title: r.title,
      topic: r.topic,
      department: r.department,
      points: r.points,
    }))

    const links: WikiLinkTarget[] = u.links.map(l => ({
      slug: l,
      title: titleBySlug.get(l)!,
      type: KNOWLEDGE_UNITS.find(x => x.slug === l)!.type,
    }))

    return {
      slug: u.slug,
      title: u.title,
      type: u.type,
      topic: u.topic,
      summary: u.summary,
      updated,
      sources: u.sources,
      conclusion: u.conclusion,
      sourceEvidence,
      links,
    }
  })

  // 5. 统计口径（集中在此计算，前端不散落数字）
  const stats: WikiStats = {
    pages: pages.length,
    sourceCitations: pages.reduce((n, p) => n + p.sources.length, 0),
    interlinks: pages.reduce((n, p) => n + p.links.length, 0),
    topicsCovered: new Set(pages.map(p => p.topic)).size,
    lastCompiledAt: now.toISOString(),
  }

  const types: WikiTypeCount[] = (
    ['concept', 'system', 'playbook', 'policy'] as WikiPageType[]
  ).map(type => ({
    type,
    count: pages.filter(p => p.type === type).length,
  }))

  const sources: WikiSourceSummary[] = rawSources.map(r => ({
    path: r.path,
    title: r.title,
    topic: r.topic,
    department: r.department,
    pageCount: pages.filter(p => p.sources.includes(r.path)).length,
  }))

  const manifest: WikiManifest = {
    schemaVersion: 1,
    compiledAt: now.toISOString(),
    stats,
    types,
    sources,
    pages,
  }

  // 6. 落盘（只写 wiki/）
  writeWikiFiles(manifest, rawSources, now)

  return manifest
}

/** 把 manifest 渲染为 wiki/ 下的可读文件（互链带 wiki/ 前缀） */
function writeWikiFiles(
  manifest: WikiManifest,
  rawSources: RawSource[],
  now: Date,
): void {
  rmSync(WIKI_DIR, { recursive: true, force: true })
  mkdirSync(WIKI_DIR, { recursive: true })

  for (const p of manifest.pages) {
    const lines: string[] = [
      '---',
      `title: ${p.title}`,
      `type: ${p.type}`,
      `topic: ${p.topic}`,
      `slug: ${p.slug}`,
      'sources:',
      ...p.sources.map(s => `  - ${s}`),
      `updated: ${p.updated}`,
      '---',
      '',
      `# ${p.title}`,
      '',
      `> ${p.summary}`,
      '',
      '## 结论',
      '',
      ...p.conclusion.flatMap(c => [c, '']),
      '## 来源证据',
      '',
    ]

    for (const ev of p.sourceEvidence) {
      lines.push(`- **${ev.title}**（\`${ev.source}\` · ${ev.department}）`)
      for (const pt of ev.points) lines.push(`  - ${pt}`)
    }

    lines.push('', '## 相关页面', '')
    for (const l of p.links) {
      lines.push(`- [[wiki/${l.slug}|${l.title}]]`)
    }
    lines.push('')

    writeFileSync(join(WIKI_DIR, `${p.slug}.md`), lines.join('\n'), 'utf8')
  }

  writeIndex(manifest)
  writeLog(manifest, rawSources, now)
  writeFileSync(
    join(WIKI_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  )
}

/** index.md：按 type 分区列出所有页，每页一行摘要 + 链接 */
function writeIndex(manifest: WikiManifest): void {
  const lines: string[] = ['# 知识库索引', '']
  const order: WikiPageType[] = ['concept', 'system', 'playbook', 'policy']
  for (const t of order) {
    const typePages = manifest.pages.filter(p => p.type === t)
    if (typePages.length === 0) continue
    lines.push(`## ${WIKI_PAGE_TYPE_LABELS[t]}（${typePages.length}）`, '')
    for (const p of typePages) {
      lines.push(`- [[wiki/${p.slug}|${p.title}]] —— ${p.summary}`)
    }
    lines.push('')
  }
  writeFileSync(join(WIKI_DIR, 'index.md'), lines.join('\n'), 'utf8')
}

/** log.md：记录本次编译（含源层不可变的证据） */
function writeLog(
  manifest: WikiManifest,
  rawSources: RawSource[],
  now: Date,
): void {
  const lines: string[] = [
    '# 编译日志',
    '',
    `## ${now.toISOString()} 编译`,
    '',
    `- 源层 raw/：${rawSources.length} 个文件，零改动、零新增（源不可变红线满足）`,
    '',
    `- 产物层 wiki/：${manifest.stats.pages} 个知识页 + index.md + log.md + manifest.json`,
    `- 类型分布：${manifest.types.map(t => `${t.type} ${t.count}`).join(' · ')}`,
    `- 互链：${manifest.stats.interlinks} 条 · 来源引用：${manifest.stats.sourceCitations} 条 · 覆盖主题：${manifest.stats.topicsCovered}`,
    '',
  ]
  writeFileSync(join(WIKI_DIR, 'log.md'), lines.join('\n'), 'utf8')
}
