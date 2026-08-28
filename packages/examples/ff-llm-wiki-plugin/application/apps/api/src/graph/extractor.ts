import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type {
  DocumentTopic,
  GraphCounts,
  GraphEdge,
  GraphEdgeSemantic,
  GraphEdgeSemanticCount,
  GraphExtractResult,
  GraphNode,
  GraphNodeType,
  GraphNodeTypeCount,
  WikiPageType,
} from '@llmwiki/contracts'
import { DOCUMENT_TOPIC_LABELS, WIKI_PAGE_TYPE_LABELS } from '@llmwiki/contracts'
import type { WikiManifest } from '../wiki/compiler.js'
import { CONTENT_ROOT, RAW_DIR, WIKI_DIR } from '../wiki/paths.js'
import { withWikiLock } from '../wiki/lock.js'
import { KG_EDGES_PATH, KG_META_PATH, KG_NODES_PATH, OUTPUT_DIR } from './paths.js'

/* ============================================================
 * 本地规则抽取演示模式（无模型、无网络、确定性）
 *
 * 只依据上一阶段真实编译产物：
 *   - content/wiki/manifest.json（机器可读单一事实来源）
 *   - content/wiki/<slug>.md 的 frontmatter、正文标题与 [[wiki/..]] 内链
 *   - content/raw/<file>.md 的正文标题（来源证据定位）
 * 产出的 kg_nodes.json / kg_edges.json 满足 rag-graphrag-pack 的
 * check_kg_output.py 数据契约：节点必备字段齐全、按 (name.lower(), type)
 * 去重、无孤儿边、无自环、confidence 全在可信对齐集。
 * ============================================================ */

const MANIFEST_PATH = join(WIKI_DIR, 'manifest.json')

/** 与 CLAUDE.md 规则层一致的页面类型 schema 顺序（确定性输出用） */
const PAGE_TYPE_ORDER: WikiPageType[] = ['concept', 'system', 'playbook', 'policy']

/** 抽取所依据的 manifest 结构 */
interface GraphBuild {
  nodes: GraphNode[]
  edges: GraphEdge[]
  sourceManifestCompiledAt: string
}

/** 在真实文本中定位锚点，返回字符区间；找不到即抛错（不降级为低质量对齐） */
function locateSpan(haystack: string, needle: string): { start: number; end: number } {
  const i = haystack.indexOf(needle)
  if (i < 0) {
    throw new Error(`本地规则抽取失败：无法在文本中定位锚点「${needle}」`)
  }
  return { start: i, end: i + needle.length }
}

/** 解析页面正文里带 wiki/ 前缀的 [[wiki/<slug>|别名]] 内链，返回目标 slug 列表 */
function parseWikilinks(text: string): string[] {
  const slugs: string[] = []
  const re = /\[\[wiki\/([a-z0-9-]+)(?:\|[^\]]*)?\]\]/g
  for (const m of text.matchAll(re)) {
    slugs.push(m[1])
  }
  return slugs
}

function readManifest(): WikiManifest {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`图谱抽取失败：找不到编译产物 ${MANIFEST_PATH}，请先运行 pnpm wiki:compile`)
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as WikiManifest
}

/**
 * 纯函数：从编译产物构建图谱（节点 + 边），不含时间戳，保证确定性。
 * 不写任何文件、不碰 raw/。
 * 持跨进程锁读取 content/wiki/，避免与并发编译读到半成品。
 */
export function buildGraph(): GraphBuild {
  return withWikiLock(() => buildGraphInner())
}

function buildGraphInner(): GraphBuild {
  const manifest = readManifest()

  // 组装真实文本（正文标题 / 内链 / 来源定位），一次性读入
  const pageText = new Map<string, string>()
  for (const p of manifest.pages) {
    pageText.set(p.slug, readFileSync(join(WIKI_DIR, `${p.slug}.md`), 'utf8'))
  }
  const rawText = new Map<string, string>()
  for (const s of manifest.sources) {
    rawText.set(s.path, readFileSync(join(CONTENT_ROOT, s.path), 'utf8'))
  }
  const manifestText = readFileSync(MANIFEST_PATH, 'utf8')

  const nodes: GraphNode[] = []
  const pageIdBySlug = new Map<string, string>()
  const sourceIdByPath = new Map<string, string>()
  const topicIdByCode = new Map<string, string>()
  const typeIdByType = new Map<string, string>()

  const pushNode = (
    name: string,
    type: GraphNodeType,
    sourceDoc: string,
    charStart: number,
    charEnd: number,
    label?: string,
  ): string => {
    const id = `node_${nodes.length}`
    nodes.push({
      id,
      name,
      type,
      source_doc: sourceDoc,
      char_start: charStart,
      char_end: charEnd,
      confidence: 'match_exact',
      page: 0,
      ...(label ? { label } : {}),
    })
    return id
  }

  // 1. 知识页节点（PAGE）：正文标题 # <title> 的字符区间作证据
  const pages = [...manifest.pages].sort((a, b) => a.slug.localeCompare(b.slug))
  for (const p of pages) {
    const span = locateSpan(pageText.get(p.slug)!, `# ${p.title}`)
    const id = pushNode(p.title, 'PAGE', `wiki/${p.slug}.md`, span.start, span.end)
    pageIdBySlug.set(p.slug, id)
  }

  // 2. 来源文档节点（SOURCE）：raw 源文件正文标题的字符区间作证据
  const sources = [...manifest.sources].sort((a, b) => a.path.localeCompare(b.path))
  for (const s of sources) {
    const span = locateSpan(rawText.get(s.path)!, `# ${s.title}`)
    const id = pushNode(s.title, 'SOURCE', s.path, span.start, span.end)
    sourceIdByPath.set(s.path, id)
  }

  // 3. 主题节点（TOPIC）：锚定 manifest.json 中的 "topic": "<code>"
  const topics = [...new Set(manifest.pages.map(p => p.topic))].sort()
  for (const topic of topics) {
    const span = locateSpan(manifestText, `"topic": "${topic}"`)
    const id = pushNode(
      topic,
      'TOPIC',
      'wiki/manifest.json',
      span.start,
      span.end,
      DOCUMENT_TOPIC_LABELS[topic as DocumentTopic],
    )
    topicIdByCode.set(topic, id)
  }

  // 4. 页面类型节点（PAGE_TYPE）：锚定 manifest.json 中的 "type": "<type>"
  for (const type of PAGE_TYPE_ORDER) {
    if (!manifest.types.some(t => t.type === type)) continue
    const span = locateSpan(manifestText, `"type": "${type}"`)
    const id = pushNode(
      type,
      'PAGE_TYPE',
      'wiki/manifest.json',
      span.start,
      span.end,
      WIKI_PAGE_TYPE_LABELS[type],
    )
    typeIdByType.set(type, id)
  }

  // 5. 建边：同一观察文档（页面）内表达四种语义；基础字段 relation 恒为 CO_OCCURS_IN
  const edges: GraphEdge[] = []
  const addEdge = (
    source: string,
    target: string,
    docId: string,
    semantic: GraphEdgeSemantic,
    label: string,
  ): void => {
    edges.push({
      source,
      target,
      relation: 'CO_OCCURS_IN',
      doc_id: docId,
      page: 0,
      semantic,
      label,
    })
  }

  for (const p of pages) {
    const pageId = pageIdBySlug.get(p.slug)!

    // 5a. 页面 → 来源（HAS_SOURCE）：来自 frontmatter/manifest 的 sources
    for (const src of [...p.sources].sort()) {
      const sourceId = sourceIdByPath.get(src)
      if (!sourceId) {
        throw new Error(`图谱抽取失败：页面「${p.slug}」引用了不存在的来源「${src}」`)
      }
      addEdge(pageId, sourceId, p.slug, 'HAS_SOURCE', '来源')
    }

    // 5b. 页面 → 主题（HAS_TOPIC）
    addEdge(pageId, topicIdByCode.get(p.topic)!, p.slug, 'HAS_TOPIC', '主题')

    // 5c. 页面 → 页面类型（HAS_TYPE）
    addEdge(pageId, typeIdByType.get(p.type)!, p.slug, 'HAS_TYPE', '类型')

    // 5d. 页面 → 页面（LINKS_TO）：来自正文真实渲染的 [[wiki/..]] 内链
    const wikilinkSlugs = parseWikilinks(pageText.get(p.slug)!)
    const manifestTargets = p.links.map(l => l.slug)
    const sortedWikilinks = [...wikilinkSlugs].sort()
    const sortedManifest = [...manifestTargets].sort()
    if (JSON.stringify(sortedWikilinks) !== JSON.stringify(sortedManifest)) {
      throw new Error(
        `图谱抽取失败：页面「${p.slug}」正文内链与 manifest.links 不一致`,
      )
    }
    for (const target of sortedWikilinks) {
      const targetId = pageIdBySlug.get(target)
      if (!targetId) {
        throw new Error(`图谱抽取失败：页面「${p.slug}」存在悬空内链 → ${target}`)
      }
      addEdge(pageId, targetId, p.slug, 'LINKS_TO', '内链')
    }
  }

  return { nodes, edges, sourceManifestCompiledAt: manifest.compiledAt }
}

/** 从节点/边数组计算全量计数（API 与 CLI 共用，杜绝散落硬编码数字） */
export function countGraph(nodes: GraphNode[], edges: GraphEdge[]): GraphCounts {
  return {
    nodes: nodes.length,
    edges: edges.length,
    pageNodes: nodes.filter(n => n.type === 'PAGE').length,
    sourceNodes: nodes.filter(n => n.type === 'SOURCE').length,
    topicNodes: nodes.filter(n => n.type === 'TOPIC').length,
    pageTypeNodes: nodes.filter(n => n.type === 'PAGE_TYPE').length,
    interlinkEdges: edges.filter(e => e.semantic === 'LINKS_TO').length,
    sourceEdges: edges.filter(e => e.semantic === 'HAS_SOURCE').length,
    topicEdges: edges.filter(e => e.semantic === 'HAS_TOPIC').length,
    typeEdges: edges.filter(e => e.semantic === 'HAS_TYPE').length,
  }
}

/** 节点类型分布（按 PAGE → SOURCE → TOPIC → PAGE_TYPE 固定顺序） */
export function nodeTypeDistribution(nodes: GraphNode[]): GraphNodeTypeCount[] {
  const order: GraphNodeType[] = ['PAGE', 'SOURCE', 'TOPIC', 'PAGE_TYPE']
  return order.map(type => ({
    type,
    count: nodes.filter(n => n.type === type).length,
  }))
}

/** 边语义分布（按固定顺序） */
export function edgeSemanticDistribution(edges: GraphEdge[]): GraphEdgeSemanticCount[] {
  const order: GraphEdgeSemantic[] = ['LINKS_TO', 'HAS_SOURCE', 'HAS_TOPIC', 'HAS_TYPE']
  return order.map(semantic => ({
    semantic,
    count: edges.filter(e => e.semantic === semantic).length,
  }))
}

/**
 * 运行抽取管道并落盘 output/（kg_nodes.json + kg_edges.json + kg_meta.json）。
 * now 只进入 meta 的 generatedAt，不影响节点/边数组的确定性。
 */
export function extractGraph(now = new Date()): GraphExtractResult {
  const { nodes, edges, sourceManifestCompiledAt } = buildGraph()

  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(KG_NODES_PATH, JSON.stringify(nodes, null, 2) + '\n', 'utf8')
  writeFileSync(KG_EDGES_PATH, JSON.stringify(edges, null, 2) + '\n', 'utf8')
  writeFileSync(
    KG_META_PATH,
    JSON.stringify(
      {
        schemaVersion: 1,
        mode: 'local-rule-extraction',
        generatedAt: now.toISOString(),
        extractedBy: 'llmwiki/graph:extract',
        sourceManifest: 'content/wiki/manifest.json',
        sourceManifestCompiledAt,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  )

  return {
    ok: true,
    mode: 'local-rule-extraction',
    stats: countGraph(nodes, edges),
    generatedAt: now.toISOString(),
    message: `图谱抽取完成：${nodes.length} 个节点、${edges.length} 条边已更新`,
  }
}
