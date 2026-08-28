'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import Link from 'next/link'
import type { GraphEdge, GraphNode, GraphNodeType } from '@llmwiki/contracts'
import { SearchIcon, RefreshIcon, WikiIcon, GraphIcon } from './Icons'

/* ============================================================
 * 基础版知识图谱画布（STAGE-06 技术验证稿）
 *
 * 刻意保持朴素：React + 原生 SVG，确定性「同心分层」布局，
 * 不引入 d3 / cytoscape / 力导向等大型依赖，也不做星空、辉光、
 * 3D、粒子等视觉炫技。目的只是验证「数据 → 画布 → 交互 → 详情」
 * 这一整条链路是否真的能看、能点，为下一阶段优化留下对照基线。
 * ============================================================ */

const NODE_TYPE_LABEL: Record<GraphNodeType, string> = {
  PAGE: '知识页',
  SOURCE: '来源文档',
  TOPIC: '主题',
  PAGE_TYPE: '页面类型',
}

/** 四种固定颜色（与统计卡 / 图例一致，深色底上可辨识） */
const NODE_TYPE_COLOR: Record<GraphNodeType, string> = {
  PAGE: '#86d8bb',
  SOURCE: '#c99a4a',
  TOPIC: '#f2d166',
  PAGE_TYPE: '#6f93a7',
}

/** 节点视觉半径（viewBox 逻辑单位） */
const NODE_RADIUS: Record<GraphNodeType, number> = {
  PAGE: 9,
  SOURCE: 7,
  TOPIC: 7,
  PAGE_TYPE: 6,
}

const TYPE_ORDER: GraphNodeType[] = ['PAGE', 'SOURCE', 'TOPIC', 'PAGE_TYPE']

/** viewBox 逻辑尺寸 */
const VB = { w: 1200, h: 760 }
const VB_CX = VB.w / 2
const VB_CY = VB.h / 2

/** 同心分层：由内向外 PAGE_TYPE → TOPIC → SOURCE → PAGE */
const RING_RADIUS: Record<GraphNodeType, number> = {
  PAGE_TYPE: 75,
  TOPIC: 165,
  SOURCE: 255,
  PAGE: 345,
}

/** 每类环的起始角度错开，减少径向重叠 */
const RING_OFFSET: Record<GraphNodeType, number> = {
  PAGE: -Math.PI / 2,
  SOURCE: -Math.PI / 2 + 0.35,
  TOPIC: -Math.PI / 2 + 0.7,
  PAGE_TYPE: -Math.PI / 2 + 1.05,
}

interface Point {
  x: number
  y: number
}

/** 确定性同心分层布局：按类型分层、层内按 id 排序，两次计算结果完全一致 */
export function computeLayout(nodes: GraphNode[]): Map<string, Point> {
  const positions = new Map<string, Point>()
  for (const type of TYPE_ORDER) {
    const group = nodes
      .filter(n => n.type === type)
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    if (group.length === 0) continue
    const radius = RING_RADIUS[type]
    const offset = RING_OFFSET[type]
    group.forEach((n, i) => {
      const angle = offset + (2 * Math.PI * i) / group.length
      positions.set(n.id, {
        x: VB_CX + radius * Math.cos(angle),
        y: VB_CY + radius * Math.sin(angle),
      })
    })
  }
  return positions
}

/** 知识页节点的 Wiki slug（source_doc 形如 wiki/<slug>.md） */
function pageSlug(node: GraphNode): string | null {
  if (node.type !== 'PAGE') return null
  return node.source_doc.replace(/^wiki\//, '').replace(/\.md$/, '')
}

/** 按节点 id 去重（同一条边可能因不同 doc_id 指向同一节点，避免重复 key） */
function uniqueById(list: GraphNode[]): GraphNode[] {
  const seen = new Map<string, GraphNode>()
  for (const n of list) if (!seen.has(n.id)) seen.set(n.id, n)
  return [...seen.values()]
}

/** 把鼠标屏幕坐标换算回 viewBox 坐标（preserveAspectRatio meet 下的映射） */
function svgViewBoxPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number; s: number } {
  const rect = svg.getBoundingClientRect()
  const s = Math.min(rect.width / VB.w, rect.height / VB.h)
  const ox = (rect.width - VB.w * s) / 2
  const oy = (rect.height - VB.h * s) / 2
  return {
    x: (clientX - rect.left - ox) / s,
    y: (clientY - rect.top - oy) / s,
    s,
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

interface DragState {
  x0: number
  y0: number
  tx: number
  ty: number
  s: number
  moved: boolean
}

interface GraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export function GraphCanvas({ nodes, edges }: GraphCanvasProps) {
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [isLight, setIsLight] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [visibleTypes, setVisibleTypes] = useState<Set<GraphNodeType>>(
    () => new Set(TYPE_ORDER),
  )
  const [dragging, setDragging] = useState(false)

  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const didDragRef = useRef(false)

  useEffect(() => {
    const syncTheme = () => setIsLight(document.documentElement.dataset.theme !== 'dark')
    syncTheme()
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes])
  const positions = useMemo(() => computeLayout(nodes), [nodes])

  const query = search.trim().toLowerCase()
  const matchIds = useMemo(() => {
    if (!query) return new Set<string>()
    return new Set(
      nodes
        .filter(n => n.name.toLowerCase().includes(query))
        .map(n => n.id),
    )
  }, [nodes, query])

  const visibleNodes = useMemo(
    () => nodes.filter(n => visibleTypes.has(n.type)),
    [nodes, visibleTypes],
  )
  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map(n => n.id)),
    [visibleNodes],
  )
  const visibleEdges = useMemo(
    () =>
      edges.filter(
        e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target),
      ),
    [edges, visibleNodeIds],
  )

  const selected = selectedId ? nodeMap.get(selectedId) : undefined

  const selectedNeighbors = useMemo(() => {
    const s = new Set<string>()
    if (!selectedId) return s
    for (const e of edges) {
      if (e.source === selectedId) s.add(e.target)
      else if (e.target === selectedId) s.add(e.source)
    }
    return s
  }, [edges, selectedId])

  /* ---------- 缩放（原生非 passive wheel，支持 preventDefault） ---------- */
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      const p = svgViewBoxPoint(svg, e.clientX, e.clientY)
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
      setTransform((t) => {
        const k2 = clamp(t.k * factor, 0.25, 4)
        const wx = (p.x - t.x) / t.k
        const wy = (p.y - t.y) / t.k
        return { k: k2, x: p.x - k2 * wx, y: p.y - k2 * wy }
      })
    }
    svg.addEventListener('wheel', handler, { passive: false })
    return () => svg.removeEventListener('wheel', handler)
  }, [])

  /* ---------- 拖拽画布（pointer 事件 + window 边界结束） ---------- */
  useEffect(() => {
    if (!dragging) return
    const up = () => {
      dragRef.current = null
      setDragging(false)
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [dragging])

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return
    const p = svgViewBoxPoint(e.currentTarget, e.clientX, e.clientY)
    dragRef.current = {
      x0: e.clientX,
      y0: e.clientY,
      tx: transform.x,
      ty: transform.y,
      s: p.s,
      moved: false,
    }
    didDragRef.current = false
    setDragging(true)
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      d.moved = true
      didDragRef.current = true
    }
    setTransform(t => ({
      x: d.tx + dx / d.s,
      y: d.ty + dy / d.s,
      k: t.k,
    }))
  }

  function onPointerUp() {
    dragRef.current = null
    setDragging(false)
  }

  /* ---------- 交互动作 ---------- */
  function selectNode(id: string) {
    setSelectedId(id)
  }

  function focusNode(id: string) {
    const p = positions.get(id)
    if (!p) return
    setTransform({ x: VB_CX - p.x * 1.6, y: VB_CY - p.y * 1.6, k: 1.6 })
    setSelectedId(id)
  }

  function locateFirstMatch() {
    const first = nodes.find(n => matchIds.has(n.id))
    if (first) focusNode(first.id)
  }

  function resetView() {
    setTransform({ x: 0, y: 0, k: 1 })
    setSelectedId(null)
    setSearch('')
  }

  function toggleType(type: GraphNodeType) {
    setVisibleTypes((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  function onSearchKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') locateFirstMatch()
  }

  const typeCounts = useMemo(() => {
    const m = new Map<GraphNodeType, number>()
    for (const n of nodes) m.set(n.type, (m.get(n.type) ?? 0) + 1)
    return m
  }, [nodes])

  return (
    <section className="panel-highlight overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-md">
      {/* 工具栏：搜索 / 类型显隐 / 复位 */}
      <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-4 py-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="搜索节点名称（如：网关）"
            className="w-56 rounded-xl border border-white/10 bg-white/[0.04] py-2 pl-9 pr-3 text-[15px] text-slate-200 placeholder:text-slate-500 focus:border-indigo-400/40 focus:outline-none focus:ring-1 focus:ring-indigo-400/30"
          />
        </div>
        <button
          onClick={locateFirstMatch}
          disabled={matchIds.size === 0}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[15px] text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          定位
          {query && (
            <span className="tabular-nums text-[13px] text-slate-500">
              {matchIds.size}
            </span>
          )}
        </button>

        <div className="flex flex-wrap items-center gap-1.5">
          {TYPE_ORDER.map((type) => {
            const on = visibleTypes.has(type)
            return (
              <button
                key={type}
                onClick={() => toggleType(type)}
                title={`${on ? '隐藏' : '显示'} ${NODE_TYPE_LABEL[type]}`}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                  on
                    ? 'bg-white/5 text-slate-200 ring-1 ring-inset ring-white/10'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: on ? NODE_TYPE_COLOR[type] : '#475569',
                  }}
                />
                {NODE_TYPE_LABEL[type]}
                <span className="tabular-nums text-slate-500">
                  {typeCounts.get(type) ?? 0}
                </span>
              </button>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[13px] text-slate-500 sm:inline">
            拖动画布 · 滚轮缩放 · 点击节点看详情
          </span>
          <button
            onClick={resetView}
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[15px] text-slate-200 transition-colors hover:bg-white/10"
          >
            <RefreshIcon className="h-4 w-4" />
            复位视图
          </button>
        </div>
      </div>

      {/* 画布 + 右侧详情 */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="relative h-[560px]">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${VB.w} ${VB.h}`}
            preserveAspectRatio="xMidYMid meet"
            className={`h-full w-full touch-none select-none ${
              dragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={() => {
              if (!didDragRef.current) setSelectedId(null)
            }}
          >
            {/* 全区域命中背景（朴素，无网格炫技） */}
            <rect
              x={0}
              y={0}
              width={VB.w}
              height={VB.h}
              fill="transparent"
            />

            <g
              transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}
            >
              {/* 边（朴素细线，选中节点的高亮邻边） */}
              {visibleEdges.map((e, i) => {
                const a = positions.get(e.source)
                const b = positions.get(e.target)
                if (!a || !b) return null
                const incident =
                  selectedId !== null &&
                  (e.source === selectedId || e.target === selectedId)
                return (
                  <line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={incident ? (isLight ? '#0f766e' : '#a5b4fc') : isLight ? '#78928a' : '#64748b'}
                    strokeOpacity={incident ? 0.62 : isLight ? 0.22 : 0.14}
                    strokeWidth={incident ? 1.5 : 1}
                  />
                )
              })}

              {/* 节点 */}
              {visibleNodes.map((n) => {
                const p = positions.get(n.id)
                if (!p) return null
                const r = NODE_RADIUS[n.type]
                const color = NODE_TYPE_COLOR[n.type]
                const isSelected = n.id === selectedId
                const isMatch = matchIds.has(n.id)
                const dimmed =
                  selectedId !== null &&
                  !isSelected &&
                  !selectedNeighbors.has(n.id)

                return (
                  <g
                    key={n.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!didDragRef.current) selectNode(n.id)
                    }}
                    className="cursor-pointer"
                  >
                    <title>{`${n.name} · ${NODE_TYPE_LABEL[n.type]}`}</title>
                    {isMatch && !isSelected && (
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={r + 3.5}
                        fill="none"
                        stroke={isLight ? '#0f766e' : '#f8fafc'}
                        strokeOpacity={0.6}
                        strokeWidth={1}
                        strokeDasharray="2 2"
                      />
                    )}
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r}
                      fill={color}
                      fillOpacity={dimmed ? 0.2 : isSelected ? 1 : 0.85}
                      stroke={isSelected ? (isLight ? '#0f766e' : '#ffffff') : isLight ? '#f8fbf9' : '#0b0e1a'}
                      strokeWidth={isSelected ? 2 : 1}
                    />
                    <text
                      x={p.x > VB_CX ? p.x - r - 5 : p.x + r + 5}
                      y={p.y + 3.5}
                      textAnchor={p.x > VB_CX ? 'end' : 'start'}
                      fontSize={11}
                      fill={isLight ? '#40534d' : '#cbd5e1'}
                      fillOpacity={dimmed ? 0.25 : isSelected ? 1 : 0.9}
                      pointerEvents="none"
                    >
                      {n.name}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>

          {/* 左下角图例计数 */}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-white/5 bg-[#0a0c14]/80 px-3 py-2 text-[13px] text-slate-400 tabular-nums">
            显示 {visibleNodes.length} 节点 / {visibleEdges.length} 边
          </div>
        </div>

        {/* 右侧详情面板 */}
        <NodeDetail
          node={selected}
          edges={edges}
          nodeMap={nodeMap}
          onSelectNode={focusNode}
        />
      </div>
    </section>
  )
}

/* ============================================================
 * 右侧详情面板：点击节点后展示来源 / 主题 / 类型 / 连接数，
 * 知识页额外提供「打开 Wiki」跳转 /wiki?slug=...
 * ============================================================ */
function NodeDetail({
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

    // 来源文档（HAS_SOURCE 边指向的 SOURCE 节点）
    const sources = incident
      .filter(e => e.semantic === 'HAS_SOURCE')
      .map(e => nodeMap.get(e.source === id ? e.target : e.source))
      .filter((n): n is GraphNode => n !== undefined && n.type === 'SOURCE')

    // 主题（HAS_TOPIC 边指向的 TOPIC 节点）
    const topics = incident
      .filter(e => e.semantic === 'HAS_TOPIC')
      .map(e => nodeMap.get(e.source === id ? e.target : e.source))
      .filter((n): n is GraphNode => n !== undefined && n.type === 'TOPIC')

    // 页面类型（HAS_TYPE 边指向的 PAGE_TYPE 节点）
    const pageTypes = incident
      .filter(e => e.semantic === 'HAS_TYPE')
      .map(e => nodeMap.get(e.source === id ? e.target : e.source))
      .filter((n): n is GraphNode => n !== undefined && n.type === 'PAGE_TYPE')

    // 互链页面（LINKS_TO 边另一端的 PAGE 节点）
    const linkedPages = incident
      .filter(e => e.semantic === 'LINKS_TO')
      .map(e => nodeMap.get(e.source === id ? e.target : e.source))
      .filter((n): n is GraphNode => n !== undefined && n.type === 'PAGE')

    // 关联知识页（非 PAGE 节点时展示：与之相连的 PAGE 节点）
    const connectedPages = incident
      .map(e => nodeMap.get(e.source === id ? e.target : e.source))
      .filter((n): n is GraphNode => n !== undefined && n.type === 'PAGE')

    return {
      degree,
      sources: uniqueById(sources),
      topics: uniqueById(topics),
      pageTypes: uniqueById(pageTypes),
      linkedPages: uniqueById(linkedPages),
      connectedPages: uniqueById(connectedPages),
    }
  }, [node, edges, nodeMap])

  if (!node) {
    return (
      <aside className="flex flex-col items-center justify-center gap-2 border-l border-white/5 p-6 text-center lg:min-h-[560px]">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-500">
          <GraphIcon />
        </span>
        <p className="text-[15px] text-slate-400">点击画布中的节点查看详情</p>
        <p className="max-w-[240px] text-[13px] leading-relaxed text-slate-600">
          知识页节点会展示来源文档、主题、页面类型与连接数，并可跳转 Wiki
        </p>
      </aside>
    )
  }

  const color = NODE_TYPE_COLOR[node.type]
  const slug = pageSlug(node)
  const detail = info

  return (
    <aside className="border-t border-white/5 p-5 lg:min-h-[560px] lg:border-l lg:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-[13px] font-medium uppercase tracking-wider text-slate-500">
              {NODE_TYPE_LABEL[node.type]}
            </span>
          </div>
          <h3 className="mt-2 break-words text-lg font-semibold tracking-tight text-white">
            {node.name}
          </h3>
          <div className="mt-1 font-mono text-[13px] text-slate-500">
            {node.id} · {node.source_doc}
          </div>
        </div>
        {node.type === 'PAGE' && slug && (
          <Link
            href={`/wiki?slug=${encodeURIComponent(slug)}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-700 to-teal-600 px-3 py-2 text-[13px] font-medium text-white shadow-lg shadow-emerald-700/20 transition-colors hover:from-emerald-600 hover:to-teal-500"
          >
            <WikiIcon className="h-3.5 w-3.5" />
            打开 Wiki
          </Link>
        )}
      </div>

      {detail && (
        <dl className="mt-5 space-y-4 text-[15px]">
          <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-3">
            <dt className="text-slate-500">连接数</dt>
            <dd className="tabular-nums text-slate-100">{detail.degree}</dd>
          </div>

          {node.type === 'PAGE' && (
            <>
              <div>
                <dt className="text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                  主题
                </dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {detail.topics.length === 0 ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    detail.topics.map(t => (
                      <span
                        key={t.id}
                        className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[13px] text-slate-200"
                      >
                        {t.label ?? t.name}
                      </span>
                    ))
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                  页面类型
                </dt>
                <dd className="mt-1.5 flex flex-wrap gap-1.5">
                  {detail.pageTypes.length === 0 ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    detail.pageTypes.map(t => (
                      <span
                        key={t.id}
                        className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[13px] text-slate-200"
                      >
                        {t.label ?? t.name}
                      </span>
                    ))
                  )}
                </dd>
              </div>

              <div>
                <dt className="text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                  来源文档（{detail.sources.length}）
                </dt>
                <dd className="mt-1.5 space-y-1">
                  {detail.sources.length === 0 ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    detail.sources.map(s => (
                      <div
                        key={s.id}
                        className="rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1.5 text-[13px] text-slate-300"
                      >
                        {s.name}
                      </div>
                    ))
                  )}
                </dd>
              </div>
            </>
          )}

          <div>
            <dt className="text-[13px] font-semibold uppercase tracking-wider text-slate-500">
              {node.type === 'PAGE'
                ? `互链知识页（${detail.linkedPages.length}）`
                : `关联知识页（${detail.connectedPages.length}）`}
            </dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {(
                node.type === 'PAGE'
                  ? detail.linkedPages
                  : detail.connectedPages
              ).length === 0 ? (
                  <span className="text-slate-500">—</span>
                ) : (
                  (node.type === 'PAGE'
                    ? detail.linkedPages
                    : detail.connectedPages
                  ).map(p => (
                    <button
                      key={p.id}
                      onClick={() => onSelectNode(p.id)}
                      title={`在画布中定位 ${p.name}`}
                      className="rounded-full border border-indigo-400/20 bg-indigo-500/10 px-2.5 py-1 text-[13px] text-indigo-200 transition-colors hover:bg-indigo-500/20"
                    >
                      {p.name}
                    </button>
                  ))
                )}
            </dd>
          </div>
        </dl>
      )}
    </aside>
  )
}
