'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type {
  GraphEdgeSemantic,
  GraphNodeType,
  GraphOverviewResponse,
  GraphNode,
  GraphEdge,
} from '@llmwiki/contracts'
import { PageHeader } from './PageHeader'
import {
  fetchGraphOverview,
  fetchGraphNodes,
  fetchGraphEdges,
} from '../lib/api'
import { GraphCanvas } from './GraphCanvas'
import {
  NODE_TYPE_COLOR,
  NODE_TYPE_LABEL,
  NODE_TYPE_ORDER,
  SEMANTIC_LABEL,
  SEMANTIC_ORDER,
  DEFAULT_VISIBLE_SEMANTICS,
} from '../lib/graph-adapt'
import type { G6KnowledgeGraphHandle } from './G6KnowledgeGraph'
import {
  GraphIcon,
  WikiIcon,
  LayersIcon,
  AlertCircleIcon,
  SearchIcon,
} from './Icons'

/** G6 依赖 Canvas 与浏览器尺寸，必须禁用 SSR。 */
const G6KnowledgeGraph = dynamic(() => import('./G6KnowledgeGraph').then(m => m.G6KnowledgeGraph), {
  ssr: false,
  loading: () => (
    <div className="flex h-[620px] items-center justify-center text-[15px] text-slate-500">
      正在加载 G6 知识图谱…
    </div>
  ),
})

const STAT_CARDS = [
  { key: 'nodes' as const, label: '图谱节点', icon: GraphIcon, cls: 'from-emerald-400/15 to-emerald-300/5 text-emerald-200' },
  { key: 'edges' as const, label: '图谱边', icon: GraphIcon, cls: 'from-teal-400/15 to-cyan-300/5 text-teal-200' },
  { key: 'pageNodes' as const, label: '知识页节点', icon: WikiIcon, cls: 'from-lime-300/15 to-emerald-300/5 text-lime-200' },
  { key: 'sourceNodes' as const, label: '来源文档节点', icon: LayersIcon, cls: 'from-amber-300/15 to-yellow-300/5 text-amber-200' },
]

type LoadState = 'loading' | 'ready' | 'error'

export function GraphView() {
  const [overview, setOverview] = useState<GraphOverviewResponse | null>(null)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'graph' | 'structure'>('graph')

  // G6 图谱视图交互状态
  const [visibleTypes, setVisibleTypes] = useState<Set<GraphNodeType>>(
    () => new Set<GraphNodeType>(['PAGE', 'SOURCE', 'TOPIC', 'PAGE_TYPE']),
  )
  const [visibleSemantics, setVisibleSemantics] = useState<Set<GraphEdgeSemantic>>(
    () => new Set<GraphEdgeSemantic>([...DEFAULT_VISIBLE_SEMANTICS, 'HAS_SOURCE', 'HAS_TYPE']),
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const graphRef = useRef<G6KnowledgeGraphHandle | null>(null)

  // 适配后数据 + 对账（消费真实 API，禁止散写）
  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const [overviewRes, nodesRes, edgesRes] = await Promise.all([
        fetchGraphOverview(),
        fetchGraphNodes(),
        fetchGraphEdges(),
      ])
      setOverview(overviewRes)
      setNodes(nodesRes.nodes)
      setEdges(edgesRes.edges)
      setState('ready')
    } catch (e) {
      setError(e instanceof Error ? e.message : '图谱数据加载失败')
      setState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const badge =
    state === 'ready' ? '知识关系 · 已就绪' : state === 'error' ? '连接异常' : '加载中'

  const stats = overview?.stats

  return (
    <div className="space-y-8">
      <PageHeader
        title="知识图谱 · 可交互画布"
        description="以主题知识簇组织企业内容，探索知识页、来源与业务关系"
        badge={badge}
      />

      {/* 顶部统计卡（数字全部来自 /api/graph 真实输出文件） */}
      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {STAT_CARDS.map((card, index) => {
          const Icon = card.icon
          const value = stats ? stats[card.key] : 0
          return (
            <div
              key={card.key}
              className="panel-highlight animate-fade-in-up rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-md transition-colors hover:border-indigo-400/40 hover:bg-white/[0.06]"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br ${card.cls}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-2xl font-semibold tabular-nums tracking-tight text-white">
                    {value.toLocaleString('zh-CN')}
                  </div>
                  <div className="text-[13px] text-slate-400">{card.label}</div>
                </div>
              </div>
            </div>
          )
        })}
      </section>

      {/* 视图切换 + 画布：语义星图为主视图，结构视图保留为完整关系视角 */}
      {state === 'error' ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-16 text-center">
          <AlertCircleIcon className="h-10 w-10 text-rose-400" />
          <p className="mt-4 text-[15px] text-slate-300">图谱数据加载失败</p>
          <p className="mt-1 text-[13px] text-slate-500">{error}</p>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#071012]">
          {/* 视图切换 + 控制条 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-3">
            <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
              <button
                onClick={() => setView('graph')}
                className={`rounded-lg px-3.5 py-1.5 text-[15px] transition-colors ${
                  view === 'graph'
                    ? 'bg-emerald-300/[0.08] text-emerald-100 ring-1 ring-inset ring-emerald-300/25'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                G6 聚类图
              </button>
              <button
                onClick={() => setView('structure')}
                className={`rounded-lg px-3.5 py-1.5 text-[15px] transition-colors ${
                  view === 'structure'
                    ? 'bg-emerald-300/[0.08] text-emerald-100 ring-1 ring-inset ring-emerald-300/25'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                结构视图
              </button>
            </div>

            <button
              onClick={() => graphRef.current?.relayout()}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-[13px] text-slate-300 transition-colors hover:border-emerald-300/20 hover:bg-emerald-300/[0.05] hover:text-emerald-100"
            >
              聚类复位
            </button>

            <button
              onClick={() => {
                setSelectedId(null)
                graphRef.current?.fitView()
              }}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-[13px] text-slate-300 transition-colors hover:bg-white/10"
            >
              适配全图
            </button>

            <div className="relative ml-auto">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  const query = searchQuery.trim().toLowerCase()
                  const match = nodes.find(node =>
                    (node.label ?? node.name).toLowerCase().includes(query),
                  )
                  if (match) {
                    setSelectedId(match.id)
                    graphRef.current?.focusNode(match.id)
                  }
                }}
                placeholder="搜索节点…"
                className="w-44 rounded-xl border border-white/10 bg-white/[0.04] py-1.5 pl-8 pr-2 text-[13px] text-slate-200 placeholder:text-slate-500 focus:border-emerald-300/35 focus:outline-none"
              />
            </div>
          </div>

          {/* 筛选条：类型 + 关系 */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-white/5 px-4 py-2">
            <span className="mr-1 text-[13px] text-slate-500">类型</span>
            {NODE_TYPE_ORDER.map((type) => {
              const on = visibleTypes.has(type)
              return (
                <button
                  key={type}
                  onClick={() =>
                    setVisibleTypes((prev) => {
                      const next = new Set(prev)
                      if (next.has(type)) next.delete(type)
                      else next.add(type)
                      return next
                    })
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] transition-colors ${
                    on ? 'text-slate-200' : 'text-slate-600 hover:text-slate-400'
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: on ? NODE_TYPE_COLOR[type] : '#334155' }}
                  />
                  {NODE_TYPE_LABEL[type]}
                </button>
              )
            })}
            <span className="mx-2 text-slate-700">|</span>
            <span className="mr-1 text-[13px] text-slate-500">关系</span>
            {SEMANTIC_ORDER.map((sem) => {
              const on = visibleSemantics.has(sem)
              return (
                <button
                  key={sem}
                  onClick={() =>
                    setVisibleSemantics((prev) => {
                      const next = new Set(prev)
                      if (next.has(sem)) next.delete(sem)
                      else next.add(sem)
                      return next
                    })
                  }
                  className={`rounded-full px-2.5 py-1 text-[13px] transition-colors ${
                    on ? 'bg-white/10 text-slate-200' : 'text-slate-600 hover:text-slate-400'
                  }`}
                >
                  {SEMANTIC_LABEL[sem]}
                </button>
              )
            })}
          </div>

          {view === 'graph' ? (
            <div className="h-[560px]">
              <G6KnowledgeGraph
                ref={graphRef}
                nodes={nodes}
                edges={edges}
                visibleTypes={visibleTypes}
                visibleSemantics={visibleSemantics}
                onSelectNode={setSelectedId}
              />
            </div>
          ) : (
            <GraphCanvas nodes={nodes} edges={edges} />
          )}

          {/* HUD + 图例 + 详情（只在 G6 聚类图显示，结构视图 GraphCanvas 自带） */}
          {view === 'graph' && (
            <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] border-t border-white/5">
              <HudLegend
                totalNodes={nodes.length}
                totalEdges={edges.length}
                visibleTypes={visibleTypes}
                visibleSemantics={visibleSemantics}
                searchQuery={searchQuery}
                selectedId={selectedId}
                nodeMap={nodeMap}
              />
              <BloomNodeDetail
                node={selectedId ? nodeMap.get(selectedId) : undefined}
                edges={edges}
                nodeMap={nodeMap}
                onSelectNode={(id) => {
                  setSelectedId(id)
                  graphRef.current?.focusNode(id)
                }}
              />
            </div>
          )}
        </section>
      )}

      {/* 分布面板：节点类型 / 边语义 */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="panel-highlight rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md">
          <h3 className="text-[15px] font-semibold text-white">节点类型分布</h3>
          <p className="mt-0.5 text-[13px] text-slate-500">四类节点：知识页 / 来源文档 / 主题 / 页面类型</p>
          <ul className="mt-4 space-y-2.5">
            {(overview?.nodeTypes ?? []).map(t => (
              <li key={t.type} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-indigo-400/70" />
                  <span className="text-[15px] text-slate-200">{NODE_TYPE_LABEL[t.type]}</span>
                  <span className="font-mono text-[13px] text-slate-500">{t.type}</span>
                </div>
                <span className="text-[15px] tabular-nums text-slate-300">{t.count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel-highlight rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md">
          <h3 className="text-[15px] font-semibold text-white">边语义分布</h3>
          <p className="mt-0.5 text-[13px] text-slate-500">基础字段 relation 恒为 CO_OCCURS_IN，语义存入扩展字段 semantic</p>
          <ul className="mt-4 space-y-2.5">
            {(overview?.edgeSemantics ?? []).map(s => (
              <li key={s.semantic} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-sky-400/70" />
                  <span className="text-[15px] text-slate-200">{SEMANTIC_LABEL[s.semantic]}</span>
                  <span className="font-mono text-[13px] text-slate-500">{s.semantic}</span>
                </div>
                <span className="text-[15px] tabular-nums text-slate-300">{s.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

    </div>
  )
}

/* ============================================================
 * 深空 3D 视图的 HUD + 图例（真实计数，面向知识库用户）
 * ============================================================ */
function HudLegend({
  totalNodes,
  totalEdges,
  visibleTypes,
  visibleSemantics,
  searchQuery,
  selectedId,
  nodeMap,
}: {
  totalNodes: number
  totalEdges: number
  visibleTypes: Set<GraphNodeType>
  visibleSemantics: Set<GraphEdgeSemantic>
  searchQuery: string
  selectedId: string | null
  nodeMap: Map<string, GraphNode>
}) {
  const q = searchQuery.trim().toLowerCase()
  const matchCount = q
    ? [...nodeMap.values()].filter(n => n.name.toLowerCase().includes(q)).length
    : 0

  // 当前可见节点数 = 类型筛选 + 搜索交集
  const visibleNodeCount = [...nodeMap.values()].filter(
    n => visibleTypes.has(n.type) && (!q || n.name.toLowerCase().includes(q)),
  ).length

  const selected = selectedId ? nodeMap.get(selectedId) : undefined

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* 真实 HUD 读数 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] tabular-nums text-slate-400">
        <span>
          知识图谱 <span className="text-slate-100">{totalNodes}</span> 节点 ·{' '}
          <span className="text-slate-100">{totalEdges}</span> 关系
        </span>
        <span>
          当前可见 <span className="text-slate-100">{visibleNodeCount}</span> 节点
        </span>
        {q && (
          <span>
            搜索命中 <span className="text-emerald-200">{matchCount}</span>
          </span>
        )}
        {selected && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-slate-500">已选：</span>
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: NODE_TYPE_COLOR[selected.type] }}
            />
            <span className="text-slate-100">{selected.label ?? selected.name}</span>
            <span className="text-slate-600">· {NODE_TYPE_LABEL[selected.type]}</span>
          </span>
        )}
        {!selected && <span className="text-slate-600">未选中节点</span>}
      </div>

      {/* 底部图例（始终在场） */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-slate-400">
        <span className="text-[13px] uppercase tracking-wider text-slate-600">图例</span>
        {NODE_TYPE_ORDER.map(type => (
          <button
            key={type}
            onClick={() => {}}
            className={`inline-flex items-center gap-1.5 transition-opacity ${
              visibleTypes.has(type) ? 'opacity-100' : 'opacity-40'
            }`}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: NODE_TYPE_COLOR[type] }}
            />
            {NODE_TYPE_LABEL[type]}
            <span className="tabular-nums text-slate-600">
              {[...nodeMap.values()].filter(n => n.type === type).length}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ============================================================
 * 深空 3D 视图的节点详情面板（连接数 / 主题 / 来源 / Wiki 跳转）
 * ============================================================ */
function BloomNodeDetail({
  node,
  edges,
  nodeMap,
  onSelectNode,
}: {
  node: GraphNode | undefined
  edges: GraphEdge[]
  nodeMap: Map<string, GraphNode>
  onSelectNode: (id: string) => void
}) {
  const info = useMemo(() => {
    if (!node) return null
    const id = node.id
    const incident = edges.filter(e => e.source === id || e.target === id)
    const degree = incident.length
    const other = (e: GraphEdge) => nodeMap.get(e.source === id ? e.target : e.source)

    const topics = incident
      .filter(e => e.semantic === 'HAS_TOPIC')
      .map(other)
      .filter((n): n is GraphNode => n !== undefined && n.type === 'TOPIC')

    const pageTypes = incident
      .filter(e => e.semantic === 'HAS_TYPE')
      .map(other)
      .filter((n): n is GraphNode => n !== undefined && n.type === 'PAGE_TYPE')

    const sources = incident
      .filter(e => e.semantic === 'HAS_SOURCE')
      .map(other)
      .filter((n): n is GraphNode => n !== undefined && n.type === 'SOURCE')

    const linkedPages = incident
      .filter(e => e.semantic === 'LINKS_TO')
      .map(other)
      .filter((n): n is GraphNode => n !== undefined && n.type === 'PAGE')

    return { degree, topics, pageTypes, sources, linkedPages }
  }, [node, edges, nodeMap])

  if (!node) {
    return (
      <div className="flex items-center justify-center p-5 text-center text-[13px] text-slate-500">
        点击画布中的节点查看详情
      </div>
    )
  }

  const color = NODE_TYPE_COLOR[node.type]
  const slug = node.type === 'PAGE' ? node.source_doc.replace(/^wiki\//, '').replace(/\.md$/, '') : null

  return (
    <div className="border-t border-white/5 p-4 lg:border-l lg:border-t-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-[13px] uppercase tracking-wider text-slate-500">
              {NODE_TYPE_LABEL[node.type]}
            </span>
          </div>
          <h3 className="mt-1.5 break-words text-base font-semibold text-white">
            {node.label ?? node.name}
          </h3>
          <div className="mt-0.5 font-mono text-[13px] text-slate-500">{node.source_doc}</div>
        </div>
        {slug && (
          <Link
            href={`/wiki?slug=${encodeURIComponent(slug)}`}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-gradient-to-r from-emerald-700 to-teal-600 px-2.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:from-emerald-600 hover:to-teal-500"
          >
            <WikiIcon className="h-3.5 w-3.5" />
            打开 Wiki
          </Link>
        )}
      </div>

      {info && (
        <dl className="mt-3 space-y-2 text-[13px]">
          <div className="flex items-center justify-between border-b border-white/5 pb-2">
            <dt className="text-slate-500">连接数</dt>
            <dd className="tabular-nums text-slate-100">{info.degree}</dd>
          </div>
          {info.topics.length > 0 && (
            <Row label="主题" chips={info.topics.map(t => t.label ?? t.name)} borderColor={NODE_TYPE_COLOR.TOPIC} />
          )}
          {info.pageTypes.length > 0 && (
            <Row label="页面类型" chips={info.pageTypes.map(t => t.label ?? t.name)} borderColor={NODE_TYPE_COLOR.PAGE_TYPE} />
          )}
          {info.linkedPages.length > 0 && (
            <div>
              <dt className="text-slate-500">互链知识页</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {uniqueNodes(info.linkedPages).map(p => (
                  <button
                    key={p.id}
                    onClick={() => onSelectNode(p.id)}
                    className="rounded-full border border-indigo-400/20 bg-indigo-500/10 px-2 py-0.5 text-[13px] text-indigo-200 hover:bg-indigo-500/20"
                  >
                    {p.name}
                  </button>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  )
}

function uniqueNodes(nodes: GraphNode[]): GraphNode[] {
  return [...new Map(nodes.map(node => [node.id, node])).values()]
}

function Row({ label, chips, borderColor }: { label: string; chips: string[]; borderColor: string }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-1 flex flex-wrap gap-1.5">
        {chips.map((c, i) => (
          <span
            key={i}
            className="rounded-full border bg-white/5 px-2 py-0.5 text-[13px] text-slate-200"
            style={{ borderColor: `${borderColor}33` }}
          >
            {c}
          </span>
        ))}
      </dd>
    </div>
  )
}
